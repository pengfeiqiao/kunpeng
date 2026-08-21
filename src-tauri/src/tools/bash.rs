use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub output_id: Option<String>,
    pub stdout_total_chars: usize,
    pub stderr_total_chars: usize,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandOutputPage {
    pub output_id: String,
    pub stream: String,
    pub content: String,
    pub offset: usize,
    pub returned_chars: usize,
    pub total_chars: usize,
    pub next_offset: Option<usize>,
    pub truncated: bool,
}

#[derive(Clone)]
struct StoredCommandOutput {
    stdout: String,
    stderr: String,
    created_at: SystemTime,
}

// ── Shared state for kill support ────────────────────────────────────────────
//
// Maps request_id → process-group id (== child pid, because we spawn each
// command in its own process group via process_group(0)). The frontend passes
// a request_id when launching a command and calls `kill_command` with the same
// id to terminate the whole process tree (not just the /bin/zsh parent).
//
// Mirrors the registry pattern in stream_proxy.rs: Arc<Mutex<HashMap>> so the
// RAII guard can synchronously remove its entry, and the lock is only held for
// O(1) map ops, never across an await.

type PidMap = Arc<Mutex<HashMap<String, i32>>>;

#[derive(Clone)]
pub struct BashProcessState {
    active: PidMap,
    outputs: Arc<Mutex<HashMap<String, StoredCommandOutput>>>,
}

impl Default for BashProcessState {
    fn default() -> Self {
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
            outputs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn char_len(value: &str) -> usize {
    value.chars().count()
}

fn char_page(value: &str, offset: usize, limit: usize) -> (String, usize, Option<usize>) {
    let total = char_len(value);
    let start = offset.min(total);
    let content: String = value.chars().skip(start).take(limit).collect();
    let returned = char_len(&content);
    let end = start.saturating_add(returned);
    (content, returned, (end < total).then_some(end))
}

fn remember_output(state: &BashProcessState, output_id: &str, stdout: &str, stderr: &str) {
    let Ok(mut outputs) = state.outputs.lock() else {
        return;
    };
    outputs.retain(|_, value| {
        value
            .created_at
            .elapsed()
            .map(|age| age < Duration::from_secs(3600))
            .unwrap_or(false)
    });
    if outputs.len() >= 24 {
        if let Some(oldest) = outputs
            .iter()
            .min_by_key(|(_, value)| value.created_at)
            .map(|(key, _)| key.clone())
        {
            outputs.remove(&oldest);
        }
    }
    outputs.insert(
        output_id.to_string(),
        StoredCommandOutput {
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
            created_at: SystemTime::now(),
        },
    );
}

impl BashProcessState {
    /// Kill every active command's process group. Used during graceful
    /// shutdown so spawned children don't outlive the app.
    pub fn kill_all(&self) -> usize {
        let map = self.active.lock().unwrap();
        let count = map.len();
        for (_, pgid) in map.iter() {
            unsafe {
                libc::killpg(*pgid, libc::SIGKILL);
            }
        }
        count
    }
}

// RAII: removes the request_id from the map when the command task ends, no
// matter how it ends (success / timeout / error). Prevents map leaks.
struct PidGuard {
    active: PidMap,
    rid: String,
}

impl Drop for PidGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = self.active.lock() {
            map.remove(&self.rid);
        }
    }
}

/// Execute a shell command with optional working directory and timeout.
///
/// Each command runs in its **own process group** (`process_group(0)`) so the
/// whole tree — including `&`-backgrounded children and python subprocesses —
/// can be killed together via `kill_command(request_id)`.
#[tauri::command]
pub async fn execute_command(
    state: tauri::State<'_, BashProcessState>,
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    request_id: Option<String>,
    max_output_chars: Option<usize>,
) -> Result<CommandResult, String> {
    let timeout_duration = Duration::from_millis(timeout_ms.unwrap_or(120_000));

    let mut cmd = Command::new("/bin/zsh");
    // Disable zsh's `=command` filename expansion. Without this, harmless
    // diagnostics such as `echo ===` can be interpreted as command lookups.
    cmd.arg("-c")
        .arg(format!("unsetopt EQUALS 2>/dev/null\n{}", command));

    if let Some(ref dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    // Put the child in a new process group so killpg() can take down the
    // entire subtree, not just the /bin/zsh parent (which would orphan any
    // children the command spawned).
    #[cfg(unix)]
    cmd.process_group(0);

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // Register the child's process group (pgid == pid since we made it a group
    // leader) so kill_command can find it. Skip registration if no request_id.
    let _guard = match (request_id.as_ref(), child.id()) {
        (Some(rid), Some(pid)) => {
            if let Ok(mut map) = state.active.lock() {
                map.insert(rid.clone(), pid as i32);
            }
            Some(PidGuard {
                active: state.active.clone(),
                rid: rid.clone(),
            })
        }
        _ => None,
    };

    let result = match timeout(timeout_duration, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(format!("Failed to execute command: {}", e)),
        Err(_) => {
            // Timed out — kill the whole process group, then report timeout.
            if let Some(rid) = request_id.as_ref() {
                if let Ok(map) = state.active.lock() {
                    if let Some(pgid) = map.get(rid) {
                        unsafe {
                            libc::killpg(*pgid, libc::SIGKILL);
                        }
                    }
                }
            }
            return Err(format!(
                "Command timed out after {}ms",
                timeout_duration.as_millis()
            ));
        }
    };

    let stdout = String::from_utf8_lossy(&result.stdout).to_string();
    let stderr = String::from_utf8_lossy(&result.stderr).to_string();
    let exit_code = result.status.code().unwrap_or(-1);
    let stdout_total_chars = char_len(&stdout);
    let stderr_total_chars = char_len(&stderr);

    if let Some(ref output_id) = request_id {
        remember_output(&state, output_id, &stdout, &stderr);
    }

    let preview_limit = max_output_chars.unwrap_or(usize::MAX);
    let combined_total = stdout_total_chars.saturating_add(stderr_total_chars);
    let (stdout_limit, stderr_limit) = if combined_total <= preview_limit {
        (stdout_total_chars, stderr_total_chars)
    } else if exit_code != 0 && stderr_total_chars > 0 {
        let stderr_budget = (preview_limit * 2 / 3).min(stderr_total_chars);
        (preview_limit.saturating_sub(stderr_budget), stderr_budget)
    } else {
        let stdout_budget = (preview_limit * 3 / 4).min(stdout_total_chars);
        (stdout_budget, preview_limit.saturating_sub(stdout_budget))
    };
    let (stdout_preview, _, stdout_next) = char_page(&stdout, 0, stdout_limit);
    let (stderr_preview, _, stderr_next) = char_page(&stderr, 0, stderr_limit);

    Ok(CommandResult {
        stdout: stdout_preview,
        stderr: stderr_preview,
        exit_code,
        output_id: request_id,
        stdout_total_chars,
        stderr_total_chars,
        stdout_truncated: stdout_next.is_some(),
        stderr_truncated: stderr_next.is_some(),
    })
}

/// Read a stable page from a previous command's full stdout/stderr without
/// re-running the command. Results are kept for one hour (up to 24 commands).
#[tauri::command]
pub async fn read_command_output(
    state: tauri::State<'_, BashProcessState>,
    output_id: String,
    stream: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<CommandOutputPage, String> {
    let stream = stream.unwrap_or_else(|| "stdout".to_string());
    let stored = state
        .outputs
        .lock()
        .map_err(|_| "Command output store is unavailable".to_string())?
        .get(&output_id)
        .cloned()
        .ok_or_else(|| format!("Command output not found or expired: {}", output_id))?;
    let value = match stream.as_str() {
        "stdout" => &stored.stdout,
        "stderr" => &stored.stderr,
        _ => return Err("stream must be stdout or stderr".to_string()),
    };
    let total_chars = char_len(value);
    let start = offset.unwrap_or(0).min(total_chars);
    let safe_limit = limit.unwrap_or(8000).min(20_000);
    let (content, returned_chars, next_offset) = char_page(value, start, safe_limit);
    Ok(CommandOutputPage {
        output_id,
        stream,
        content,
        offset: start,
        returned_chars,
        total_chars,
        next_offset,
        truncated: next_offset.is_some(),
    })
}

/// Kill a running command's entire process group.
///
/// Sends SIGTERM to the process group, waits a short grace period, then sends
/// SIGKILL to guarantee termination. Kills the whole group (negative-pid via
/// killpg) so `&`-backgrounded children and python subprocesses die too —
/// not just the /bin/zsh parent.
#[tauri::command]
pub async fn kill_command(
    state: tauri::State<'_, BashProcessState>,
    request_id: String,
) -> Result<(), String> {
    let pgid = {
        match state.active.lock() {
            Ok(map) => map.get(&request_id).copied(),
            Err(_) => None,
        }
    };

    if let Some(pgid) = pgid {
        // Graceful first: SIGTERM the whole group.
        unsafe {
            libc::killpg(pgid, libc::SIGTERM);
        }
        // Grace period, then force-kill anything still alive.
        tokio::time::sleep(Duration::from_millis(1500)).await;
        unsafe {
            libc::killpg(pgid, libc::SIGKILL);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::char_page;

    #[test]
    fn command_output_pages_are_contiguous_for_unicode() {
        let source = "甲乙abc丙丁";
        let (first, _, next) = char_page(source, 0, 4);
        let (second, _, tail) = char_page(source, next.unwrap(), 20);
        assert_eq!(format!("{}{}", first, second), source);
        assert!(tail.is_none());
    }
}
