use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio::time::{timeout, Duration};

const DSH_VERSION: &str = "0.1.0-rc.6";
const DSH_RUNTIME_REVISION: &str = "0.1.0-rc.6-kunpeng.7";
const DSH_EVENT_PREFIX: &str = "__KUNPENG_DSH_EVENT__";

#[derive(Clone)]
struct BridgeInfo {
    address: String,
    token: String,
}

struct DshProcess {
    instance_id: String,
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    temp_dir: PathBuf,
}

struct DshInner {
    processes: Mutex<HashMap<String, DshProcess>>,
    tools: RwLock<HashMap<String, Vec<Value>>>,
    pending_tools: Mutex<HashMap<String, PendingTool>>,
    bridge: Mutex<Option<BridgeInfo>>,
    runtime_install: Mutex<()>,
}

#[derive(Clone)]
pub struct DshState {
    inner: Arc<DshInner>,
}

impl Default for DshState {
    fn default() -> Self {
        Self {
            inner: Arc::new(DshInner {
                processes: Mutex::new(HashMap::new()),
                tools: RwLock::new(HashMap::new()),
                pending_tools: Mutex::new(HashMap::new()),
                bridge: Mutex::new(None),
                runtime_install: Mutex::new(()),
            }),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshStartRequest {
    pub run_id: String,
    pub instance_id: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub persona: String,
    pub workspace: String,
    pub max_tokens: Option<u64>,
    pub context_window: Option<u64>,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DshStartResponse {
    pub run_id: String,
    pub instance_id: String,
    pub version: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcpLineEvent {
    run_id: String,
    instance_id: String,
    line: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HarnessEvent {
    run_id: String,
    instance_id: String,
    event: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolCallEvent {
    run_id: String,
    instance_id: String,
    request_id: String,
    name: String,
    arguments: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResponse {
    pub run_id: String,
    pub instance_id: String,
    pub request_id: String,
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug)]
struct ToolReply {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

struct PendingTool {
    run_id: String,
    instance_id: String,
    sender: oneshot::Sender<ToolReply>,
}

fn pending_tool_key(run_id: &str, instance_id: &str, request_id: &str) -> String {
    format!("{}\u{1f}{}\u{1f}{}", run_id, instance_id, request_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeMessage {
    #[serde(rename = "type")]
    kind: String,
    token: Option<String>,
    run_id: Option<String>,
    instance_id: Option<String>,
    request_id: Option<String>,
    name: Option<String>,
    arguments: Option<Value>,
}

fn random_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

fn run_instance_key(run_id: &str, instance_id: &str) -> String {
    // \u{1f} (unit separator) can never appear in a UUID/instance id, unlike
    // the \0 separator which allowed "a\0b"+"c" to collide with "a"+"b\0c".
    format!("{}\u{1f}{}", run_id, instance_id)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn bundled_runtime_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(resources) = app.path_resolver().resource_dir() {
        candidates.push(resources.join("_up_").join("dsh-runtime"));
        candidates.push(resources.join("dsh-runtime"));
    }
    if let Some(repo_root) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
        candidates.push(repo_root.join("dsh-runtime"));
    }
    candidates
}

fn ensure_runtime(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户目录".to_string())?;
    let root = home.join(".kunpeng").join("dsh").join(DSH_VERSION);
    let marker = root.join(".ready");
    let required = [
        root.join("node").join("bin").join("node"),
        root.join("node_modules")
            .join("@deepseek-ai")
            .join("dsh")
            .join("package.json"),
        root.join("node_modules")
            .join("@deepseek-ai")
            .join("dsh-llm-deepseek")
            .join("lib")
            .join("index.js"),
        root.join("kunpeng-acp-host.mjs"),
        root.join("kunpeng-mcp-server.mjs"),
    ];
    let marker_matches = std::fs::read_to_string(&marker)
        .map(|value| value.trim() == DSH_RUNTIME_REVISION)
        .unwrap_or(false);
    if marker_matches && required.iter().all(|path| path.exists()) {
        return Ok(root);
    }

    let source = bundled_runtime_candidates(app)
        .into_iter()
        .find(|candidate| {
            candidate.join("node_modules").exists()
                && candidate.join("node").join("bin").join("node").exists()
        })
        .ok_or_else(|| "DeepSeek Harness 运行时未随应用部署，请重新安装完整版本".to_string())?;

    let staging = root.with_extension(format!("installing-{}", random_token()));
    let _ = std::fs::remove_dir_all(&staging);
    copy_dir_recursive(&source, &staging)
        .map_err(|error| format!("部署 DeepSeek Harness 运行时失败: {}", error))?;
    std::fs::write(staging.join(".ready"), DSH_RUNTIME_REVISION)
        .map_err(|error| format!("写入 Harness 版本标记失败: {}", error))?;
    let _ = std::fs::remove_dir_all(&root);
    std::fs::rename(&staging, &root)
        .map_err(|error| format!("启用 DeepSeek Harness 运行时失败: {}", error))?;
    Ok(root)
}

async fn ensure_bridge(app: &tauri::AppHandle, inner: Arc<DshInner>) -> Result<BridgeInfo, String> {
    let mut guard = inner.bridge.lock().await;
    if let Some(info) = guard.as_ref() {
        return Ok(info.clone());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("启动 Harness 工具桥失败: {}", error))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("读取 Harness 工具桥地址失败: {}", error))?
        .to_string();
    let info = BridgeInfo {
        address,
        token: random_token(),
    };
    let accept_info = info.clone();
    let accept_inner = inner.clone();
    let accept_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
            };
            let connection_inner = accept_inner.clone();
            let connection_app = accept_app.clone();
            let expected_token = accept_info.token.clone();
            tauri::async_runtime::spawn(async move {
                let _ = handle_bridge_connection(
                    stream,
                    connection_app,
                    connection_inner,
                    expected_token,
                )
                .await;
            });
        }
    });
    *guard = Some(info.clone());
    Ok(info)
}

async fn write_bridge_line(
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

async fn handle_bridge_connection(
    stream: TcpStream,
    app: tauri::AppHandle,
    inner: Arc<DshInner>,
    expected_token: String,
) -> Result<(), String> {
    // The mcp-server client side already sets no-delay/keepalive; mirror
    // no-delay on the accepted side so tool-call replies are not held back
    // by Nagle. Best-effort: loopback never fails this in practice.
    let _ = stream.set_nodelay(true);
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    let first = timeout(Duration::from_secs(5), lines.next_line())
        .await
        .map_err(|_| "Harness 工具桥握手超时".to_string())?
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Harness 工具桥在握手前关闭".to_string())?;
    let hello: BridgeMessage =
        serde_json::from_str(&first).map_err(|_| "Harness 工具桥握手格式无效".to_string())?;
    if hello.kind != "hello" || hello.token.as_deref() != Some(expected_token.as_str()) {
        return Err("Harness 工具桥身份校验失败".to_string());
    }
    let run_id = hello.run_id.unwrap_or_default();
    let instance_id = hello.instance_id.unwrap_or_default();
    if run_id.is_empty() || instance_id.is_empty() {
        return Err("Harness 工具桥运行身份缺失".to_string());
    }
    let run_key = run_instance_key(&run_id, &instance_id);
    write_bridge_line(&mut writer, json!({ "type": "hello_ok" })).await?;

    while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
        let message: BridgeMessage = match serde_json::from_str(&line) {
            Ok(message) => message,
            Err(_) => continue,
        };
        let Some(request_id) = message.request_id else {
            continue;
        };
        match message.kind.as_str() {
            "list_tools" => {
                let tools = inner
                    .tools
                    .read()
                    .await
                    .get(&run_key)
                    .cloned()
                    .unwrap_or_default();
                write_bridge_line(
                    &mut writer,
                    json!({ "requestId": request_id, "ok": true, "result": tools }),
                )
                .await?;
            }
            "call_tool" => {
                let Some(name) = message.name else {
                    continue;
                };
                let (sender, receiver) = oneshot::channel();
                let pending_key = pending_tool_key(&run_id, &instance_id, &request_id);
                inner.pending_tools.lock().await.insert(
                    pending_key.clone(),
                    PendingTool {
                        run_id: run_id.clone(),
                        instance_id: instance_id.clone(),
                        sender,
                    },
                );
                if let Err(error) = app.emit_all(
                    "dsh-tool-call",
                    ToolCallEvent {
                        run_id: run_id.clone(),
                        instance_id: instance_id.clone(),
                        request_id: request_id.clone(),
                        name,
                        arguments: message.arguments.unwrap_or_else(|| json!({})),
                    },
                ) {
                    // The frontend never saw this call — drop the pending
                    // entry now instead of leaking it until the 30min timeout.
                    inner.pending_tools.lock().await.remove(&pending_key);
                    return Err(error.to_string());
                }
                let reply = tokio::select! {
                    reply = timeout(Duration::from_secs(30 * 60), receiver) => Some(reply),
                    incoming = lines.next_line() => {
                        inner.pending_tools.lock().await.remove(&pending_key);
                        let _ = app.emit_all(
                            "dsh-tool-cancel",
                            ToolCallEvent {
                                run_id: run_id.clone(),
                                instance_id: instance_id.clone(),
                                request_id: request_id.clone(),
                                name: "bridge_disconnected".to_string(),
                                arguments: json!({}),
                            },
                        );
                        return match incoming {
                            Ok(None) => Err("Harness 工具桥在工具执行期间断开：该工具可能已执行并产生副作用（例如已生成素材），请核对任务记录后再决定是否重试".to_string()),
                            Ok(Some(_)) => Err("Harness 工具桥在等待工具结果时收到意外消息".to_string()),
                            Err(error) => Err(error.to_string()),
                        };
                    }
                };
                inner.pending_tools.lock().await.remove(&pending_key);
                let response = match reply {
                    Some(Ok(Ok(reply))) => json!({
                        "requestId": request_id,
                        "ok": reply.ok,
                        "result": reply.result,
                        "error": reply.error,
                    }),
                    Some(Ok(Err(_))) => json!({
                        "requestId": request_id,
                        "ok": false,
                        "error": "鲲鹏工具执行已中止",
                    }),
                    Some(Err(_)) => json!({
                        "requestId": request_id,
                        "ok": false,
                        "error": "鲲鹏工具执行超时",
                    }),
                    None => unreachable!(),
                };
                write_bridge_line(&mut writer, response).await?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn normalized_base_url(input: &str) -> String {
    let trimmed = input.trim().trim_end_matches('/');
    trimmed
        .strip_suffix("/anthropic")
        .unwrap_or(trimmed)
        .trim_end_matches('/')
        .to_string()
}

#[tauri::command]
pub async fn dsh_set_tools(
    state: tauri::State<'_, DshState>,
    run_id: String,
    instance_id: String,
    tools: Vec<Value>,
) -> Result<(), String> {
    state
        .inner
        .tools
        .write()
        .await
        .insert(run_instance_key(&run_id, &instance_id), tools);
    Ok(())
}

#[tauri::command]
pub async fn dsh_tool_respond(
    state: tauri::State<'_, DshState>,
    response: ToolResponse,
) -> Result<(), String> {
    let pending_key = pending_tool_key(
        &response.run_id,
        &response.instance_id,
        &response.request_id,
    );
    let mut pending_tools = state.inner.pending_tools.lock().await;
    let matches_instance = pending_tools
        .get(&pending_key)
        .map(|pending| {
            pending.run_id == response.run_id && pending.instance_id == response.instance_id
        })
        .ok_or_else(|| "Harness 工具请求已结束".to_string())?;
    if !matches_instance {
        return Err("Harness 工具响应来自已失效的运行实例".to_string());
    }
    let pending = pending_tools
        .remove(&pending_key)
        .ok_or_else(|| "Harness 工具请求已结束".to_string())?;
    drop(pending_tools);
    let _ = pending.sender.send(ToolReply {
        ok: response.ok,
        result: response.result,
        error: response.error,
    });
    Ok(())
}

#[tauri::command]
pub async fn dsh_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, DshState>,
    request: DshStartRequest,
) -> Result<DshStartResponse, String> {
    if request.api_key.trim().is_empty() {
        return Err("DeepSeek API Key 未配置".to_string());
    }
    if request.run_id.trim().is_empty() {
        return Err("Harness run id 不能为空".to_string());
    }
    if request.instance_id.trim().is_empty() {
        return Err("Harness instance id 不能为空".to_string());
    }
    // Runtime deployment copies a bundled Node tree and replaces the active
    // directory. Two assistants can start together, so serialize deployment
    // and keep the blocking filesystem work off the async command thread.
    let runtime = {
        let _install_guard = state.inner.runtime_install.lock().await;
        let runtime_app = app.clone();
        tokio::task::spawn_blocking(move || ensure_runtime(&runtime_app))
            .await
            .map_err(|error| format!("部署 Harness 运行时任务失败: {}", error))??
    };
    let bridge = ensure_bridge(&app, state.inner.clone()).await?;
    let node = runtime.join("node").join("bin").join("node");
    let acp_bin = runtime
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh-acp-demo")
        .join("lib")
        .join("bin.js");
    let mcp_server = runtime.join("kunpeng-mcp-server.mjs");
    let acp_host = runtime.join("kunpeng-acp-host.mjs");
    // The Cordis loader resolves bare package names relative to the CONFIG
    // file's directory (dsh-app-boot sets ctx.baseUrl to it). The run config
    // lives in ~/.kunpeng/dsh/runs/<id>/, outside the deployed runtime root,
    // so a bare "@deepseek-ai/dsh-llm-deepseek" specifier cannot resolve there:
    // boot fails and disposes the half-mounted tree (ACP already mounted),
    // which surfaces as "the ACP bridge has been disposed" on session/new.
    // Reference the adapter by absolute entry path, exactly like the ACP host.
    let llm_deepseek = runtime
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh-llm-deepseek")
        .join("lib")
        .join("index.js");
    for required in [&node, &acp_bin, &mcp_server, &acp_host, &llm_deepseek] {
        if !required.exists() {
            return Err(format!("Harness 运行时文件缺失: {}", required.display()));
        }
    }

    let home = dirs::home_dir().ok_or_else(|| "无法定位用户目录".to_string())?;
    let temp_dir = home.join(".kunpeng").join("dsh").join("runs").join(format!(
        "{}-{}",
        request.run_id,
        random_token()
    ));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("创建 Harness 临时目录失败: {}", error))?;
    let sessions = home.join(".kunpeng").join("dsh").join("sessions");
    std::fs::create_dir_all(&sessions)
        .map_err(|error| format!("创建 Harness 会话目录失败: {}", error))?;

    let config = json!([
        {
            "id": "llm-deepseek",
            "name": llm_deepseek.to_string_lossy(),
            "config": {
                "apiKeyEnv": "DEEPSEEK_API_KEY",
                "baseURL": normalized_base_url(&request.base_url),
                "thinking": "enabled",
                "reasoningEffort": "high",
                "maxTokens": request.max_tokens.unwrap_or(32768),
                "defaultContextWindow": request.context_window.unwrap_or(1_000_000),
                "models": [{
                    "id": request.model,
                    "name": request.model,
                    "contextWindow": request.context_window.unwrap_or(1_000_000),
                    "maxTokens": request.max_tokens.unwrap_or(32768)
                }]
            }
        },
        {
            "id": "acp",
            "name": acp_host.to_string_lossy(),
            "config": {
                "provider": "deepseek-official",
                "model": request.model,
                "persona": request.persona,
                "workspaceContext": false,
                "skills": { "enabled": false },
                "toolBash": false,
                "toolJobs": false,
                "goals": false,
                "maxParallelToolCalls": 1,
                "persistenceRoot": sessions.to_string_lossy(),
                "contextWindow": request.context_window.unwrap_or(1_000_000),
                "packChunks": true,
                "persistenceCompression": "none",
                "mcp": {
                    "transport": "stdio",
                    "serverName": "kunpeng",
                    "command": node.to_string_lossy(),
                    "args": [mcp_server.to_string_lossy()],
                    "env": {
                        "KUNPENG_TOOL_BRIDGE_ADDR": bridge.address,
                        "KUNPENG_TOOL_BRIDGE_TOKEN": bridge.token,
                        "KUNPENG_DSH_RUN_ID": request.run_id,
                        "KUNPENG_DSH_INSTANCE_ID": request.instance_id
                    },
                    "cwd": request.workspace,
                    "toolCallTimeoutMs": 1_800_000,
                    "failOnStartupError": true,
                    "reconnect": {
                        "enabled": true,
                        "initialDelayMs": 250,
                        "maxDelayMs": 10_000,
                        "maxAttempts": 12
                    }
                }
            }
        }
    ]);
    let config_path = temp_dir.join("cordis.yml");
    std::fs::write(
        &config_path,
        serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("写入 Harness 临时配置失败: {}", error))?;

    let secret = request.api_key.trim().to_string();
    let mut command = Command::new(&node);
    command
        .arg(&acp_bin)
        .arg("--config")
        .arg(&config_path)
        .current_dir(&request.workspace)
        .env_clear()
        .env("HOME", &home)
        .env(
            "PATH",
            "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        )
        .env("TMPDIR", std::env::temp_dir())
        .env("DEEPSEEK_API_KEY", &secret)
        .env("DEEPSEEK_BASE_URL", normalized_base_url(&request.base_url))
        .env("DSH_HOME", home.join(".kunpeng").join("dsh").join("home"))
        .env("DSH_TELEMETRY_MODE", "DISABLED")
        .env("NODE_USE_ENV_PROXY", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let inherited_http_proxy = std::env::var("HTTP_PROXY")
        .or_else(|_| std::env::var("http_proxy"))
        .ok();
    let inherited_https_proxy = std::env::var("HTTPS_PROXY")
        .or_else(|_| std::env::var("https_proxy"))
        .ok();
    if let Some(proxy) = request
        .http_proxy
        .filter(|value| !value.trim().is_empty())
        .or(inherited_http_proxy)
    {
        command.env("HTTP_PROXY", proxy);
    }
    if let Some(proxy) = request
        .https_proxy
        .filter(|value| !value.trim().is_empty())
        .or(inherited_https_proxy)
    {
        command.env("HTTPS_PROXY", proxy);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 DeepSeek Harness 失败: {}", error))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法连接 Harness stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法连接 Harness stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法连接 Harness stderr".to_string())?;

    let stdout_app = app.clone();
    let stdout_run = request.run_id.clone();
    let stdout_instance = request.instance_id.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = stdout_app.emit_all(
                "dsh-acp-line",
                AcpLineEvent {
                    run_id: stdout_run.clone(),
                    instance_id: stdout_instance.clone(),
                    line,
                },
            );
        }
        let _ = stdout_app.emit_all(
            "dsh-acp-closed",
            AcpLineEvent {
                run_id: stdout_run,
                instance_id: stdout_instance,
                line: "Harness ACP 通道已关闭".to_string(),
            },
        );
    });

    let stderr_app = app.clone();
    let stderr_run = request.run_id.clone();
    let stderr_instance = request.instance_id.clone();
    let stderr_secret = secret.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(raw_event) = line.strip_prefix(DSH_EVENT_PREFIX) {
                if let Ok(event) = serde_json::from_str::<Value>(raw_event) {
                    let _ = stderr_app.emit_all(
                        "dsh-harness-event",
                        HarnessEvent {
                            run_id: stderr_run.clone(),
                            instance_id: stderr_instance.clone(),
                            event,
                        },
                    );
                    continue;
                }
            }
            // DSH diagnostics must never carry credentials into the WebView.
            let redacted = line.replace(&stderr_secret, "[REDACTED]");
            let lower = redacted.to_ascii_lowercase();
            // Only genuine auth/credential failures get the friendly collapse;
            // a line that merely mentions "api key" (e.g. a model-not-found
            // hint) must keep its real text or the user chases the wrong fix.
            let looks_auth = (lower.contains("api key") || lower.contains("apikey"))
                && (lower.contains("401")
                    || lower.contains("unauthorized")
                    || lower.contains("authentication")
                    || lower.contains("missing_credential")
                    || lower.contains("invalid")
                    || lower.contains("missing"));
            let safe = if looks_auth {
                "Harness 认证失败，请检查 DeepSeek API Key 设置".to_string()
            } else {
                redacted.chars().take(1200).collect::<String>()
            };
            let _ = stderr_app.emit_all(
                "dsh-acp-stderr",
                AcpLineEvent {
                    run_id: stderr_run.clone(),
                    instance_id: stderr_instance.clone(),
                    line: safe,
                },
            );
        }
    });

    let old = {
        let mut processes = state.inner.processes.lock().await;
        let old = processes.remove(&request.run_id);
        processes.insert(
            request.run_id.clone(),
            DshProcess {
                instance_id: request.instance_id.clone(),
                child,
                stdin: Arc::new(Mutex::new(stdin)),
                temp_dir,
            },
        );
        old
    };
    if let Some(mut old) = old {
        // Kill outside the global process-map lock so a slow kill cannot
        // block dsh_stop/dsh_send for other runs. Then scrub the replaced
        // instance's leftover tool registry and pending tool calls —
        // otherwise they linger until stop_all, and a stale pending entry
        // would only resolve on the 30-minute timeout.
        let old_instance = old.instance_id.clone();
        let _ = old.child.kill().await;
        let _ = std::fs::remove_dir_all(old.temp_dir);
        state
            .inner
            .tools
            .write()
            .await
            .remove(&run_instance_key(&request.run_id, &old_instance));
        state
            .inner
            .pending_tools
            .lock()
            .await
            .retain(|_, pending| {
                pending.run_id != request.run_id || pending.instance_id != old_instance
            });
    }
    Ok(DshStartResponse {
        run_id: request.run_id,
        instance_id: request.instance_id,
        version: DSH_VERSION,
    })
}

#[tauri::command]
pub async fn dsh_send(
    state: tauri::State<'_, DshState>,
    run_id: String,
    instance_id: String,
    message: String,
) -> Result<(), String> {
    // Clone the per-process stdin handle before awaiting I/O. Holding the
    // global process map while a large prompt is back-pressured would block
    // dsh_stop and every other Harness run.
    let stdin = {
        let processes = state.inner.processes.lock().await;
        let process = processes
            .get(&run_id)
            .ok_or_else(|| "DeepSeek Harness 尚未启动".to_string())?;
        if process.instance_id != instance_id {
            return Err("DeepSeek Harness 运行实例已失效".to_string());
        }
        process.stdin.clone()
    };
    let mut stdin = stdin.lock().await;
    stdin
        .write_all(format!("{}\n", message.trim_end()).as_bytes())
        .await
        .map_err(|error| format!("写入 Harness 请求失败: {}", error))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("刷新 Harness 请求失败: {}", error))
}

#[tauri::command]
pub async fn dsh_stop(
    state: tauri::State<'_, DshState>,
    run_id: String,
    instance_id: String,
) -> Result<(), String> {
    let process = {
        let mut processes = state.inner.processes.lock().await;
        if processes
            .get(&run_id)
            .map(|process| process.instance_id == instance_id)
            .unwrap_or(false)
        {
            processes.remove(&run_id)
        } else {
            None
        }
    };
    if let Some(mut process) = process {
        let _ = process.child.kill().await;
        let _ = std::fs::remove_dir_all(process.temp_dir);
    }
    state
        .inner
        .tools
        .write()
        .await
        .remove(&run_instance_key(&run_id, &instance_id));
    state
        .inner
        .pending_tools
        .lock()
        .await
        .retain(|_, pending| pending.run_id != run_id || pending.instance_id != instance_id);
    Ok(())
}

impl DshState {
    pub async fn stop_all(&self) -> usize {
        let drained = {
            let mut processes = self.inner.processes.lock().await;
            processes.drain().collect::<Vec<_>>()
        };
        let count = drained.len();
        // Kill outside the lock: awaiting child.kill() while holding the map
        // would stall dsh_stop/dsh_send for every other run.
        for (_, mut process) in drained {
            let _ = process.child.kill().await;
            let _ = std::fs::remove_dir_all(process.temp_dir);
        }
        self.inner.pending_tools.lock().await.clear();
        self.inner.tools.write().await.clear();
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_tool_key_isolates_same_run_id_across_instances() {
        let old = pending_tool_key("run-1", "inst-old", "req-9");
        let new = pending_tool_key("run-1", "inst-new", "req-9");
        assert_ne!(
            old, new,
            "a late tool result from a replaced instance must not match the new instance's pending entry"
        );
        assert!(old.starts_with("run-1"));
    }

    #[test]
    fn run_instance_key_does_not_collide_on_boundary_characters() {
        // runId "a\0b" + instance "c" must not collide with runId "a" + instance "b\0c".
        assert_ne!(run_instance_key("a\0b", "c"), run_instance_key("a", "b\0c"));
        assert_ne!(run_instance_key("run", "i1"), run_instance_key("run", "i2"));
    }

    #[test]
    fn normalized_base_url_strips_anthropic_suffix_and_trailing_slashes() {
        assert_eq!(
            normalized_base_url("https://api.deepseek.com/anthropic/"),
            "https://api.deepseek.com"
        );
        assert_eq!(
            normalized_base_url("https://api.deepseek.com/"),
            "https://api.deepseek.com"
        );
        assert_eq!(normalized_base_url("http://127.0.0.1:8317"), "http://127.0.0.1:8317");
    }
}
