use rand::{distributions::Alphanumeric, Rng};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::{sleep, timeout, Duration};

const CLI_PROTOCOL_VERSION: u32 = 1;
const CLI_TASK_TIMEOUT: Duration = Duration::from_secs(60 * 60);
const CLI_SCRIPT: &str = include_str!("../../cli/kunpeng.mjs");
const CLI_README: &str = include_str!("../../cli/README.md");

fn random_token(length: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

struct PendingTask {
    connection_id: String,
    response: oneshot::Sender<TaskReply>,
    events: mpsc::UnboundedSender<Value>,
}

struct CliInner {
    pending: Mutex<HashMap<String, PendingTask>>,
    ready: AtomicBool,
}

#[derive(Clone)]
pub struct CliState {
    inner: Arc<CliInner>,
}

impl Default for CliState {
    fn default() -> Self {
        Self {
            inner: Arc::new(CliInner {
                pending: Mutex::new(HashMap::new()),
                ready: AtomicBool::new(false),
            }),
        }
    }
}

#[derive(Debug)]
struct TaskReply {
    ok: bool,
    text: Option<String>,
    error: Option<String>,
    run_id: Option<String>,
    session: Option<String>,
    data: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliMessage {
    #[serde(rename = "type")]
    kind: String,
    token: Option<String>,
    request_id: Option<String>,
    prompt: Option<String>,
    session: Option<String>,
    auto_approve: Option<bool>,
    max_turns: Option<u32>,
    name: Option<String>,
    params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliTaskResponse {
    pub connection_id: String,
    pub request_id: String,
    pub ok: bool,
    pub text: Option<String>,
    pub error: Option<String>,
    pub run_id: Option<String>,
    pub session: Option<String>,
    pub data: Option<Value>,
}

fn cli_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".kunpeng").join("cli"))
}

fn cli_connection_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".kunpeng").join("cli.json"))
}

async fn write_line(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    value: Value,
) -> Result<(), String> {
    let line = serde_json::to_string(&value).map_err(|error| error.to_string())?;
    writer
        .write_all(format!("{}\n", line).as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    writer.flush().await.map_err(|error| error.to_string())
}

fn valid_request_id(value: Option<String>) -> Result<String, String> {
    let value = value.unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err("requestId 不能为空且不得超过 128 个字符".into());
    }
    Ok(trimmed.to_string())
}

fn normalized_session(value: Option<String>) -> String {
    let session = value.unwrap_or_else(|| "default".into());
    let trimmed = session.trim();
    if trimmed.is_empty() {
        "default".into()
    } else {
        trimmed.chars().take(128).collect()
    }
}

fn direct_tool_name(value: Option<String>) -> Result<String, String> {
    let name = value.unwrap_or_default();
    if matches!(
        name.as_str(),
        "image_generate" | "video_generate" | "canvas_generate" | "workshop_generate"
    ) {
        Ok(name)
    } else {
        Err("CLI 直连仅允许普通对话、画布或工坊的生图/生视频工具".into())
    }
}

fn emit_cancel(app: &tauri::AppHandle, connection_id: &str, request_id: &str, reason: &str) {
    let _ = app.emit_all(
        "cli-task-cancel",
        json!({
            "connectionId": connection_id,
            "requestId": request_id,
            "reason": reason,
        }),
    );
}

async fn handle_status(
    app: &tauri::AppHandle,
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    inner: &Arc<CliInner>,
    request_id: Option<String>,
) -> Result<(), String> {
    let active_tasks = inner.pending.lock().await.len();
    write_line(
        writer,
        json!({
            "type": "status",
            "requestId": request_id,
            "ok": true,
            "ready": inner.ready.load(Ordering::Acquire),
            "activeTasks": active_tasks,
            "protocol": CLI_PROTOCOL_VERSION,
            "version": app.package_info().version.to_string(),
        }),
    )
    .await
}

async fn handle_cancel(
    app: &tauri::AppHandle,
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    inner: &Arc<CliInner>,
    request_id: String,
) -> Result<(), String> {
    let pending = inner.pending.lock().await;
    let Some(task) = pending.get(&request_id) else {
        return write_line(
            writer,
            json!({"type": "cancel_result", "requestId": request_id, "ok": false, "error": "任务不存在或已结束"}),
        )
        .await;
    };
    emit_cancel(app, &task.connection_id, &request_id, "用户通过 CLI 请求停止");
    drop(pending);
    write_line(
        writer,
        json!({"type": "cancel_result", "requestId": request_id, "ok": true}),
    )
    .await
}

async fn run_task(
    app: tauri::AppHandle,
    inner: Arc<CliInner>,
    connection_id: String,
    message: CliMessage,
    reader: BufReader<tokio::net::tcp::OwnedReadHalf>,
    mut writer: tokio::net::tcp::OwnedWriteHalf,
) -> Result<(), String> {
    let request_id = valid_request_id(message.request_id)?;
    let is_direct_tool = message.kind == "run_tool";
    let direct_name = if is_direct_tool {
        Some(direct_tool_name(message.name)?)
    } else {
        None
    };
    let prompt = message.prompt.unwrap_or_default().trim().to_string();
    if !is_direct_tool && (prompt.is_empty() || prompt.len() > 256_000) {
        return write_line(
            &mut writer,
            json!({"type": "task_result", "requestId": request_id, "ok": false, "error": "prompt 不能为空且不得超过 256000 个字符"}),
        )
        .await;
    }
    let params = message.params.unwrap_or_else(|| json!({}));
    if is_direct_tool && !params.is_object() {
        return write_line(
            &mut writer,
            json!({"type": "task_result", "requestId": request_id, "ok": false, "error": "直连工具 params 必须是 JSON 对象"}),
        )
        .await;
    }
    if !inner.ready.load(Ordering::Acquire) {
        return write_line(
            &mut writer,
            json!({"type": "task_result", "requestId": request_id, "ok": false, "error": "鲲鹏执行桥尚未就绪，请稍后重试"}),
        )
        .await;
    }
    let (response_tx, mut response_rx) = oneshot::channel();
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    {
        let mut pending = inner.pending.lock().await;
        if pending.contains_key(&request_id) {
            drop(pending);
            return write_line(
                &mut writer,
                json!({"type": "task_result", "requestId": request_id, "ok": false, "error": "requestId 已被其他运行中任务使用"}),
            )
            .await;
        }
        pending.insert(
            request_id.clone(),
            PendingTask {
                connection_id: connection_id.clone(),
                response: response_tx,
                events: event_tx,
            },
        );
    }

    let session = direct_name
        .as_ref()
        .map(|name| format!("direct:{}", name))
        .unwrap_or_else(|| normalized_session(message.session));
    let emit_result = if let Some(name) = direct_name {
        // Direct generation bypasses the LLM only. Routing, paid-call
        // idempotency, validation, cancellation and artifact handling stay
        // inside Kunpeng's existing tool executor.
        app.emit_all(
            "cli-tool-request",
            json!({
                "connectionId": connection_id,
                "requestId": request_id,
                "session": session,
                "name": name,
                "params": params,
            }),
        )
    } else {
        app.emit_all(
            "cli-task-request",
            json!({
                "connectionId": connection_id,
                "requestId": request_id,
                "prompt": prompt,
                "session": session,
                "autoApprove": message.auto_approve.unwrap_or(false),
                "maxTurns": message.max_turns.unwrap_or(30).clamp(1, 50),
            }),
        )
    };
    if let Err(error) = emit_result {
        inner.pending.lock().await.remove(&request_id);
        return write_line(
            &mut writer,
            json!({"type": "task_result", "requestId": request_id, "ok": false, "error": format!("无法投递任务: {}", error)}),
        )
        .await;
    }

    let mut lines = reader.lines();
    let task_timeout = sleep(CLI_TASK_TIMEOUT);
    tokio::pin!(task_timeout);
    loop {
        tokio::select! {
            reply = &mut response_rx => {
                inner.pending.lock().await.remove(&request_id);
                return match reply {
                    Ok(reply) => write_line(&mut writer, json!({
                        "type": "task_result",
                        "requestId": request_id,
                        "ok": reply.ok,
                        "text": reply.text,
                        "error": reply.error,
                        "runId": reply.run_id,
                        "session": reply.session,
                        "data": reply.data,
                    })).await,
                    Err(_) => write_line(&mut writer, json!({
                        "type": "task_result", "requestId": request_id, "ok": false,
                        "error": "鲲鹏执行桥已关闭任务",
                    })).await,
                };
            }
            event = event_rx.recv() => {
                let Some(event) = event else { continue; };
                write_line(&mut writer, json!({
                    "type": "task_event", "requestId": request_id, "event": event,
                })).await?;
            }
            incoming = lines.next_line() => {
                match incoming {
                    Ok(Some(line)) => {
                        let Ok(message) = serde_json::from_str::<CliMessage>(&line) else { continue; };
                        match message.kind.as_str() {
                            "cancel_task" => {
                                if let Some(id) = message.request_id {
                                    handle_cancel(&app, &mut writer, &inner, id).await?;
                                }
                            }
                            "status" => handle_status(&app, &mut writer, &inner, message.request_id).await?,
                            _ => {
                                write_line(&mut writer, json!({
                                    "type": "error", "requestId": message.request_id,
                                    "error": "每个 CLI 连接同时只能运行一个任务",
                                })).await?;
                            }
                        }
                    }
                    Ok(None) => {
                        let removed = inner.pending.lock().await.remove(&request_id);
                        if removed.is_some() {
                            emit_cancel(&app, &connection_id, &request_id, "CLI 连接已断开");
                        }
                        return Err("CLI 连接已断开".into());
                    }
                    Err(error) => {
                        inner.pending.lock().await.remove(&request_id);
                        emit_cancel(&app, &connection_id, &request_id, "CLI 连接读取失败");
                        return Err(error.to_string());
                    }
                }
            }
            _ = &mut task_timeout => {
                inner.pending.lock().await.remove(&request_id);
                emit_cancel(&app, &connection_id, &request_id, "CLI 任务超过 60 分钟安全上限");
                return write_line(&mut writer, json!({
                    "type": "task_result", "requestId": request_id, "ok": false,
                    "error": "任务超过 60 分钟安全上限，已请求停止",
                })).await;
            }
        }
    }
}

async fn handle_connection(
    stream: TcpStream,
    app: tauri::AppHandle,
    inner: Arc<CliInner>,
    expected_token: String,
) -> Result<(), String> {
    let _ = stream.set_nodelay(true);
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    let first = timeout(Duration::from_secs(5), lines.next_line())
        .await
        .map_err(|_| "CLI 握手超时".to_string())?
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "CLI 在握手前关闭".to_string())?;
    let hello: CliMessage = serde_json::from_str(&first).map_err(|_| "CLI 握手格式无效".to_string())?;
    if hello.kind != "hello" || hello.token.as_deref() != Some(expected_token.as_str()) {
        let _ = write_line(
            &mut writer,
            json!({"type": "hello_error", "ok": false, "error": "CLI 身份校验失败，请重新启动鲲鹏后重试"}),
        )
        .await;
        return Err("CLI 身份校验失败".into());
    }
    let connection_id = random_token(24);
    write_line(
        &mut writer,
        json!({
            "type": "hello_ok",
            "ok": true,
            "protocol": CLI_PROTOCOL_VERSION,
            "version": app.package_info().version.to_string(),
            "ready": inner.ready.load(Ordering::Acquire),
        }),
    )
    .await?;

    while let Some(line) = timeout(Duration::from_secs(30), lines.next_line())
        .await
        .map_err(|_| "CLI 空闲连接超时".to_string())?
        .map_err(|error| error.to_string())?
    {
        let message: CliMessage = match serde_json::from_str(&line) {
            Ok(message) => message,
            Err(_) => {
                write_line(&mut writer, json!({"type": "error", "ok": false, "error": "NDJSON 消息格式无效"})).await?;
                continue;
            }
        };
        match message.kind.as_str() {
            "status" => handle_status(&app, &mut writer, &inner, message.request_id).await?,
            "cancel_task" => {
                let request_id = valid_request_id(message.request_id)?;
                handle_cancel(&app, &mut writer, &inner, request_id).await?;
            }
            "run_task" | "run_tool" => {
                let reader = lines.into_inner();
                return run_task(app, inner, connection_id, message, reader, writer).await;
            }
            _ => {
                write_line(&mut writer, json!({"type": "error", "requestId": message.request_id, "error": "未知 CLI 命令"})).await?;
            }
        }
    }
    Ok(())
}

fn cli_queue_dir() -> Option<PathBuf> {
    if let Some(root) = std::env::var_os("KUNPENG_QUEUE_DIR") {
        if !root.is_empty() {
            return Some(PathBuf::from(root));
        }
    }
    dirs::home_dir().map(|home| home.join(".kunpeng").join("queue"))
}

fn queue_valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn queue_atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    let temp = path.with_extension(format!("tmp-{}", random_token(12)));
    crate::commands::write_file_private(&temp, contents)?;
    #[cfg(target_os = "windows")]
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
    std::fs::rename(&temp, path).map_err(|error| format!("发布队列文件失败: {}", error))
}

fn queue_write_error(request_id: &str, error: &str) -> Result<(), String> {
    let Some(root) = cli_queue_dir() else { return Ok(()); };
    let result = json!({
        "type": "task_result",
        "requestId": request_id,
        "ok": false,
        "error": error,
        "completedAt": chrono::Utc::now().to_rfc3339(),
    });
    queue_atomic_write(&root.join("results").join(format!("{}.json", request_id)), &result.to_string())
}

fn queue_write_response(response: &CliTaskResponse) -> Result<(), String> {
    let Some(root) = cli_queue_dir() else { return Ok(()); };
    let result = json!({
        "type": "task_result",
        "requestId": response.request_id,
        "ok": response.ok,
        "text": response.text,
        "error": response.error,
        "runId": response.run_id,
        "session": response.session,
        "data": response.data,
        "completedAt": chrono::Utc::now().to_rfc3339(),
    });
    queue_atomic_write(&root.join("results").join(format!("{}.json", response.request_id)), &result.to_string())
}

fn queue_append_event(request_id: &str, event: &Value) -> Result<(), String> {
    let Some(root) = cli_queue_dir() else { return Ok(()); };
    let path = root.join("results").join(format!("{}.events.ndjson", request_id));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建队列结果目录失败: {}", error))?;
    }
    let line = json!({"type": "task_event", "requestId": request_id, "event": event});
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let mut file = options.open(&path).map_err(|error| format!("写入队列事件失败: {}", error))?;
    file.write_all(format!("{}\n", line).as_bytes())
        .map_err(|error| format!("写入队列事件失败: {}", error))
}

fn queue_heartbeat(app: &tauri::AppHandle, ready: bool) {
    let Some(root) = cli_queue_dir() else { return; };
    let status = json!({
        "type": "status",
        "ok": true,
        "ready": ready,
        "queue": true,
        "version": app.package_info().version.to_string(),
        "updatedAt": chrono::Utc::now().to_rfc3339(),
    });
    let _ = queue_atomic_write(&root.join("status.json"), &status.to_string());
}

fn queue_recover_processing() {
    let Some(root) = cli_queue_dir() else { return; };
    let Ok(entries) = std::fs::read_dir(root.join("processing")) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(request_id) = path.file_stem().and_then(|value| value.to_str()).map(str::to_string) else { continue; };
        if !queue_valid_id(&request_id) {
            let _ = std::fs::remove_file(path);
            continue;
        }
        // A processing file means the previous app exited after accepting the
        // task. Its tools may already have charged or produced artifacts, so
        // recovery is fail-closed and never automatically replays the request.
        let _ = queue_write_error(&request_id, "鲲鹏退出时任务仍在执行，结果未知；未自动重放，请核对任务记录和产物后再决定。");
        let _ = std::fs::remove_file(path);
    }
}

fn queue_process_inbox(app: &tauri::AppHandle) {
    let Some(root) = cli_queue_dir() else { return; };
    let Ok(entries) = std::fs::read_dir(root.join("inbox")) else { return; };
    let mut paths = entries.flatten().map(|entry| entry.path()).collect::<Vec<_>>();
    paths.sort();
    for path in paths {
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(request_id) = path.file_stem().and_then(|value| value.to_str()).map(str::to_string) else { continue; };
        if !queue_valid_id(&request_id) {
            let _ = std::fs::remove_file(path);
            continue;
        }
        let processing = root.join("processing").join(format!("{}.json", request_id));
        if std::fs::rename(&path, &processing).is_err() {
            continue;
        }
        let message = std::fs::read_to_string(&processing)
            .ok()
            .and_then(|raw| serde_json::from_str::<CliMessage>(&raw).ok());
        let Some(message) = message else {
            let _ = queue_write_error(&request_id, "队列任务格式无效，未执行。");
            let _ = std::fs::remove_file(processing);
            continue;
        };
        if message.request_id.as_deref() != Some(request_id.as_str()) {
            let _ = queue_write_error(&request_id, "队列 requestId 与文件名不一致，未执行。");
            let _ = std::fs::remove_file(processing);
            continue;
        }
        let connection_id = "queue".to_string();
        let emit_result = match message.kind.as_str() {
            "run_task" => {
                let prompt = message.prompt.unwrap_or_default().trim().to_string();
                if prompt.is_empty() || prompt.len() > 256_000 {
                    let _ = queue_write_error(&request_id, "prompt 为空或超过安全上限，未执行。");
                    let _ = std::fs::remove_file(processing);
                    continue;
                }
                app.emit_all(
                    "cli-task-request",
                    json!({
                        "connectionId": connection_id,
                        "requestId": request_id,
                        "prompt": prompt,
                        "session": normalized_session(message.session),
                        "autoApprove": message.auto_approve.unwrap_or(false),
                        "maxTurns": message.max_turns.unwrap_or(30).clamp(1, 50),
                    }),
                )
            }
            "run_tool" => {
                let name = match direct_tool_name(message.name) {
                    Ok(name) => name,
                    Err(error) => {
                        let _ = queue_write_error(&request_id, &error);
                        let _ = std::fs::remove_file(processing);
                        continue;
                    }
                };
                let params = message.params.unwrap_or_else(|| json!({}));
                if !params.is_object() {
                    let _ = queue_write_error(&request_id, "直连工具 params 必须是 JSON 对象。");
                    let _ = std::fs::remove_file(processing);
                    continue;
                }
                app.emit_all(
                    "cli-tool-request",
                    json!({
                        "connectionId": connection_id,
                        "requestId": request_id,
                        "session": format!("direct:{}", name),
                        "name": name,
                        "params": params,
                    }),
                )
            }
            _ => {
                let _ = queue_write_error(&request_id, "未知队列任务类型，未执行。");
                let _ = std::fs::remove_file(processing);
                continue;
            }
        };
        if let Err(error) = emit_result {
            let _ = queue_write_error(&request_id, &format!("队列任务投递失败: {}", error));
            let _ = std::fs::remove_file(processing);
        }
    }
}

fn queue_process_cancel(app: &tauri::AppHandle) {
    let Some(root) = cli_queue_dir() else { return; };
    let Ok(entries) = std::fs::read_dir(root.join("cancel")) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(request_id) = path.file_stem().and_then(|value| value.to_str()).map(str::to_string) else { continue; };
        if queue_valid_id(&request_id) {
            emit_cancel(app, "queue", &request_id, "用户通过远程队列请求停止");
        }
        let _ = std::fs::remove_file(path);
    }
}

fn start_queue(app: &tauri::AppHandle) {
    let inner = app.state::<CliState>().inner.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(root) = cli_queue_dir() else { return; };
        for directory in ["inbox", "processing", "results", "cancel"] {
            if let Err(error) = std::fs::create_dir_all(root.join(directory)) {
                eprintln!("[cli-queue] directory init failed: {}", error);
                return;
            }
        }
        queue_recover_processing();
        let mut heartbeat_ticks = 0u64;
        loop {
            let ready = inner.ready.load(Ordering::Acquire);
            // Polling stays responsive, while shared-drive heartbeat writes are
            // limited to once every three seconds instead of twice per second.
            if heartbeat_ticks % 6 == 0 {
                queue_heartbeat(&app, ready);
            }
            heartbeat_ticks = heartbeat_ticks.wrapping_add(1);
            if ready {
                queue_process_inbox(&app);
                queue_process_cancel(&app);
            }
            sleep(Duration::from_millis(500)).await;
        }
    });
}

pub fn start(app: &tauri::AppHandle) {
    start_queue(app);
    let inner = app.state::<CliState>().inner.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("[cli] local server bind failed: {}", error);
                return;
            }
        };
        let address = match listener.local_addr() {
            Ok(address) => address,
            Err(error) => {
                eprintln!("[cli] local server address failed: {}", error);
                return;
            }
        };
        let token = random_token(48);
        if let Some(path) = cli_connection_path() {
            let contents = json!({
                "protocol": CLI_PROTOCOL_VERSION,
                "host": "127.0.0.1",
                "port": address.port(),
                "token": token,
                "pid": std::process::id(),
                "version": app.package_info().version.to_string(),
            })
            .to_string();
            if let Err(error) = crate::commands::write_file_private(&path, &contents) {
                eprintln!("[cli] connection file write failed: {}", error);
                return;
            }
        }
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                sleep(Duration::from_millis(250)).await;
                continue;
            };
            let connection_inner = inner.clone();
            let connection_app = app.clone();
            let expected_token = token.clone();
            tauri::async_runtime::spawn(async move {
                let _ = handle_connection(stream, connection_app, connection_inner, expected_token).await;
            });
        }
    });
}

#[tauri::command]
pub fn cli_bridge_ready(state: tauri::State<'_, CliState>, ready: bool) -> Result<(), String> {
    state.inner.ready.store(ready, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub async fn cli_task_event(
    state: tauri::State<'_, CliState>,
    connection_id: String,
    request_id: String,
    event: Value,
) -> Result<(), String> {
    if connection_id == "queue" {
        if !queue_valid_id(&request_id) {
            return Err("队列 requestId 无效".into());
        }
        return queue_append_event(&request_id, &event);
    }
    let pending = state.inner.pending.lock().await;
    let task = pending.get(&request_id).ok_or_else(|| "CLI 任务已结束".to_string())?;
    if task.connection_id != connection_id {
        return Err("CLI 任务连接身份不匹配".into());
    }
    task.events.send(event).map_err(|_| "CLI 任务事件通道已关闭".to_string())
}

#[tauri::command]
pub async fn cli_task_respond(
    state: tauri::State<'_, CliState>,
    response: CliTaskResponse,
) -> Result<(), String> {
    if response.connection_id == "queue" {
        if !queue_valid_id(&response.request_id) {
            return Err("队列 requestId 无效".into());
        }
        queue_write_response(&response)?;
        if let Some(root) = cli_queue_dir() {
            let _ = std::fs::remove_file(root.join("processing").join(format!("{}.json", response.request_id)));
        }
        return Ok(());
    }
    let pending = {
        let mut tasks = state.inner.pending.lock().await;
        let task = tasks.get(&response.request_id).ok_or_else(|| "CLI 任务已结束".to_string())?;
        if task.connection_id != response.connection_id {
            return Err("CLI 任务连接身份不匹配".into());
        }
        tasks.remove(&response.request_id).ok_or_else(|| "CLI 任务已结束".to_string())?
    };
    pending
        .response
        .send(TaskReply {
            ok: response.ok,
            text: response.text,
            error: response.error,
            run_id: response.run_id,
            session: response.session,
            data: response.data,
        })
        .map_err(|_| "CLI 任务连接已断开".to_string())
}

fn install_script(path: &Path, contents: &str, executable: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建 CLI 目录失败: {}", error))?;
    }
    std::fs::write(path, contents).map_err(|error| format!("写入 CLI 文件失败: {}", error))?;
    #[cfg(unix)]
    if executable {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("设置 CLI 执行权限失败: {}", error))?;
    }
    Ok(())
}

#[tauri::command]
pub fn cli_install() -> Result<Value, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户目录".to_string())?;
    let dir = cli_dir().ok_or_else(|| "无法定位 CLI 目录".to_string())?;
    let script = dir.join("kunpeng.mjs");
    let readme = dir.join("README.md");
    install_script(&script, CLI_SCRIPT, false)?;
    install_script(&readme, CLI_README, false)?;

    #[cfg(not(target_os = "windows"))]
    let command = home.join(".local").join("bin").join("kunpeng");
    #[cfg(target_os = "windows")]
    let command = home.join(".kunpeng").join("bin").join("kunpeng.cmd");

    #[cfg(not(target_os = "windows"))]
    let wrapper = r#"#!/bin/sh
if command -v node >/dev/null 2>&1; then
  exec node "$HOME/.kunpeng/cli/kunpeng.mjs" "$@"
fi
if [ -x "$HOME/.kunpeng/dsh/0.2.1-rc.2/node/bin/node" ]; then
  exec "$HOME/.kunpeng/dsh/0.2.1-rc.2/node/bin/node" "$HOME/.kunpeng/cli/kunpeng.mjs" "$@"
fi
echo "kunpeng: 未找到 Node.js" >&2
exit 1
"#;
    #[cfg(target_os = "windows")]
    let wrapper = r#"@echo off
where node >nul 2>nul
if %errorlevel%==0 (
  node "%USERPROFILE%\.kunpeng\cli\kunpeng.mjs" %*
  exit /b %errorlevel%
)
if exist "%USERPROFILE%\.kunpeng\dsh\0.2.1-rc.2\node\node.exe" (
  "%USERPROFILE%\.kunpeng\dsh\0.2.1-rc.2\node\node.exe" "%USERPROFILE%\.kunpeng\cli\kunpeng.mjs" %*
  exit /b %errorlevel%
)
echo kunpeng: Node.js not found 1>&2
exit /b 1
"#;
    install_script(&command, wrapper, true)?;
    Ok(json!({
        "command": command.to_string_lossy(),
        "script": script.to_string_lossy(),
        "readme": readme.to_string_lossy(),
    }))
}

pub async fn shutdown(app: &tauri::AppHandle) {
    let inner = app.state::<CliState>().inner.clone();
    inner.ready.store(false, Ordering::Release);
    queue_heartbeat(app, false);
    let tasks = {
        let mut pending = inner.pending.lock().await;
        pending.drain().map(|(id, task)| (id, task.connection_id)).collect::<Vec<_>>()
    };
    for (request_id, connection_id) in tasks {
        emit_cancel(app, &connection_id, &request_id, "鲲鹏正在退出");
    }
    if let Some(path) = cli_connection_path() {
        let _ = std::fs::remove_file(path);
    }
}
