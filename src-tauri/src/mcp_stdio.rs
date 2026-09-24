use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex},
    time::{timeout, Duration},
};

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<String, String>>>>>;
struct McpProcess {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Pending,
}
#[derive(Default)]
pub struct McpStdioState {
    inner: Mutex<HashMap<String, Arc<McpProcess>>>,
}

async fn stop(process: Arc<McpProcess>) {
    let mut child = process.child.lock().await;
    if let Some(pid) = child.id() {
        #[cfg(unix)]
        unsafe {
            libc::killpg(pid as i32, libc::SIGKILL);
        }
        #[cfg(target_os = "windows")]
        {
            let mut command = Command::new("taskkill");
            command
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x08000000);
            let _ = command.output().await;
        }
    }
    let _ = child.kill().await;
    for (_, sender) in process.pending.lock().await.drain() {
        let _ = sender.send(Err("MCP server stopped".into()));
    }
}

#[tauri::command]
pub async fn mcp_stdio_spawn(
    state: tauri::State<'_, McpStdioState>,
    server_id: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
) -> Result<(), String> {
    spawn(&state, server_id, command, args, env).await
}

async fn spawn(
    state: &McpStdioState,
    server_id: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
) -> Result<(), String> {
    let mut cmd = Command::new(command);
    cmd.args(args)
        .envs(env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let mut child = cmd.spawn().map_err(|_| "Failed to spawn MCP server")?;
    let stdin = child.stdin.take().ok_or("Missing MCP stdin")?;
    let stdout = child.stdout.take().ok_or("Missing MCP stdout")?;
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let process = Arc::new(McpProcess {
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        pending: pending.clone(),
    });
    let reader_process = Arc::downgrade(&process);
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if value.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
                continue;
            }
            if value.get("method").is_some() {
                // No sampling/elicitation capability is advertised. Reject server requests;
                // notifications (including progress) must never consume a pending response.
                if let (Some(id), Some(process)) = (value.get("id"), reader_process.upgrade()) {
                    let response = json!({"jsonrpc":"2.0", "id":id, "error":{"code":-32601,"message":"Unsupported client method"}}).to_string() + "\n";
                    let mut stdin = process.stdin.lock().await;
                    let _ = stdin.write_all(response.as_bytes()).await;
                    let _ = stdin.flush().await;
                }
                continue;
            }
            if value.get("result").is_none() && value.get("error").is_none() {
                continue;
            }
            if let Some(id) = value.get("id") {
                if let Some(sender) = pending.lock().await.remove(&id.to_string()) {
                    let _ = sender.send(Ok(line));
                }
            }
        }
        for (_, sender) in pending.lock().await.drain() {
            let _ = sender.send(Err("MCP server closed stdout".into()));
        }
    });
    let previous = state.inner.lock().await.insert(server_id, process);
    if let Some(old) = previous {
        stop(old).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_stdio_send(
    state: tauri::State<'_, McpStdioState>,
    server_id: String,
    message: String,
) -> Result<String, String> {
    send(&state, server_id, message).await
}

async fn send(state: &McpStdioState, server_id: String, message: String) -> Result<String, String> {
    let body: Value = serde_json::from_str(&message).map_err(|_| "Invalid MCP request")?;
    let process = state
        .inner
        .lock()
        .await
        .get(&server_id)
        .cloned()
        .ok_or("MCP server is not running")?;
    if body.get("method").and_then(Value::as_str) == Some("notifications/cancelled") {
        if let Some(id) = body.pointer("/params/requestId") {
            if let Some(sender) = process.pending.lock().await.remove(&id.to_string()) {
                let _ = sender.send(Err("MCP cancelled; execution status unknown".into()));
            }
        }
    }
    let id = body.get("id").map(Value::to_string);
    let receiver = if let Some(ref id) = id {
        let (sender, receiver) = oneshot::channel();
        let mut pending = process.pending.lock().await;
        if pending.contains_key(id) {
            return Err("Duplicate MCP request ID".into());
        }
        pending.insert(id.clone(), sender);
        Some(receiver)
    } else {
        None
    };
    let write = async {
        let mut stdin = process.stdin.lock().await;
        stdin.write_all((message + "\n").as_bytes()).await?;
        stdin.flush().await
    }
    .await;
    if write.is_err() {
        if let Some(ref id) = id {
            process.pending.lock().await.remove(id);
        }
        return Err("Failed to write MCP request; execution status unknown, do not replay".into());
    }
    // Notifications have no JSON-RPC response.
    let Some(receiver) = receiver else {
        return Ok(String::new());
    };
    let result = timeout(Duration::from_secs(300), receiver).await;
    if let Some(ref id) = id {
        process.pending.lock().await.remove(id);
    }
    match result {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("MCP response channel closed".into()),
        Err(_) => Err("MCP request timed out; execution status unknown, do not replay".into()),
    }
}

#[tauri::command]
pub async fn mcp_stdio_kill(
    state: tauri::State<'_, McpStdioState>,
    server_id: String,
) -> Result<(), String> {
    kill(&state, server_id).await
}

async fn kill(state: &McpStdioState, server_id: String) -> Result<(), String> {
    let process = state.inner.lock().await.remove(&server_id);
    if let Some(process) = process {
        stop(process).await;
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    const SERVER: &str = r#"import sys,json,threading,time
lock=threading.Lock()
def reply(req):
 time.sleep(0.03 if req['id']==1 else 0.001)
 with lock:
  print(json.dumps({'jsonrpc':'2.0','method':'notifications/progress','params':{}}),flush=True)
  print(json.dumps({'jsonrpc':'2.0','id':req['id'],'result':req.get('params',{})}),flush=True)
for line in sys.stdin:
 req=json.loads(line)
 if 'id' in req: threading.Thread(target=reply,args=(req,)).start()
"#;
    #[tokio::test]
    async fn independent_servers_match_out_of_order_responses_and_notifications() {
        let state = McpStdioState::default();
        for id in ["desktop", "blender"] {
            spawn(
                &state,
                id.into(),
                "python3".into(),
                vec!["-u".into(), "-c".into(), SERVER.into()],
                HashMap::new(),
            )
            .await
            .unwrap();
        }
        timeout(
            Duration::from_secs(2),
            send(
                &state,
                "desktop".into(),
                json!({"jsonrpc":"2.0","method":"notifications/initialized"}).to_string(),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        let request = |id, label| {
            json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"label":label}})
                .to_string()
        };
        let (a, b, c) = tokio::join!(
            send(&state, "desktop".into(), request(1, "a")),
            send(&state, "desktop".into(), request(2, "b")),
            send(&state, "blender".into(), request(1, "c"))
        );
        for (result, label) in [(a, "a"), (b, "b"), (c, "c")] {
            let value: Value = serde_json::from_str(&result.unwrap()).unwrap();
            assert_eq!(value["result"]["label"], label);
        }
        kill(&state, "desktop".into()).await.unwrap();
        assert!(send(&state, "blender".into(), request(3, "alive"))
            .await
            .is_ok());
        kill(&state, "blender".into()).await.unwrap();
    }
}
