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
// Maps request_id → child pid. On Unix each command is spawned in its own
// process group (pgid == pid) and killed via killpg(); on Windows the whole
// tree is taken down with `taskkill /T /F`. The frontend passes a request_id
// when launching a command and calls `kill_command` with the same id to
// terminate the whole process tree (not just the shell parent).
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

// ── Platform shell selection ─────────────────────────────────────────────────
//
// macOS/Linux keep /bin/zsh. Windows prefers Git for Windows' bash.exe so the
// POSIX-style commands the app and the models emit (pipes, heredocs,
// `2>/dev/null`, `~` expansion, `&&`) keep working unchanged; PowerShell is the
// fallback when Git Bash is not installed. The WSL launcher at
// System32\bash.exe is deliberately skipped — it interprets paths inside the
// Linux filesystem, not the Windows one.

#[derive(Debug, Clone, Serialize)]
pub struct ShellInfo {
    pub platform: &'static str,
    pub shell: &'static str,
    pub shell_path: String,
}

#[cfg(windows)]
fn find_windows_bash() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    use std::sync::OnceLock;
    static CACHED: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            let mut candidates = Vec::new();
            if let Some(program_files) = std::env::var_os("ProgramFiles") {
                let pf = PathBuf::from(program_files);
                candidates.push(pf.join("Git").join("bin").join("bash.exe"));
            }
            if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
                candidates.push(
                    PathBuf::from(program_files_x86)
                        .join("Git")
                        .join("bin")
                        .join("bash.exe"),
                );
            }
            if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
                candidates.push(
                    PathBuf::from(local_app_data)
                        .join("Programs")
                        .join("Git")
                        .join("bin")
                        .join("bash.exe"),
                );
            }
            if let Some(home) = std::env::var_os("USERPROFILE") {
                candidates.push(
                    PathBuf::from(home)
                        .join("scoop")
                        .join("apps")
                        .join("git")
                        .join("current")
                        .join("bin")
                        .join("bash.exe"),
                );
            }
            for candidate in &candidates {
                if candidate.is_file() {
                    return Some(candidate.clone());
                }
            }
            // Last resort: scan PATH, skipping System32 (WSL stub).
            if let Some(path) = std::env::var_os("PATH") {
                for dir in std::env::split_paths(&path) {
                    let dir_text = dir.to_string_lossy().to_ascii_lowercase();
                    if dir_text.ends_with("system32") || dir_text.ends_with("system32\\") {
                        continue;
                    }
                    let candidate = dir.join("bash.exe");
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
            None
        })
        .clone()
}

#[cfg(windows)]
fn shell_info_locked() -> ShellInfo {
    match find_windows_bash() {
        Some(path) => ShellInfo {
            platform: "windows",
            shell: "bash",
            shell_path: path.to_string_lossy().to_string(),
        },
        None => ShellInfo {
            platform: "windows",
            shell: "powershell",
            shell_path: "powershell".to_string(),
        },
    }
}

#[cfg(target_os = "macos")]
fn shell_info_locked() -> ShellInfo {
    ShellInfo {
        platform: "macos",
        shell: "zsh",
        shell_path: "/bin/zsh".to_string(),
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn shell_info_locked() -> ShellInfo {
    ShellInfo {
        platform: "linux",
        shell: "zsh",
        shell_path: "/bin/zsh".to_string(),
    }
}

/// Report which shell `execute_command` uses on this machine, so the frontend
/// and the agent prompts can emit the matching command dialect.
#[tauri::command]
pub fn shell_info() -> ShellInfo {
    shell_info_locked()
}

/// Build the Command that runs `script` through the platform shell.
#[cfg(windows)]
fn shell_command(script: &str) -> Command {
    // tokio Command has an inherent creation_flags method on Windows.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = match find_windows_bash() {
        Some(bash) => {
            let mut cmd = Command::new(bash);
            cmd.arg("-c").arg(script);
            cmd
        }
        None => {
            let mut cmd = Command::new("powershell");
            cmd.arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-Command")
                .arg(script);
            cmd
        }
    };
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(unix)]
fn shell_command(script: &str) -> Command {
    let mut cmd = Command::new("/bin/zsh");
    // Disable zsh's `=command` filename expansion. Without this, harmless
    // diagnostics such as `echo ===` can be interpreted as command lookups.
    cmd.arg("-c")
        .arg(format!("unsetopt EQUALS 2>/dev/null\n{}", script));
    cmd
}

/// Kill an entire process tree. Unix: SIGKILL the process group (the child was
/// spawned as group leader). Windows: `taskkill /T /F` walks the tree for us.
#[cfg(unix)]
fn kill_process_tree(pgid: i32) {
    unsafe {
        libc::killpg(pgid, libc::SIGKILL);
    }
}

#[cfg(windows)]
fn kill_process_tree(pid: i32) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
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
    /// Kill every active command's process tree. Used during graceful
    /// shutdown so spawned children don't outlive the app.
    pub fn kill_all(&self) -> usize {
        let map = self.active.lock().unwrap();
        let count = map.len();
        for (_, pid) in map.iter() {
            kill_process_tree(*pid);
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
/// The command runs through the platform shell (see `shell_info`) in its own
/// process scope so the whole tree — including `&`-backgrounded children and
/// python subprocesses — can be killed together via `kill_command(request_id)`.
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

    let mut cmd = shell_command(&command);

    if let Some(ref dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    // On Unix, put the child in a new process group so killpg() can take down
    // the entire subtree, not just the /bin/zsh parent (which would orphan any
    // children the command spawned). Windows uses taskkill /T tree kills.
    #[cfg(unix)]
    cmd.process_group(0);

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // Register the child so kill_command can find it. Skip registration if no
    // request_id. (On Unix the pgid == pid since we made it a group leader.)
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
            // Timed out — kill the whole process tree, then report timeout.
            if let Some(rid) = request_id.as_ref() {
                if let Ok(map) = state.active.lock() {
                    if let Some(pgid) = map.get(rid) {
                        kill_process_tree(*pgid);
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

/// Kill a running command's entire process tree.
///
/// Terminates the whole tree so `&`-backgrounded children and python
/// subprocesses die too — not just the shell parent. On Unix this is
/// SIGTERM → grace period → SIGKILL on the process group; on Windows
/// `taskkill /T /F` takes the tree down in one shot.
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
        #[cfg(unix)]
        {
            // Graceful first: SIGTERM the whole group, grace period, then
            // force-kill anything still alive.
            unsafe {
                libc::killpg(pgid, libc::SIGTERM);
            }
            tokio::time::sleep(Duration::from_millis(1500)).await;
            kill_process_tree(pgid);
        }
        #[cfg(windows)]
        {
            kill_process_tree(pgid);
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
