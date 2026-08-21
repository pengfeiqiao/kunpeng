use futures::{SinkExt, StreamExt};
use prost::Message as ProstMessage;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Window;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Clone, PartialEq, prost::Message)]
struct WsHeader {
    #[prost(string, tag = "1")]
    key: String,
    #[prost(string, tag = "2")]
    value: String,
}

#[derive(Clone, PartialEq, prost::Message)]
struct WsFrame {
    #[prost(uint64, tag = "1")]
    seq_id: u64,
    #[prost(uint64, tag = "2")]
    log_id: u64,
    #[prost(int32, tag = "3")]
    service: i32,
    #[prost(int32, tag = "4")]
    method: i32,
    #[prost(message, repeated, tag = "5")]
    headers: Vec<WsHeader>,
    #[prost(string, optional, tag = "6")]
    payload_encoding: Option<String>,
    #[prost(string, optional, tag = "7")]
    payload_type: Option<String>,
    #[prost(bytes, optional, tag = "8")]
    payload: Option<Vec<u8>>,
    #[prost(string, optional, tag = "9")]
    log_id_new: Option<String>,
}

#[derive(Clone)]
struct WsConfig {
    connect_url: String,
    service_id: i32,
    ping_interval_ms: u64,
    reconnect_count: i64,
    reconnect_interval_ms: u64,
    reconnect_nonce_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct LarkCredential {
    app_id: String,
    app_secret: String,
    verification_token: Option<String>,
    port: u16,
}

#[derive(Clone)]
pub struct LarkBotInner {
    app_id: String,
    app_secret: String,
    verification_token: Option<String>,
    port: u16,
    tenant_access_token: Option<String>,
    token_expire_at: i64,
}

#[derive(Default)]
pub struct LarkState {
    pub bots: Arc<Mutex<HashMap<String, LarkBotInner>>>,
    pub servers: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

#[derive(Clone, Serialize)]
pub struct LarkMessage {
    pub bot_id: String,
    pub chat_id: String,
    pub message_id: String,
    pub sender_id: String,
    pub chat_type: String,
    pub msg_type: String,
    pub thread_id: Option<String>,
    pub text: String,
    pub timestamp: i64,
    pub image_key: Option<String>,
    pub file_key: Option<String>,
    pub file_name: Option<String>,
    pub voice_key: Option<String>,
}

fn lark_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".kunpeng").join("lark.json"))
}

fn lark_data_path(key: &str) -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".kunpeng").join(format!("lark-{}.json", key)))
}

fn lark_media_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".kunpeng").join("lark-media"))
}

fn persist_bots(bots: &HashMap<String, LarkBotInner>) {
    let creds: Vec<LarkCredential> = bots
        .values()
        .map(|b| LarkCredential {
            app_id: b.app_id.clone(),
            app_secret: b.app_secret.clone(),
            verification_token: b.verification_token.clone(),
            port: b.port,
        })
        .collect();
    if let Some(path) = lark_path() {
        if let Ok(s) = serde_json::to_string_pretty(&creds) {
            let _ = crate::commands::write_file_private(&path, &s);
        }
    }
}

fn load_bots() -> Vec<LarkCredential> {
    let Some(path) = lark_path() else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<LarkCredential>>(&raw).unwrap_or_default()
}

fn http_json(status: &str, body: serde_json::Value) -> Vec<u8> {
    let text = body.to_string();
    format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        text.as_bytes().len(),
        text
    )
    .into_bytes()
}

fn parse_content_length(headers: &str) -> usize {
    headers
        .lines()
        .find_map(|line| {
            let (k, v) = line.split_once(':')?;
            if k.eq_ignore_ascii_case("content-length") {
                v.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0)
}

fn extract_text(event: &serde_json::Value) -> String {
    let content = event
        .pointer("/event/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if content.is_empty() {
        return String::new();
    }
    serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .and_then(|v| {
            v.get("text")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| content.to_string())
}

fn extract_post_text(content_str: &str) -> String {
    let parsed = match serde_json::from_str::<serde_json::Value>(content_str) {
        Ok(v) => v,
        Err(_) => return content_str.to_string(),
    };
    let mut parts: Vec<String> = Vec::new();
    if let Some(title) = parsed.get("title").and_then(|t| t.as_str()) {
        if !title.is_empty() {
            parts.push(title.to_string());
        }
    }
    if let Some(content) = parsed.get("content").and_then(|c| c.as_array()) {
        for line in content {
            if let Some(elements) = line.as_array() {
                let mut line_text = String::new();
                for elem in elements {
                    let tag = elem.get("tag").and_then(|t| t.as_str()).unwrap_or("");
                    match tag {
                        "text" => {
                            if let Some(t) = elem.get("text").and_then(|t| t.as_str()) {
                                line_text.push_str(t);
                            }
                        }
                        "a" => {
                            let text = elem.get("text").and_then(|t| t.as_str()).unwrap_or("");
                            let href = elem.get("href").and_then(|t| t.as_str()).unwrap_or("");
                            line_text.push_str(&format!("{}({})", text, href));
                        }
                        "at" => {
                            let user = elem
                                .get("user_name")
                                .and_then(|t| t.as_str())
                                .unwrap_or("someone");
                            line_text.push_str(&format!("@{}", user));
                        }
                        "img" => line_text.push_str("[图片]"),
                        _ => {}
                    }
                }
                if !line_text.is_empty() {
                    parts.push(line_text);
                }
            }
        }
    }
    if parts.is_empty() {
        content_str.to_string()
    } else {
        parts.join("\n")
    }
}

fn header_value(headers: &[WsHeader], key: &str) -> Option<String> {
    headers
        .iter()
        .find(|h| h.key == key)
        .map(|h| h.value.clone())
}

fn append_header(headers: &[WsHeader], key: &str, value: String) -> Vec<WsHeader> {
    let mut next = headers.to_vec();
    next.push(WsHeader {
        key: key.to_string(),
        value,
    });
    next
}

fn parse_query_i32(url: &str, key: &str) -> Option<i32> {
    let query = url.split_once('?')?.1;
    for part in query.split('&') {
        let (k, v) = part.split_once('=')?;
        if k == key {
            return v.parse::<i32>().ok();
        }
    }
    None
}

async fn pull_ws_config(app_id: &str, app_secret: &str) -> Result<WsConfig, String> {
    let resp = reqwest::Client::new()
        .post("https://open.feishu.cn/callback/ws/endpoint")
        .header("locale", "zh")
        .json(&json!({ "AppID": app_id, "AppSecret": app_secret }))
        .send()
        .await
        .map_err(|e| format!("获取飞书长连接地址失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析飞书长连接地址失败: {}", e))?;
    if data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return Err(format!("飞书长连接配置被拒绝: {}", data));
    }
    let connect_url = data
        .pointer("/data/URL")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if connect_url.is_empty() {
        return Err(format!("飞书长连接响应缺少 URL: {}", data));
    }
    let client_config = data
        .pointer("/data/ClientConfig")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let service_id = parse_query_i32(&connect_url, "service_id").unwrap_or(0);
    Ok(WsConfig {
        connect_url,
        service_id,
        ping_interval_ms: client_config
            .get("PingInterval")
            .and_then(|v| v.as_u64())
            .unwrap_or(120)
            * 1000,
        reconnect_count: client_config
            .get("ReconnectCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(-1),
        reconnect_interval_ms: client_config
            .get("ReconnectInterval")
            .and_then(|v| v.as_u64())
            .unwrap_or(120)
            * 1000,
        reconnect_nonce_ms: client_config
            .get("ReconnectNonce")
            .and_then(|v| v.as_u64())
            .unwrap_or(30)
            * 1000,
    })
}

fn encode_frame(frame: &WsFrame) -> Vec<u8> {
    let mut out = Vec::new();
    let _ = frame.encode(&mut out);
    out
}

fn ping_frame(service_id: i32) -> WsFrame {
    WsFrame {
        seq_id: 0,
        log_id: 0,
        service: service_id,
        method: 0,
        headers: vec![WsHeader {
            key: "type".into(),
            value: "ping".into(),
        }],
        payload_encoding: None,
        payload_type: None,
        payload: None,
        log_id_new: None,
    }
}

fn ack_frame(frame: &WsFrame, ok: bool, started_at: i64) -> WsFrame {
    let elapsed = chrono::Utc::now().timestamp_millis() - started_at;
    WsFrame {
        seq_id: frame.seq_id,
        log_id: frame.log_id,
        service: frame.service,
        method: frame.method,
        headers: append_header(&frame.headers, "biz_rt", elapsed.to_string()),
        payload_encoding: frame.payload_encoding.clone(),
        payload_type: frame.payload_type.clone(),
        payload: Some(
            json!({ "code": if ok { 200 } else { 500 } })
                .to_string()
                .into_bytes(),
        ),
        log_id_new: frame.log_id_new.clone(),
    }
}

fn merge_ws_payload(
    cache: &mut HashMap<String, Vec<Option<Vec<u8>>>>,
    frame: &WsFrame,
) -> Option<serde_json::Value> {
    let msg_id = header_value(&frame.headers, "message_id")?;
    let sum = header_value(&frame.headers, "sum")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(1);
    let seq = header_value(&frame.headers, "seq")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    let payload = frame.payload.clone().unwrap_or_default();
    let entry = cache
        .entry(msg_id.clone())
        .or_insert_with(|| vec![None; sum.max(1)]);
    if seq >= entry.len() {
        return None;
    }
    entry[seq] = Some(payload);
    if entry.iter().all(|v| v.is_some()) {
        let mut bytes = Vec::new();
        for item in entry.iter_mut() {
            if let Some(chunk) = item.take() {
                bytes.extend_from_slice(&chunk);
            }
        }
        cache.remove(&msg_id);
        return serde_json::from_slice::<serde_json::Value>(&bytes).ok();
    }
    None
}

async fn handle_lark_event(
    app_id: &str,
    expected_token: Option<String>,
    window: &Window,
    body: &[u8],
) -> serde_json::Value {
    let parsed: serde_json::Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return json!({ "code": 400, "msg": "invalid json" }),
    };

    if parsed.get("encrypt").is_some() {
        return json!({ "code": 400, "msg": "encrypted callback is not enabled in Kunpeng yet" });
    }

    if parsed.get("type").and_then(|v| v.as_str()) == Some("url_verification") {
        if let Some(token) = expected_token.as_deref() {
            let got = parsed.get("token").and_then(|v| v.as_str()).unwrap_or("");
            if !token.is_empty() && got != token {
                return json!({ "code": 403, "msg": "verification token mismatch" });
            }
        }
        return json!({ "challenge": parsed.get("challenge").and_then(|v| v.as_str()).unwrap_or("") });
    }

    let event_type = parsed
        .pointer("/header/event_type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if event_type != "im.message.receive_v1" {
        return json!({ "code": 0, "msg": "ignored" });
    }

    if let Some(token) = expected_token.as_deref() {
        let got = parsed
            .pointer("/header/token")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !token.is_empty() && got != token {
            return json!({ "code": 403, "msg": "verification token mismatch" });
        }
    }

    let msg_type = parsed
        .pointer("/event/message/message_type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let chat_id = parsed
        .pointer("/event/message/chat_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let message_id = parsed
        .pointer("/event/message/message_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let sender_id = parsed
        .pointer("/event/sender/sender_id/open_id")
        .or_else(|| parsed.pointer("/event/sender/sender_id/user_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let chat_type = parsed
        .pointer("/event/message/chat_type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let thread_id = parsed
        .pointer("/event/message/thread_id")
        .or_else(|| parsed.pointer("/event/message/root_id"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string());

    let content_json = parsed
        .pointer("/event/message/content")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());

    let mut ev_image_key: Option<String> = None;
    let mut ev_file_key: Option<String> = None;
    let mut ev_file_name: Option<String> = None;
    let mut ev_voice_key: Option<String> = None;

    let text = match msg_type.as_str() {
        "text" => extract_text(&parsed),
        "image" => {
            let ik = content_json
                .as_ref()
                .and_then(|v| {
                    v.get("image_key")
                        .and_then(|k| k.as_str())
                        .map(String::from)
                })
                .unwrap_or_default();
            let desc = format!("[用户发送了一张图片，image_key: {}]", ik);
            ev_image_key = Some(ik);
            desc
        }
        "file" => {
            let fk = content_json
                .as_ref()
                .and_then(|v| v.get("file_key").and_then(|k| k.as_str()).map(String::from))
                .unwrap_or_default();
            let fn_ = content_json
                .as_ref()
                .and_then(|v| {
                    v.get("file_name")
                        .and_then(|k| k.as_str())
                        .map(String::from)
                })
                .unwrap_or_else(|| "未知文件".to_string());
            let desc = format!("[用户发送了文件: {}，file_key: {}]", fn_, fk);
            ev_file_key = Some(fk);
            ev_file_name = Some(fn_);
            desc
        }
        "post" => {
            let content_str = parsed
                .pointer("/event/message/content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            extract_post_text(content_str)
        }
        "audio" => {
            let vk = content_json
                .as_ref()
                .and_then(|v| v.get("file_key").and_then(|k| k.as_str()).map(String::from))
                .unwrap_or_default();
            ev_voice_key = Some(vk);
            "[用户发送了一条语音消息]".to_string()
        }
        "media" => {
            let fk = content_json
                .as_ref()
                .and_then(|v| v.get("file_key").and_then(|k| k.as_str()).map(String::from))
                .unwrap_or_default();
            let fn_ = content_json
                .as_ref()
                .and_then(|v| {
                    v.get("file_name")
                        .and_then(|k| k.as_str())
                        .map(String::from)
                })
                .unwrap_or_else(|| "视频".to_string());
            let desc = format!("[用户发送了视频: {}]", fn_);
            ev_file_key = Some(fk);
            ev_file_name = Some(fn_);
            desc
        }
        "sticker" => "[用户发送了一个表情]".to_string(),
        "interactive" => "[用户发送了一条互动消息]".to_string(),
        other => format!("[用户发送了一条 {} 类型消息，暂不支持解析]", other),
    };

    if chat_id.is_empty() || message_id.is_empty() || text.trim().is_empty() {
        return json!({ "code": 0, "msg": "empty message" });
    }

    let payload = LarkMessage {
        bot_id: app_id.to_string(),
        chat_id,
        message_id,
        sender_id,
        chat_type,
        msg_type,
        thread_id,
        text,
        timestamp: chrono::Utc::now().timestamp_millis(),
        image_key: ev_image_key,
        file_key: ev_file_key,
        file_name: ev_file_name,
        voice_key: ev_voice_key,
    };
    let _ = window.emit("lark-message", payload);
    json!({ "code": 0, "msg": "ok" })
}

async fn run_server(
    app_id: String,
    port: u16,
    token: Option<String>,
    window: Window,
) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("飞书事件入口启动失败: {}", e))?;
    loop {
        let (mut socket, _) = match listener.accept().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        let app_id = app_id.clone();
        let token = token.clone();
        let window = window.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 8192];
            let mut read = match socket.read(&mut buf).await {
                Ok(n) => n,
                Err(_) => return,
            };
            let mut request = buf[..read].to_vec();
            let header_end = loop {
                if let Some(pos) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    break pos + 4;
                }
                if request.len() > 1024 * 1024 {
                    let _ = socket
                        .write_all(&http_json("413 Payload Too Large", json!({ "code": 413 })))
                        .await;
                    return;
                }
                read = match socket.read(&mut buf).await {
                    Ok(0) | Err(_) => return,
                    Ok(n) => n,
                };
                request.extend_from_slice(&buf[..read]);
            };
            let headers = String::from_utf8_lossy(&request[..header_end]);
            let len = parse_content_length(&headers);
            while request.len() < header_end + len {
                read = match socket.read(&mut buf).await {
                    Ok(0) | Err(_) => return,
                    Ok(n) => n,
                };
                request.extend_from_slice(&buf[..read]);
            }
            let body = &request[header_end..header_end + len];
            let resp = handle_lark_event(&app_id, token, &window, body).await;
            let _ = socket.write_all(&http_json("200 OK", resp)).await;
        });
    }
}

async fn run_ws_session(
    app_id: String,
    _token: Option<String>,
    window: Window,
    config: WsConfig,
) -> Result<(), String> {
    let (ws, _) = connect_async(&config.connect_url)
        .await
        .map_err(|e| format!("飞书长连接建立失败: {}", e))?;
    let _ = window.emit(
        "lark-status",
        json!({
            "bot_id": app_id,
            "state": "connected",
            "message": "飞书 WebSocket 长连接已连接",
        }),
    );

    let (mut write, mut read) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let ping_tx = tx.clone();
    let service_id = config.service_id;
    let mut ping_interval = config.ping_interval_ms.max(10_000);
    let ping_task = tokio::spawn(async move {
        loop {
            if ping_tx.send(encode_frame(&ping_frame(service_id))).is_err() {
                break;
            }
            sleep(Duration::from_millis(ping_interval)).await;
        }
    });

    let write_task = tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if write.send(Message::Binary(bytes)).await.is_err() {
                break;
            }
        }
    });

    let mut payload_cache: HashMap<String, Vec<Option<Vec<u8>>>> = HashMap::new();
    while let Some(item) = read.next().await {
        let msg = item.map_err(|e| format!("飞书长连接读取失败: {}", e))?;
        let bytes = match msg {
            Message::Binary(v) => v,
            Message::Close(_) => break,
            _ => continue,
        };
        let frame = WsFrame::decode(bytes.as_slice())
            .map_err(|e| format!("解析飞书长连接帧失败: {}", e))?;
        let frame_type = header_value(&frame.headers, "type").unwrap_or_default();
        if frame.method == 0 {
            if frame_type == "pong" {
                if let Some(payload) = frame.payload.as_ref() {
                    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(payload) {
                        ping_interval = v
                            .get("PingInterval")
                            .and_then(|x| x.as_u64())
                            .unwrap_or(ping_interval / 1000)
                            * 1000;
                    }
                }
            }
            continue;
        }
        if frame_type != "event" && frame_type != "card" {
            continue;
        }
        let Some(event) = merge_ws_payload(&mut payload_cache, &frame) else {
            continue;
        };
        let started_at = chrono::Utc::now().timestamp_millis();
        let resp = handle_lark_event(&app_id, None, &window, event.to_string().as_bytes()).await;
        let ok = resp.get("code").and_then(|v| v.as_i64()).unwrap_or(0) == 0
            || resp.get("challenge").is_some();
        let _ = tx.send(encode_frame(&ack_frame(&frame, ok, started_at)));
    }

    ping_task.abort();
    write_task.abort();
    Err("飞书长连接已断开".into())
}

async fn run_ws_client(
    app_id: String,
    app_secret: String,
    token: Option<String>,
    window: Window,
) -> Result<(), String> {
    let mut attempts: i64 = 0;
    loop {
        let _ = window.emit(
            "lark-status",
            json!({
                "bot_id": app_id,
                "state": if attempts == 0 { "connecting" } else { "reconnecting" },
                "message": "正在连接飞书 WebSocket 长连接",
            }),
        );

        let config = match pull_ws_config(&app_id, &app_secret).await {
            Ok(v) => v,
            Err(e) => {
                attempts += 1;
                let _ = window.emit(
                    "lark-status",
                    json!({
                        "bot_id": app_id,
                        "state": "failed",
                        "message": e,
                    }),
                );
                sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        let reconnect_count = config.reconnect_count;
        let reconnect_interval = Duration::from_millis(config.reconnect_interval_ms.max(5_000));
        if config.reconnect_nonce_ms > 0 && attempts > 0 {
            let jitter = (chrono::Utc::now().timestamp_millis() as u64) % config.reconnect_nonce_ms;
            sleep(Duration::from_millis(jitter)).await;
        }

        if let Err(e) = run_ws_session(app_id.clone(), token.clone(), window.clone(), config).await
        {
            attempts += 1;
            let _ = window.emit(
                "lark-status",
                json!({
                    "bot_id": app_id,
                    "state": "reconnecting",
                    "message": e,
                }),
            );
            if reconnect_count >= 0 && attempts >= reconnect_count {
                return Err(format!("飞书长连接重连次数耗尽: {}", attempts));
            }
            sleep(reconnect_interval).await;
        } else {
            attempts = 0;
        }
    }
}

#[tauri::command]
pub async fn lark_save_config(
    state: tauri::State<'_, LarkState>,
    app_id: String,
    app_secret: String,
    verification_token: Option<String>,
    port: u16,
) -> Result<(), String> {
    let app_id = app_id.trim().to_string();
    if app_id.is_empty() {
        return Err("app_id 不能为空".into());
    }
    let mut bots = state.bots.lock().await;
    let app_secret = if app_secret.trim().is_empty() {
        bots.get(&app_id)
            .map(|bot| bot.app_secret.clone())
            .ok_or("app_secret 不能为空")?
    } else {
        app_secret.trim().to_string()
    };
    bots.insert(
        app_id.clone(),
        LarkBotInner {
            app_id,
            app_secret,
            verification_token,
            port,
            tenant_access_token: None,
            token_expire_at: 0,
        },
    );
    persist_bots(&bots);
    Ok(())
}

#[tauri::command]
pub async fn lark_restore_config(
    state: tauri::State<'_, LarkState>,
) -> Result<serde_json::Value, String> {
    let creds = load_bots();
    let mut bots = state.bots.lock().await;
    let mut restored = Vec::new();
    for c in creds {
        bots.insert(
            c.app_id.clone(),
            LarkBotInner {
                app_id: c.app_id.clone(),
                app_secret: c.app_secret,
                verification_token: c.verification_token.clone(),
                port: c.port,
                tenant_access_token: None,
                token_expire_at: 0,
            },
        );
        restored.push(json!({
            "app_id": c.app_id,
            "port": c.port,
            "verification_token": c.verification_token,
        }));
    }
    Ok(json!({ "bots": restored }))
}

#[tauri::command]
pub async fn lark_start_server(
    state: tauri::State<'_, LarkState>,
    window: Window,
    bot_id: String,
) -> Result<(), String> {
    let (app_secret, token) = {
        let bots = state.bots.lock().await;
        let bot = bots.get(&bot_id).ok_or("飞书机器人配置不存在")?;
        (bot.app_secret.clone(), bot.verification_token.clone())
    };

    let mut servers = state.servers.lock().await;
    if let Some(handle) = servers.remove(&bot_id) {
        handle.abort();
    }
    let app_id = bot_id.clone();
    let status_window = window.clone();
    let handle = tokio::spawn(async move {
        if let Err(e) = run_ws_client(app_id.clone(), app_secret, token, window).await {
            eprintln!("[lark] websocket error for {}: {}", app_id, e);
            let _ = status_window.emit(
                "lark-status",
                json!({
                    "bot_id": app_id,
                    "state": "failed",
                    "message": e,
                }),
            );
        }
    });
    servers.insert(bot_id, handle);
    Ok(())
}

#[tauri::command]
pub async fn lark_stop_server(
    state: tauri::State<'_, LarkState>,
    bot_id: String,
) -> Result<(), String> {
    let mut servers = state.servers.lock().await;
    if let Some(handle) = servers.remove(&bot_id) {
        handle.abort();
    }
    Ok(())
}

async fn tenant_token(bot: &mut LarkBotInner) -> Result<String, String> {
    let now = chrono::Utc::now().timestamp();
    if let Some(token) = &bot.tenant_access_token {
        if bot.token_expire_at - 120 > now {
            return Ok(token.clone());
        }
    }
    let client = reqwest::Client::new();
    let resp = client
        .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
        .json(&json!({ "app_id": bot.app_id, "app_secret": bot.app_secret }))
        .send()
        .await
        .map_err(|e| format!("获取飞书 tenant_access_token 失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析飞书 token 响应失败: {}", e))?;
    if data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return Err(format!("飞书 token 被拒绝: {}", data));
    }
    let token = data
        .get("tenant_access_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let expire = data.get("expire").and_then(|v| v.as_i64()).unwrap_or(7200);
    if token.is_empty() {
        return Err(format!("飞书 token 响应缺少 tenant_access_token: {}", data));
    }
    bot.tenant_access_token = Some(token.clone());
    bot.token_expire_at = now + expire;
    Ok(token)
}

#[tauri::command]
pub async fn lark_send_message(
    state: tauri::State<'_, LarkState>,
    bot_id: String,
    chat_id: String,
    text: String,
) -> Result<(), String> {
    let token = {
        let mut bots = state.bots.lock().await;
        let bot = bots.get_mut(&bot_id).ok_or("飞书机器人配置不存在")?;
        tenant_token(bot).await?
    };
    let content = json!({ "text": text }).to_string();
    let client = reqwest::Client::new();
    let resp = client
        .post("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id")
        .bearer_auth(token)
        .json(&json!({ "receive_id": chat_id, "msg_type": "text", "content": content }))
        .send()
        .await
        .map_err(|e| format!("发送飞书消息失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析飞书发送响应失败: {}", e))?;
    if data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return Err(format!("飞书发送被拒绝: {}", data));
    }
    Ok(())
}

async fn send_lark_message(
    state: tauri::State<'_, LarkState>,
    bot_id: String,
    chat_id: String,
    msg_type: &str,
    content: String,
) -> Result<String, String> {
    let token = {
        let mut bots = state.bots.lock().await;
        let bot = bots.get_mut(&bot_id).ok_or("飞书机器人配置不存在")?;
        tenant_token(bot).await?
    };
    let client = reqwest::Client::new();
    let resp = client
        .post("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id")
        .bearer_auth(token)
        .json(&json!({ "receive_id": chat_id, "msg_type": msg_type, "content": content }))
        .send()
        .await
        .map_err(|e| format!("发送飞书消息失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析飞书发送响应失败: {}", e))?;
    if data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return Err(format!("飞书发送被拒绝: {}", data));
    }
    let message_id = data
        .pointer("/data/message_id")
        .or_else(|| data.pointer("/data/message/message_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if message_id.is_empty() {
        return Err(format!("飞书发送响应缺少 message_id: {}", data));
    }
    Ok(message_id)
}

#[tauri::command]
pub async fn lark_send_stream_card(
    state: tauri::State<'_, LarkState>,
    bot_id: String,
    chat_id: String,
    card: serde_json::Value,
) -> Result<String, String> {
    send_lark_message(state, bot_id, chat_id, "interactive", card.to_string()).await
}

#[tauri::command]
pub async fn lark_update_stream_card(
    state: tauri::State<'_, LarkState>,
    bot_id: String,
    message_id: String,
    card: serde_json::Value,
) -> Result<(), String> {
    let token = {
        let mut bots = state.bots.lock().await;
        let bot = bots.get_mut(&bot_id).ok_or("飞书机器人配置不存在")?;
        tenant_token(bot).await?
    };
    let client = reqwest::Client::new();
    let url = format!(
        "https://open.feishu.cn/open-apis/im/v1/messages/{}",
        message_id
    );
    let resp = client
        .patch(url)
        .bearer_auth(token)
        .json(&json!({ "content": card.to_string() }))
        .send()
        .await
        .map_err(|e| format!("更新飞书卡片失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析飞书卡片更新响应失败: {}", e))?;
    if data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return Err(format!("飞书卡片更新被拒绝: {}", data));
    }
    Ok(())
}

#[tauri::command]
pub async fn lark_get_status(
    state: tauri::State<'_, LarkState>,
) -> Result<serde_json::Value, String> {
    let bots = state.bots.lock().await;
    let servers = state.servers.lock().await;
    let list: Vec<serde_json::Value> = bots
        .values()
        .map(|b| {
            json!({
                "app_id": b.app_id,
                "port": b.port,
                "running": servers
                    .get(&b.app_id)
                    .map(|handle| !handle.is_finished())
                    .unwrap_or(false),
            })
        })
        .collect();
    Ok(json!({ "bots": list }))
}

#[tauri::command]
pub async fn lark_save_data(key: String, data: String) -> Result<(), String> {
    let path = lark_data_path(&key).ok_or("无法获取路径")?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::write(path, data)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lark_load_data(key: String) -> Result<String, String> {
    let path = lark_data_path(&key).ok_or("无法获取路径")?;
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lark_download_resource(
    state: tauri::State<'_, LarkState>,
    bot_id: String,
    message_id: String,
    file_key: String,
    resource_type: String,
    file_name: Option<String>,
) -> Result<String, String> {
    let token = {
        let mut bots = state.bots.lock().await;
        let bot = bots.get_mut(&bot_id).ok_or("飞书机器人配置不存在")?;
        tenant_token(bot).await?
    };
    let client = reqwest::Client::new();
    let url = if resource_type == "image" {
        format!("https://open.feishu.cn/open-apis/im/v1/images/{}", file_key)
    } else {
        format!(
            "https://open.feishu.cn/open-apis/im/v1/messages/{}/resources/{}?type={}",
            message_id, file_key, resource_type
        )
    };
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("飞书下载资源失败: {}", e))?;
    if !resp.status().is_success() {
        let fallback_types = match resource_type.as_str() {
            "audio" => vec!["media", "file"],
            "media" => vec!["file"],
            _ => vec![],
        };
        for ft in &fallback_types {
            let fallback_url = format!(
                "https://open.feishu.cn/open-apis/im/v1/messages/{}/resources/{}?type={}",
                message_id, file_key, ft
            );
            let fb_resp = client.get(&fallback_url).bearer_auth(&token).send().await;
            if let Ok(r) = fb_resp {
                if r.status().is_success() {
                    let bytes = r
                        .bytes()
                        .await
                        .map_err(|e| format!("读取飞书资源失败: {}", e))?;
                    let dir = lark_media_dir().ok_or("无法获取媒体目录")?;
                    tokio::fs::create_dir_all(&dir)
                        .await
                        .map_err(|e| e.to_string())?;
                    let ext = match *ft {
                        "audio" => "ogg",
                        "media" => "mp4",
                        _ => "bin",
                    };
                    let default_name = format!("{}.{}", file_key, ext);
                    let fname = file_name.as_deref().unwrap_or(&default_name);
                    let out_path = dir.join(fname);
                    tokio::fs::write(&out_path, &bytes)
                        .await
                        .map_err(|e| e.to_string())?;
                    return Ok(out_path.to_string_lossy().to_string());
                }
            }
        }
        return Err(format!("飞书下载资源失败，HTTP 状态: {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取飞书资源失败: {}", e))?;
    let dir = lark_media_dir().ok_or("无法获取媒体目录")?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let ext = match resource_type.as_str() {
        "image" => "png",
        "audio" => "ogg",
        "media" => "mp4",
        _ => "bin",
    };
    let default_name = format!("{}.{}", file_key, ext);
    let fname = file_name.as_deref().unwrap_or(&default_name);
    let out_path = dir.join(fname);
    tokio::fs::write(&out_path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn lark_upload_image(
    state: tauri::State<'_, LarkState>,
    bot_id: String,
    file_path: String,
) -> Result<String, String> {
    let token = {
        let mut bots = state.bots.lock().await;
        let bot = bots.get_mut(&bot_id).ok_or("飞书机器人配置不存在")?;
        tenant_token(bot).await?
    };
    let path = std::path::Path::new(&file_path);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image.png")
        .to_string();
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("image_type", "message")
        .part("image", part);
    let client = reqwest::Client::new();
    let resp = client
        .post("https://open.feishu.cn/open-apis/im/v1/images")
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("上传飞书图片失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析飞书上传响应失败: {}", e))?;
    if data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return Err(format!("飞书上传图片被拒绝: {}", data));
    }
    let image_key = data
        .pointer("/data/image_key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if image_key.is_empty() {
        return Err(format!("飞书上传响应缺少 image_key: {}", data));
    }
    Ok(image_key)
}

#[tauri::command]
pub async fn lark_upload_file(
    state: tauri::State<'_, LarkState>,
    bot_id: String,
    file_path: String,
    file_type: Option<String>,
) -> Result<String, String> {
    let token = {
        let mut bots = state.bots.lock().await;
        let bot = bots.get_mut(&bot_id).ok_or("飞书机器人配置不存在")?;
        tenant_token(bot).await?
    };
    let path = std::path::Path::new(&file_path);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let ft = file_type.unwrap_or_else(|| {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        match ext.as_str() {
            "opus" | "ogg" | "mp3" | "wav" | "m4a" | "amr" => "opus".to_string(),
            "mp4" | "mov" | "avi" | "mkv" | "webm" => "mp4".to_string(),
            "pdf" => "pdf".to_string(),
            "doc" | "docx" => "doc".to_string(),
            "xls" | "xlsx" => "xls".to_string(),
            "ppt" | "pptx" => "ppt".to_string(),
            _ => "stream".to_string(),
        }
    });
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name.clone())
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("file_type", ft)
        .text("file_name", file_name)
        .part("file", part);
    let client = reqwest::Client::new();
    let resp = client
        .post("https://open.feishu.cn/open-apis/im/v1/files")
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("上传飞书文件失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析飞书上传响应失败: {}", e))?;
    if data.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return Err(format!("飞书上传文件被拒绝: {}", data));
    }
    let file_key = data
        .pointer("/data/file_key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if file_key.is_empty() {
        return Err(format!("飞书上传响应缺少 file_key: {}", data));
    }
    Ok(file_key)
}

#[tauri::command]
pub async fn lark_send_image(
    state: tauri::State<'_, LarkState>,
    bot_id: String,
    chat_id: String,
    file_path: String,
) -> Result<(), String> {
    let image_key = lark_upload_image(state.clone(), bot_id.clone(), file_path).await?;
    let content = json!({ "image_key": image_key }).to_string();
    send_lark_message(state, bot_id, chat_id, "image", content).await?;
    Ok(())
}

#[tauri::command]
pub async fn lark_send_file(
    state: tauri::State<'_, LarkState>,
    bot_id: String,
    chat_id: String,
    file_path: String,
) -> Result<(), String> {
    let file_key = lark_upload_file(state.clone(), bot_id.clone(), file_path, None).await?;
    let content = json!({ "file_key": file_key }).to_string();
    send_lark_message(state, bot_id, chat_id, "file", content).await?;
    Ok(())
}
