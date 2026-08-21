use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::Duration,
};
use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Default)]
pub struct BrowserState {
    inner: Mutex<BrowserSession>,
}

#[derive(Default)]
struct BrowserSession {
    child: Option<Child>,
    port: Option<u16>,
    visible: bool,
}

impl Drop for BrowserSession {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserSnapshot {
    pub url: String,
    pub title: String,
    pub text: String,
    pub elements: Vec<String>,
    pub challenge: bool,
    pub ready_state: String,
}

fn validate_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("网址无效: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("浏览器只允许打开 http/https 地址".to_string()),
    }
}

fn find_chromium(app: &AppHandle) -> Result<PathBuf, String> {
    let mut roots = Vec::new();
    if let Some(resource_dir) = app.path_resolver().resource_dir() {
        roots.push(resource_dir.clone());
        roots.push(resource_dir.join(".local-browsers/chromium"));
        roots.push(resource_dir.join("../.local-browsers/chromium"));
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.local-browsers/chromium"));

    #[cfg(target_os = "macos")]
    for root in roots {
        let pattern = root
            .join("**/Chromium.app/Contents/MacOS/Chromium")
            .to_string_lossy()
            .to_string();
        if let Ok(paths) = glob::glob(&pattern) {
            if let Some(path) = paths.flatten().next() {
                return Ok(path);
            }
        }
    }

    #[cfg(target_os = "macos")]
    for path in [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ] {
        if Path::new(path).exists() {
            return Ok(PathBuf::from(path));
        }
    }

    Err("找不到可用的 Chromium。请重新安装鲲鹏，或安装 Google Chrome。".to_string())
}

fn reserve_port() -> Result<u16, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("无法分配浏览器调试端口: {}", e))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|e| format!("无法读取浏览器调试端口: {}", e))
}

impl BrowserSession {
    fn is_running(&mut self) -> bool {
        match self.child.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        }
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.port = None;
    }

    async fn ensure_running(&mut self, app: &AppHandle, visible: bool) -> Result<(), String> {
        if self.is_running() && self.visible == visible {
            return Ok(());
        }
        if self.is_running() {
            self.stop();
            tokio::time::sleep(Duration::from_millis(300)).await;
        }

        let chromium = find_chromium(app)?;
        let port = reserve_port()?;
        let profile = dirs::home_dir()
            .ok_or_else(|| "找不到用户目录".to_string())?
            .join(".kunpeng/browser-profile");
        std::fs::create_dir_all(&profile).map_err(|e| format!("无法创建浏览器资料目录: {}", e))?;

        let mut command = Command::new(chromium);
        command
            .arg(format!("--remote-debugging-port={}", port))
            .arg(format!("--user-data-dir={}", profile.to_string_lossy()))
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--disable-background-networking")
            .arg("--disable-component-update")
            .arg("--disable-features=Translate")
            .arg("--window-size=1280,900")
            .arg("about:blank")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if !visible {
            command.arg("--headless=new");
        }

        let child = command
            .spawn()
            .map_err(|e| format!("启动 Chromium 失败: {}", e))?;
        self.child = Some(child);
        self.port = Some(port);
        self.visible = visible;

        let client = reqwest::Client::new();
        let endpoint = format!("http://127.0.0.1:{}/json/version", port);
        for _ in 0..50 {
            if client
                .get(&endpoint)
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false)
            {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        self.stop();
        Err("Chromium 启动超时".to_string())
    }
}

async fn page_target(port: u16) -> Result<(String, String), String> {
    let endpoint = format!("http://127.0.0.1:{}/json/list", port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("无法创建浏览器连接: {}", e))?;
    let targets: Vec<Value> = client
        .get(endpoint)
        .send()
        .await
        .map_err(|e| format!("无法连接浏览器: {}", e))?
        .json()
        .await
        .map_err(|e| format!("无法读取浏览器页面: {}", e))?;
    let target = targets
        .iter()
        .find(|target| target.get("type").and_then(Value::as_str) == Some("page"))
        .ok_or_else(|| "浏览器中没有可操作页面".to_string())?;
    let ws = target
        .get("webSocketDebuggerUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| "页面缺少调试连接".to_string())?
        .to_string();
    let url = target
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or("about:blank")
        .to_string();
    Ok((ws, url))
}

async fn cdp_call(ws_url: &str, method: &str, params: Value) -> Result<Value, String> {
    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(8), connect_async(ws_url))
        .await
        .map_err(|_| "浏览器调试连接超时".to_string())?
        .map_err(|e| format!("浏览器调试连接失败: {}", e))?;
    socket
        .send(Message::Text(
            json!({ "id": 1, "method": method, "params": params }).to_string(),
        ))
        .await
        .map_err(|e| format!("浏览器命令发送失败: {}", e))?;
    loop {
        let next = tokio::time::timeout(Duration::from_secs(12), socket.next())
            .await
            .map_err(|_| format!("浏览器命令 {} 响应超时", method))?;
        let Some(message) = next else { break };
        let message = message.map_err(|e| format!("浏览器响应失败: {}", e))?;
        let Message::Text(text) = message else {
            continue;
        };
        let value: Value =
            serde_json::from_str(&text).map_err(|e| format!("浏览器响应格式错误: {}", e))?;
        if value.get("id").and_then(Value::as_i64) != Some(1) {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(format!("浏览器命令失败: {}", error));
        }
        return Ok(value.get("result").cloned().unwrap_or(Value::Null));
    }
    Err("浏览器连接意外关闭".to_string())
}

async fn evaluate(ws_url: &str, expression: String) -> Result<Value, String> {
    let result = cdp_call(
        ws_url,
        "Runtime.evaluate",
        json!({
            "expression": expression,
            "returnByValue": true,
            "awaitPromise": true,
            "userGesture": true
        }),
    )
    .await?;
    if let Some(exception) = result.get("exceptionDetails") {
        return Err(format!("页面脚本执行失败: {}", exception));
    }
    Ok(result
        .get("result")
        .and_then(|value| value.get("value"))
        .cloned()
        .unwrap_or(Value::Null))
}

async fn wait_ready(ws_url: &str) {
    for _ in 0..30 {
        let state = evaluate(ws_url, "document.readyState".to_string()).await;
        if matches!(
            state
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .as_deref(),
            Some("complete" | "interactive")
        ) {
            tokio::time::sleep(Duration::from_millis(350)).await;
            return;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

fn snapshot_expression(max_chars: usize) -> String {
    format!(
        r#"(() => {{
          const maxChars = {max_chars};
          document.querySelectorAll('[data-kunpeng-ref]').forEach(el => el.removeAttribute('data-kunpeng-ref'));
          const visible = (el) => {{
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
          }};
          const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const candidates = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[contenteditable="true"]'))
            .filter(visible).slice(0, 160);
          const elements = candidates.map((el, index) => {{
            const ref = `e${{index + 1}}`;
            el.setAttribute('data-kunpeng-ref', ref);
            const tag = el.tagName.toLowerCase();
            const role = el.getAttribute('role') || tag;
            const label = clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('name') || el.title);
            const href = el.href ? ` -> ${{el.href}}` : '';
            return `[${{ref}}] ${{role}}${{label ? ` "${{label.slice(0, 140)}}"` : ''}}${{href}}`;
          }});
          const root = document.querySelector('article,main,[role="main"]') || document.body;
          const text = clean(root ? root.innerText : '').slice(0, maxChars);
          const challengeText = `${{document.title}} ${{text.slice(0, 2500)}}`.toLowerCase();
          const challenge = /captcha|cloudflare|verify you are human|security check|sign in to continue|log in to continue|访问验证|安全验证|人机验证|滑动验证|请求过于频繁|请登录后|登录后查看/.test(challengeText);
          return {{ url: location.href, title: document.title || '', text, elements, challenge, ready_state: document.readyState }};
        }})()"#,
    )
}

async fn snapshot_for_port(port: u16, max_chars: usize) -> Result<BrowserSnapshot, String> {
    let (ws, _) = page_target(port).await?;
    let value = evaluate(&ws, snapshot_expression(max_chars.clamp(1_000, 200_000))).await?;
    serde_json::from_value(value).map_err(|e| format!("无法解析网页快照: {}", e))
}

#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    state: State<'_, BrowserState>,
    url: String,
    visible: Option<bool>,
    max_chars: Option<usize>,
) -> Result<BrowserSnapshot, String> {
    validate_url(&url)?;
    let visible = visible.unwrap_or(false);
    let mut session = state.inner.lock().await;
    session.ensure_running(&app, visible).await?;
    let port = session.port.ok_or_else(|| "浏览器未启动".to_string())?;
    let (ws, _) = page_target(port).await?;
    cdp_call(&ws, "Page.navigate", json!({ "url": url })).await?;
    wait_ready(&ws).await;
    snapshot_for_port(port, max_chars.unwrap_or(30_000)).await
}

#[tauri::command]
pub async fn browser_snapshot(
    state: State<'_, BrowserState>,
    max_chars: Option<usize>,
) -> Result<BrowserSnapshot, String> {
    let mut session = state.inner.lock().await;
    if !session.is_running() {
        return Err("浏览器尚未打开".to_string());
    }
    let port = session.port.ok_or_else(|| "浏览器未启动".to_string())?;
    snapshot_for_port(port, max_chars.unwrap_or(30_000)).await
}

#[tauri::command]
pub async fn browser_action(
    state: State<'_, BrowserState>,
    action: String,
    reference: Option<String>,
    value: Option<String>,
    max_chars: Option<usize>,
) -> Result<BrowserSnapshot, String> {
    let mut session = state.inner.lock().await;
    if !session.is_running() {
        return Err("浏览器尚未打开".to_string());
    }
    let port = session.port.ok_or_else(|| "浏览器未启动".to_string())?;
    let (ws, _) = page_target(port).await?;
    let reference_json =
        serde_json::to_string(&reference.unwrap_or_default()).unwrap_or_else(|_| "\"\"".into());
    let value_json =
        serde_json::to_string(&value.unwrap_or_default()).unwrap_or_else(|_| "\"\"".into());
    let expression = match action.as_str() {
        "click" => format!(
            "(() => {{ const ref={reference_json}; const el=Array.from(document.querySelectorAll('[data-kunpeng-ref]')).find(x=>x.getAttribute('data-kunpeng-ref')===ref); if(!el) throw new Error('找不到元素 '+ref+'，请重新读取页面'); el.scrollIntoView({{block:'center'}}); el.click(); return true; }})()"
        ),
        "type" => format!(
            "(() => {{ const ref={reference_json}, value={value_json}; const el=Array.from(document.querySelectorAll('[data-kunpeng-ref]')).find(x=>x.getAttribute('data-kunpeng-ref')===ref); if(!el) throw new Error('找不到元素 '+ref+'，请重新读取页面'); el.focus(); if(el.isContentEditable) el.textContent=value; else {{ const proto=Object.getPrototypeOf(el); const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set; if(setter) setter.call(el,value); else el.value=value; }} el.dispatchEvent(new InputEvent('input',{{bubbles:true,inputType:'insertText',data:value}})); el.dispatchEvent(new Event('change',{{bubbles:true}})); return true; }})()"
        ),
        "press_enter" => format!(
            "(() => {{ const ref={reference_json}; const el=Array.from(document.querySelectorAll('[data-kunpeng-ref]')).find(x=>x.getAttribute('data-kunpeng-ref')===ref) || document.activeElement; if(!el) throw new Error('没有可提交的输入框'); el.focus(); for(const type of ['keydown','keypress','keyup']) el.dispatchEvent(new KeyboardEvent(type,{{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}})); if(el.form?.requestSubmit) el.form.requestSubmit(); return true; }})()"
        ),
        "scroll_down" => "window.scrollBy({top: Math.max(600, window.innerHeight * 0.8), behavior: 'instant'}); true".to_string(),
        "scroll_up" => "window.scrollBy({top: -Math.max(600, window.innerHeight * 0.8), behavior: 'instant'}); true".to_string(),
        "back" => "history.back(); true".to_string(),
        "forward" => "history.forward(); true".to_string(),
        "reload" => "location.reload(); true".to_string(),
        "wait" => "true".to_string(),
        _ => return Err(format!("不支持的浏览器操作: {}", action)),
    };
    evaluate(&ws, expression).await?;
    tokio::time::sleep(Duration::from_millis(if action == "wait" {
        1_500
    } else {
        650
    }))
    .await;
    let (fresh_ws, _) = page_target(port).await?;
    wait_ready(&fresh_ws).await;
    snapshot_for_port(port, max_chars.unwrap_or(30_000)).await
}

#[tauri::command]
pub async fn browser_screenshot(state: State<'_, BrowserState>) -> Result<String, String> {
    let mut session = state.inner.lock().await;
    if !session.is_running() {
        return Err("浏览器尚未打开".to_string());
    }
    let port = session.port.ok_or_else(|| "浏览器未启动".to_string())?;
    let (ws, _) = page_target(port).await?;
    let result = cdp_call(
        &ws,
        "Page.captureScreenshot",
        json!({ "format": "png", "fromSurface": true }),
    )
    .await?;
    let data = result
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| "浏览器没有返回截图".to_string())?;
    let bytes = BASE64
        .decode(data)
        .map_err(|e| format!("截图解码失败: {}", e))?;
    let home = dirs::home_dir().ok_or_else(|| "找不到用户目录".to_string())?;
    let dir = home
        .join(".kunpeng/workspace")
        .join(chrono::Local::now().format("%Y-%m-%d").to_string())
        .join("browser");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建截图目录失败: {}", e))?;
    let path = dir.join(format!(
        "browser-{}.png",
        chrono::Local::now().timestamp_millis()
    ));
    std::fs::write(&path, bytes).map_err(|e| format!("保存截图失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn browser_close(state: State<'_, BrowserState>) -> Result<(), String> {
    let mut session = state.inner.lock().await;
    session.stop();
    Ok(())
}
