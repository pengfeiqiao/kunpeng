use std::collections::HashMap;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

struct McpProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

pub struct McpStdioState {
    inner: Mutex<Option<McpProcess>>,
}

impl Default for McpStdioState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

/// Spawn an MCP stdio server process
#[tauri::command]
pub async fn mcp_stdio_spawn(
    state: tauri::State<'_, McpStdioState>,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
) -> Result<(), String> {
    let mut cmd = Command::new(&command);
    cmd.args(&args);
    for (k, v) in &env {
        cmd.env(k, v);
    }
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    // GUI apps must pass CREATE_NO_WINDOW on Windows or every console-based
    // MCP server (node/python) flashes a terminal window on spawn (tokio
    // Command has an inherent creation_flags method on Windows).
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn MCP stdio process '{}': {}", command, e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;

    let mut guard = state.inner.lock().await;

    // Kill existing process if any
    if let Some(mut old) = guard.take() {
        let _ = old.child.kill().await;
    }

    *guard = Some(McpProcess {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    });

    Ok(())
}

/// Send a JSON-RPC message to the MCP stdio server and read the response
#[tauri::command]
pub async fn mcp_stdio_send(
    state: tauri::State<'_, McpStdioState>,
    message: String,
) -> Result<String, String> {
    let mut guard = state.inner.lock().await;
    let process = guard
        .as_mut()
        .ok_or_else(|| "MCP stdio process not running".to_string())?;

    // Write message to stdin (must end with newline)
    let msg = if message.ends_with('\n') {
        message
    } else {
        format!("{}\n", message)
    };

    process
        .stdin
        .write_all(msg.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to MCP stdin: {}", e))?;

    process
        .stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush MCP stdin: {}", e))?;

    // Read lines from stdout until we get a valid JSON line
    // Some MCP servers may output non-JSON lines (logs, warnings)
    loop {
        let mut line = String::new();
        let read_result = timeout(Duration::from_secs(30), process.stdout.read_line(&mut line))
            .await
            .map_err(|_| "MCP stdio response timed out (30s)".to_string())?
            .map_err(|e| format!("Failed to read from MCP stdout: {}", e))?;

        if read_result == 0 {
            return Err("MCP stdio process closed stdout unexpectedly".to_string());
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Check if this looks like a JSON-RPC response
        if trimmed.starts_with('{') {
            // Validate it's parseable JSON
            if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
                return Ok(trimmed.to_string());
            }
        }

        // Non-JSON line — skip and keep reading
    }
}

/// Kill the MCP stdio server process
#[tauri::command]
pub async fn mcp_stdio_kill(state: tauri::State<'_, McpStdioState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if let Some(mut process) = guard.take() {
        let _ = process.child.kill().await;
    }
    Ok(())
}
