use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Write as IoWrite;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

// ── Debug logging ──────────────────────────────────────────────────────────

fn wlog(msg: &str) {
    eprintln!("{}", msg);
    let log_path = std::env::temp_dir().join("wechat-debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = writeln!(f, "{}", msg);
    }
}

// ── Constants ───────────────────────────────────────────────────────────────

const ILINK_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION: &str = "2.2.0";
const APP_CLIENT_VERSION: &str = "131584"; // (2<<16)|(2<<8)|0

// ── Credential persistence (multi-bot) ─────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct BotCredential {
    bot_token: String,
    account_id: String,
    base_url: String,
}

fn credentials_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".kunpeng").join("wechat.json"))
}

fn save_all_credentials(creds: &[BotCredential]) {
    if let Some(path) = credentials_path() {
        if let Ok(json) = serde_json::to_string_pretty(&creds) {
            let _ = crate::commands::write_file_private(&path, &json);
            wlog(&format!("[wechat] saved {} bot credentials", creds.len()));
        }
    }
}

fn load_all_credentials() -> Vec<BotCredential> {
    let path = match credentials_path() {
        Some(p) => p,
        None => return vec![],
    };
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return vec![],
    };
    // Try parsing as array first (new format), then as single object (old format)
    if let Ok(arr) = serde_json::from_str::<Vec<BotCredential>>(&data) {
        return arr;
    }
    // Migrate old single-credential format
    #[derive(Deserialize)]
    struct OldCreds {
        bot_token: Option<String>,
        account_id: Option<String>,
        base_url: Option<String>,
    }
    if let Ok(old) = serde_json::from_str::<OldCreds>(&data) {
        if let (Some(t), Some(a)) = (old.bot_token, old.account_id) {
            if !t.is_empty() {
                let cred = BotCredential {
                    bot_token: t,
                    account_id: a,
                    base_url: old.base_url.unwrap_or_else(|| ILINK_BASE_URL.to_string()),
                };
                // Re-save in new format
                save_all_credentials(&[cred.clone()]);
                return vec![cred];
            }
        }
    }
    vec![]
}

// ── State (multi-bot) ──────────────────────────────────────────────────────

pub struct WechatInner {
    bot_token: String,
    account_id: String,
    base_url: String,
    sync_buf: String,
    context_tokens: HashMap<String, String>,
    typing_tickets: HashMap<String, (String, std::time::Instant)>,
    polling_abort: Option<tokio::task::AbortHandle>,
    emitted_msg_ids: HashSet<String>,
    emitted_msg_order: VecDeque<String>,
}

pub struct WechatState {
    pub bots: Arc<Mutex<HashMap<String, WechatInner>>>,
    pub pending_login: Arc<Mutex<Option<PendingLogin>>>,
}

pub struct PendingLogin {
    pub bot_token: String,
    pub account_id: String,
    pub base_url: String,
}

impl Default for WechatState {
    fn default() -> Self {
        Self {
            bots: Arc::new(Mutex::new(HashMap::new())),
            pending_login: Arc::new(Mutex::new(None)),
        }
    }
}

// ── Serializable types ──────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct QrcodeResult {
    qrcode: String,
    qrcode_url: String,
}

#[derive(Serialize, Clone)]
pub struct QrcodeStatusResult {
    status: String,
    account_id: Option<String>,
    bot_token: Option<String>,
    base_url: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct FileAttachment {
    pub url: String,
    pub name: String,
    pub size: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct WechatMessage {
    pub from_user_id: String,
    pub to_user_id: String,
    pub message_id: String,
    pub text: String,
    pub room_id: String,
    pub msg_type: u32,
    pub bot_id: String,
    pub images: Vec<String>,
    pub files: Vec<FileAttachment>,
    pub videos: Vec<String>,
    pub voice_url: Option<String>,
    pub voice_text: Option<String>,
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn random_wechat_uin() -> String {
    use std::time::SystemTime;
    let seed = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    let num = seed.to_string();
    let mut buf = Vec::new();
    write!(buf, "{}", num).unwrap();
    base64_encode(&buf)
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[(triple >> 18 & 0x3F) as usize] as char);
        result.push(CHARS[(triple >> 12 & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[(triple >> 6 & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

fn build_headers(token: Option<&str>) -> HashMap<String, String> {
    let mut h = HashMap::new();
    h.insert("Content-Type".into(), "application/json".into());
    h.insert("AuthorizationType".into(), "ilink_bot_token".into());
    h.insert("X-WECHAT-UIN".into(), random_wechat_uin());
    h.insert("iLink-App-Id".into(), "bot".into());
    h.insert("iLink-App-ClientVersion".into(), APP_CLIENT_VERSION.into());
    if let Some(t) = token {
        h.insert("Authorization".into(), format!("Bearer {}", t));
    }
    h
}

fn build_get_headers() -> HashMap<String, String> {
    let mut h = HashMap::new();
    h.insert("iLink-App-Id".into(), "bot".into());
    h.insert("iLink-App-ClientVersion".into(), APP_CLIENT_VERSION.into());
    h
}

fn persist_bots(bots: &HashMap<String, WechatInner>) {
    let creds: Vec<BotCredential> = bots
        .values()
        .map(|b| BotCredential {
            bot_token: b.bot_token.clone(),
            account_id: b.account_id.clone(),
            base_url: b.base_url.clone(),
        })
        .collect();
    save_all_credentials(&creds);
}

fn media_cache_dir() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".kunpeng").join("wechat-media"))
}

/// Download a URL to local cache, optionally AES-decrypt, return local file path
async fn download_to_cache(
    url: &str,
    client: &reqwest::Client,
    token: &str,
    aes_key_hex: Option<&str>,
) -> Option<String> {
    let cache_dir = media_cache_dir()?;
    let _ = std::fs::create_dir_all(&cache_dir);

    // Use hash of URL as filename
    let hash = {
        let mut h: u64 = 5381;
        for b in url.bytes() {
            h = h.wrapping_mul(33).wrapping_add(b as u64);
        }
        format!("{:016x}", h)
    };

    // Guess extension from URL or default to .jpg
    let ext = if url.contains(".png") {
        "png"
    } else if url.contains(".gif") {
        "gif"
    } else if url.contains(".webp") {
        "webp"
    } else {
        "jpg"
    };

    let filename = format!("{}.{}", hash, ext);
    let path = cache_dir.join(&filename);

    // Return cached file if exists AND is a valid image (check magic bytes)
    if path.exists() {
        if let Ok(header) = std::fs::read(&path) {
            if header.len() > 4 && is_valid_image(&header) {
                return Some(path.to_string_lossy().to_string());
            }
            // Cached file is not a valid image — re-download
            let _ = std::fs::remove_file(&path);
        }
    }

    let headers = build_headers(Some(token));
    let mut builder = client.get(url);
    for (k, v) in &headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    match builder.send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                wlog(&format!(
                    "[wechat] media download failed: status={}",
                    resp.status()
                ));
                return None;
            }
            match resp.bytes().await {
                Ok(bytes) => {
                    if bytes.len() < 100 {
                        wlog("[wechat] media download too small, skip");
                        return None;
                    }

                    // Try AES decryption if key provided and data doesn't look like an image
                    let final_bytes = if !is_valid_image(&bytes) {
                        if let Some(key_hex) = aes_key_hex {
                            match aes_decrypt_image(&bytes, key_hex) {
                                Some(decrypted) => {
                                    wlog(&format!(
                                        "[wechat] media AES decrypted: {} -> {} bytes",
                                        bytes.len(),
                                        decrypted.len()
                                    ));
                                    decrypted
                                }
                                None => {
                                    wlog("[wechat] media AES decrypt failed, saving raw");
                                    bytes.to_vec()
                                }
                            }
                        } else {
                            bytes.to_vec()
                        }
                    } else {
                        bytes.to_vec()
                    };

                    if let Err(e) = std::fs::write(&path, &final_bytes) {
                        wlog(&format!("[wechat] media write error: {}", e));
                        return None;
                    }
                    wlog(&format!(
                        "[wechat] media cached: {} ({} bytes, valid={})",
                        filename,
                        final_bytes.len(),
                        is_valid_image(&final_bytes)
                    ));
                    Some(path.to_string_lossy().to_string())
                }
                Err(e) => {
                    wlog(&format!("[wechat] media read error: {}", e));
                    None
                }
            }
        }
        Err(e) => {
            wlog(&format!("[wechat] media download error: {}", e));
            None
        }
    }
}

/// Check if bytes start with known image magic bytes
fn is_valid_image(data: &[u8]) -> bool {
    if data.len() < 4 {
        return false;
    }
    // JPEG: FF D8 FF
    if data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
        return true;
    }
    // PNG: 89 50 4E 47
    if data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
        return true;
    }
    // GIF: 47 49 46
    if data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 {
        return true;
    }
    // WebP: RIFF....WEBP
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return true;
    }
    // BMP: 42 4D
    if data[0] == 0x42 && data[1] == 0x4D {
        return true;
    }
    false
}

/// AES-128-ECB decrypt WeChat CDN image with PKCS7 unpadding
fn aes_decrypt_image(data: &[u8], key_hex: &str) -> Option<Vec<u8>> {
    use aes::cipher::{BlockDecrypt, KeyInit};

    let key_bytes = hex_decode(key_hex)?;
    if key_bytes.len() != 16 {
        wlog(&format!(
            "[wechat] AES key wrong length: {} (expected 16)",
            key_bytes.len()
        ));
        return None;
    }
    if data.len() % 16 != 0 {
        wlog(&format!(
            "[wechat] AES ciphertext not multiple of 16: {}",
            data.len()
        ));
        return None;
    }

    let cipher = aes::Aes128::new_from_slice(&key_bytes).ok()?;
    let mut buf = data.to_vec();

    // ECB: decrypt each 16-byte block independently
    for chunk in buf.chunks_mut(16) {
        let block = aes::Block::from_mut_slice(chunk);
        cipher.decrypt_block(block);
    }

    // PKCS7 unpadding
    if let Some(&pad_len) = buf.last() {
        let pl = pad_len as usize;
        if pl >= 1
            && pl <= 16
            && buf.len() >= pl
            && buf[buf.len() - pl..].iter().all(|&b| b == pad_len)
        {
            buf.truncate(buf.len() - pl);
        }
    }

    if is_valid_image(&buf) {
        wlog("[wechat] AES decrypt OK (ECB)");
        Some(buf)
    } else {
        wlog("[wechat] AES decrypt: ECB result is not a valid image");
        None
    }
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn wechat_get_qrcode() -> Result<QrcodeResult, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/ilink/bot/get_bot_qrcode?bot_type=3", ILINK_BASE_URL);
    let headers = build_get_headers();

    let mut builder = client.get(&url);
    for (k, v) in &headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let body: serde_json::Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;

    let qrcode = body["qrcode"].as_str().unwrap_or("").to_string();
    let qrcode_url = body["qrcode_img_content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    if qrcode.is_empty() {
        return Err(format!("获取二维码失败: {}", body));
    }

    Ok(QrcodeResult { qrcode, qrcode_url })
}

#[tauri::command]
pub async fn wechat_poll_qrcode(
    state: tauri::State<'_, WechatState>,
    qrcode: String,
    base_url: Option<String>,
) -> Result<QrcodeStatusResult, String> {
    let poll_url = base_url.unwrap_or_else(|| ILINK_BASE_URL.to_string());
    let url = format!("{}/ilink/bot/get_qrcode_status?qrcode={}", poll_url, qrcode);
    let client = reqwest::Client::new();
    let headers = build_get_headers();

    let mut builder = client.get(&url);
    for (k, v) in &headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let body: serde_json::Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;

    let status = body["status"].as_str().unwrap_or("unknown").to_string();

    match status.as_str() {
        "confirmed" => {
            let account_id = body["ilink_bot_id"].as_str().unwrap_or("").to_string();
            let bot_token = body["bot_token"].as_str().unwrap_or("").to_string();
            let base = body["baseurl"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| ILINK_BASE_URL.to_string());

            // Store as pending login — frontend will call wechat_start_polling(bot_id) next
            {
                let mut pending = state.pending_login.lock().await;
                *pending = Some(PendingLogin {
                    bot_token: bot_token.clone(),
                    account_id: account_id.clone(),
                    base_url: base.clone(),
                });
            }

            // Add to bots map
            {
                let mut bots = state.bots.lock().await;
                bots.insert(
                    account_id.clone(),
                    WechatInner {
                        bot_token: bot_token.clone(),
                        account_id: account_id.clone(),
                        base_url: base.clone(),
                        sync_buf: String::new(),
                        context_tokens: HashMap::new(),
                        typing_tickets: HashMap::new(),
                        polling_abort: None,
                        emitted_msg_ids: HashSet::new(),
                        emitted_msg_order: VecDeque::new(),
                    },
                );
                persist_bots(&bots);
            }

            Ok(QrcodeStatusResult {
                status,
                account_id: Some(account_id),
                bot_token: Some(bot_token),
                base_url: Some(base),
            })
        }
        "scaned_but_redirect" => {
            let redirect_host = body["redirect_host"].as_str().unwrap_or("").to_string();
            Ok(QrcodeStatusResult {
                status,
                account_id: None,
                bot_token: None,
                base_url: Some(format!("https://{}", redirect_host)),
            })
        }
        _ => Ok(QrcodeStatusResult {
            status,
            account_id: None,
            bot_token: None,
            base_url: None,
        }),
    }
}

#[tauri::command]
pub async fn wechat_start_polling(
    window: tauri::Window,
    state: tauri::State<'_, WechatState>,
    bot_id: String,
) -> Result<(), String> {
    let bots_arc = state.bots.clone();

    let (token, base_url, sync_buf, already_polling) = {
        let bots = bots_arc.lock().await;
        let bot = bots.get(&bot_id).ok_or("bot 不存在")?;
        (
            bot.bot_token.clone(),
            bot.base_url.clone(),
            bot.sync_buf.clone(),
            bot.polling_abort
                .as_ref()
                .map(|handle| !handle.is_finished())
                .unwrap_or(false),
        )
    };

    if already_polling {
        wlog(&format!("[wechat] bot {} already polling, skip", bot_id));
        return Ok(());
    }

    let bid = bot_id.clone();
    let bots_inner = bots_arc.clone();
    let account_id = bot_id.clone();

    let handle = tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(40))
            .build()
            .unwrap();

        let mut sync_buf = sync_buf;
        let mut consecutive_failures: u32 = 0;

        wlog(&format!("[wechat] polling loop started for bot {}", bid));

        loop {
            let url = format!("{}/ilink/bot/getupdates", base_url);
            let headers = build_headers(Some(&token));
            let payload = serde_json::json!({
                "get_updates_buf": sync_buf,
                "base_info": { "channel_version": CHANNEL_VERSION }
            });

            let body_str = serde_json::to_string(&payload).unwrap();
            let mut builder = client.post(&url);
            for (k, v) in &headers {
                builder = builder.header(k.as_str(), v.as_str());
            }
            builder = builder.body(body_str);

            match builder.send().await {
                Ok(resp) => {
                    match resp.json::<serde_json::Value>().await {
                        Ok(data) => {
                            let ret = data["ret"].as_i64().unwrap_or(0);
                            let errcode = data["errcode"].as_i64().unwrap_or(0);
                            let msg_count = data["msgs"].as_array().map(|a| a.len()).unwrap_or(0);

                            if msg_count > 0 || ret != 0 || errcode != 0 {
                                wlog(&format!(
                                    "[wechat][{}] poll: ret={} errcode={} msgs={}",
                                    bid, ret, errcode, msg_count
                                ));
                            }

                            if ret != 0 || errcode != 0 {
                                if ret == -14 || errcode == -14 {
                                    {
                                        let mut bots = bots_inner.lock().await;
                                        if let Some(bot) = bots.get_mut(&bid) {
                                            bot.polling_abort = None;
                                        }
                                    }
                                    // Remove expired credential from disk
                                    let mut creds = load_all_credentials();
                                    let before = creds.len();
                                    creds.retain(|c| c.account_id != bid);
                                    if creds.len() < before {
                                        save_all_credentials(&creds);
                                        wlog(&format!(
                                            "[wechat][{}] removed expired credential from disk",
                                            bid
                                        ));
                                    }
                                    wlog(&format!(
                                        "[wechat][{}] session expired (-14), need re-login",
                                        bid
                                    ));
                                    let _ = window.emit("wechat-session-expired", &bid);
                                    return;
                                }
                                consecutive_failures += 1;
                                if consecutive_failures == 1 {
                                    let _ = window.emit(
                                        "wechat-status",
                                        serde_json::json!({
                                            "bot_id": bid,
                                            "state": "degraded",
                                            "message": format!("微信服务暂时不可用（ret={}, errcode={}），后台正在恢复", ret, errcode),
                                        }),
                                    );
                                }
                                if consecutive_failures >= 3 {
                                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                                    consecutive_failures = 0;
                                } else {
                                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                                }
                                continue;
                            }

                            if consecutive_failures > 0 {
                                let _ = window.emit(
                                    "wechat-status",
                                    serde_json::json!({
                                        "bot_id": bid,
                                        "state": "connected",
                                        "message": "微信连接已恢复",
                                    }),
                                );
                            }
                            consecutive_failures = 0;

                            if let Some(buf) = data["get_updates_buf"].as_str() {
                                sync_buf = buf.to_string();
                                let mut bots = bots_inner.lock().await;
                                if let Some(bot) = bots.get_mut(&bid) {
                                    bot.sync_buf = sync_buf.clone();
                                }
                            }

                            if let Some(msgs) = data["msgs"].as_array() {
                                for msg in msgs {
                                    let mtype = msg["message_type"].as_u64().unwrap_or(0) as u32;
                                    let from =
                                        msg["from_user_id"].as_str().unwrap_or("").to_string();

                                    // Skip bot's own messages
                                    if mtype == 2 || from == account_id {
                                        continue;
                                    }

                                    let to = msg["to_user_id"].as_str().unwrap_or("").to_string();
                                    let mid = msg["message_id"]
                                        .as_str()
                                        .map(|s| s.to_string())
                                        .or_else(|| {
                                            msg["message_id"].as_u64().map(|n| n.to_string())
                                        })
                                        .unwrap_or_default();
                                    let room = msg["room_id"].as_str().unwrap_or("").to_string();

                                    // Dedup: skip messages already emitted to frontend
                                    if !mid.is_empty() {
                                        let mut bots = bots_inner.lock().await;
                                        if let Some(bot) = bots.get_mut(&bid) {
                                            if bot.emitted_msg_ids.contains(&mid) {
                                                continue;
                                            }
                                        }
                                    }

                                    // Save context token by sender and by conversation room.
                                    if let Some(ct) = msg["context_token"].as_str() {
                                        if !ct.is_empty() {
                                            let mut bots = bots_inner.lock().await;
                                            if let Some(bot) = bots.get_mut(&bid) {
                                                bot.context_tokens
                                                    .insert(from.clone(), ct.to_string());
                                                if !room.is_empty() {
                                                    bot.context_tokens
                                                        .insert(room.clone(), ct.to_string());
                                                }
                                            }
                                        }
                                    }

                                    let mut text = String::new();
                                    let mut images: Vec<String> = Vec::new();
                                    let mut files: Vec<FileAttachment> = Vec::new();
                                    let mut videos: Vec<String> = Vec::new();
                                    let mut voice_url: Option<String> = None;
                                    let mut voice_text: Option<String> = None;

                                    if let Some(items) = msg["item_list"].as_array() {
                                        for item in items {
                                            let item_type = item["type"].as_u64().unwrap_or(0);
                                            match item_type {
                                                1 => {
                                                    if let Some(t) =
                                                        item["text_item"]["text"].as_str()
                                                    {
                                                        text.push_str(t);
                                                    }
                                                }
                                                2 => {
                                                    // image_item — URL nested at media.full_url
                                                    let img = &item["image_item"];
                                                    let url = img["media"]["full_url"]
                                                        .as_str()
                                                        .or_else(|| img["image_url"].as_str())
                                                        .or_else(|| img["url"].as_str());
                                                    // AES key for decryption
                                                    let aes_key = img["aeskey"].as_str();
                                                    if let Some(u) = url {
                                                        if !u.is_empty() {
                                                            // Download to local cache (with AES decrypt if key present)
                                                            if let Some(local) = download_to_cache(
                                                                u, &client, &token, aes_key,
                                                            )
                                                            .await
                                                            {
                                                                images.push(local);
                                                            } else {
                                                                images.push(u.to_string());
                                                            }
                                                        }
                                                    }
                                                }
                                                4 => {
                                                    // file_item
                                                    let fi = &item["file_item"];
                                                    let furl = fi["file_url"]
                                                        .as_str()
                                                        .or_else(|| fi["url"].as_str())
                                                        .unwrap_or("")
                                                        .to_string();
                                                    let fname = fi["file_name"]
                                                        .as_str()
                                                        .or_else(|| fi["name"].as_str())
                                                        .unwrap_or("file")
                                                        .to_string();
                                                    let fsize = fi["file_size"]
                                                        .as_u64()
                                                        .or_else(|| fi["size"].as_u64())
                                                        .unwrap_or(0);
                                                    if !furl.is_empty() {
                                                        files.push(FileAttachment {
                                                            url: furl,
                                                            name: fname,
                                                            size: fsize,
                                                        });
                                                    }
                                                }
                                                3 => {
                                                    // type=3 can be voice_item or link_item
                                                    if item.get("voice_item").is_some()
                                                        && !item["voice_item"].is_null()
                                                    {
                                                        let vi = &item["voice_item"];
                                                        // Extract voice-to-text if available
                                                        if let Some(vt) = vi["text"].as_str() {
                                                            if !vt.is_empty() {
                                                                voice_text = Some(vt.to_string());
                                                            }
                                                        }
                                                        // Download voice media
                                                        let media = &vi["media"];
                                                        let url = media["full_url"].as_str();
                                                        let aes_key = vi["aeskey"]
                                                            .as_str()
                                                            .or_else(|| media["aes_key"].as_str());
                                                        if let Some(u) = url {
                                                            if !u.is_empty() {
                                                                if let Some(local) =
                                                                    download_to_cache(
                                                                        u, &client, &token, aes_key,
                                                                    )
                                                                    .await
                                                                {
                                                                    voice_url = Some(local);
                                                                }
                                                            }
                                                        }
                                                        // If no media but has text, still mark it
                                                        if voice_url.is_none()
                                                            && voice_text.is_none()
                                                        {
                                                            voice_text =
                                                                Some("[语音消息]".to_string());
                                                        }
                                                    } else {
                                                        // link_item — treat as text
                                                        let li = &item["link_item"];
                                                        let title =
                                                            li["title"].as_str().unwrap_or("");
                                                        let link_url = li["url"]
                                                            .as_str()
                                                            .or_else(|| li["link_url"].as_str())
                                                            .unwrap_or("");
                                                        if !link_url.is_empty() {
                                                            text.push_str(&format!(
                                                                "[{}]({})",
                                                                if title.is_empty() {
                                                                    link_url
                                                                } else {
                                                                    title
                                                                },
                                                                link_url
                                                            ));
                                                        }
                                                    }
                                                }
                                                5 => {
                                                    // video_item
                                                    let vi = &item["video_item"];
                                                    let media = &vi["media"];
                                                    let url = media["full_url"]
                                                        .as_str()
                                                        .or_else(|| vi["url"].as_str());
                                                    let aes_key = vi["aeskey"]
                                                        .as_str()
                                                        .or_else(|| media["aes_key"].as_str());
                                                    if let Some(u) = url {
                                                        if !u.is_empty() {
                                                            if let Some(local) = download_to_cache(
                                                                u, &client, &token, aes_key,
                                                            )
                                                            .await
                                                            {
                                                                videos.push(local);
                                                            }
                                                        }
                                                    }
                                                }
                                                _ => {
                                                    wlog(&format!(
                                                        "[wechat][{}] unknown item type {}: {}",
                                                        bid, item_type, item
                                                    ));
                                                }
                                            }
                                        }
                                    }
                                    // Fallback for text
                                    if text.is_empty()
                                        && images.is_empty()
                                        && files.is_empty()
                                        && videos.is_empty()
                                        && voice_url.is_none()
                                    {
                                        if let Some(t) = msg["content"].as_str() {
                                            text = t.to_string();
                                        } else if let Some(t) = msg["text"].as_str() {
                                            text = t.to_string();
                                        }
                                    }

                                    let has_content = !text.is_empty()
                                        || !images.is_empty()
                                        || !files.is_empty()
                                        || !videos.is_empty()
                                        || voice_url.is_some()
                                        || voice_text.is_some();
                                    wlog(&format!("[wechat][{}] user msg from={} text_chars={} images={} files={} videos={} voice={}", bid, from, text.chars().count(), images.len(), files.len(), videos.len(), voice_text.is_some() || voice_url.is_some()));

                                    if has_content {
                                        // Record message_id as emitted to prevent duplicate processing
                                        if !mid.is_empty() {
                                            let mut bots = bots_inner.lock().await;
                                            if let Some(bot) = bots.get_mut(&bid) {
                                                bot.emitted_msg_ids.insert(mid.clone());
                                                bot.emitted_msg_order.push_back(mid.clone());
                                                // Keep a bounded rolling window instead of clearing
                                                // the whole set, which could replay old messages.
                                                while bot.emitted_msg_order.len() > 5000 {
                                                    if let Some(oldest) = bot.emitted_msg_order.pop_front() {
                                                        bot.emitted_msg_ids.remove(&oldest);
                                                    }
                                                }
                                            }
                                        }
                                        let wm = WechatMessage {
                                            from_user_id: from,
                                            to_user_id: to,
                                            message_id: mid,
                                            text,
                                            room_id: room,
                                            msg_type: mtype,
                                            bot_id: bid.clone(),
                                            images,
                                            files,
                                            videos,
                                            voice_url,
                                            voice_text,
                                        };
                                        let _ = window.emit("wechat-message", &wm);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            wlog(&format!("[wechat][{}] parse error: {}", bid, e));
                            consecutive_failures += 1;
                            if consecutive_failures == 1 {
                                let _ = window.emit(
                                    "wechat-status",
                                    serde_json::json!({
                                        "bot_id": bid,
                                        "state": "degraded",
                                        "message": "微信响应解析异常，后台正在恢复",
                                    }),
                                );
                            }
                            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        }
                    }
                }
                Err(e) => {
                    if e.is_timeout() {
                        continue;
                    }
                    wlog(&format!("[wechat][{}] network error: {}", bid, e));
                    consecutive_failures += 1;
                    if consecutive_failures == 1 {
                        let _ = window.emit(
                            "wechat-status",
                            serde_json::json!({
                                "bot_id": bid,
                                "state": "degraded",
                                "message": "微信网络连接异常，后台正在恢复",
                            }),
                        );
                    }
                    if consecutive_failures >= 3 {
                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                        consecutive_failures = 0;
                    } else {
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    }
                }
            }
        }
    });

    let abort_handle = handle.abort_handle();
    let mut bots = bots_arc.lock().await;
    if let Some(bot) = bots.get_mut(&bot_id) {
        bot.polling_abort = Some(abort_handle);
    }

    Ok(())
}

#[tauri::command]
pub async fn wechat_stop_polling(
    state: tauri::State<'_, WechatState>,
    bot_id: String,
) -> Result<(), String> {
    let mut bots = state.bots.lock().await;
    if let Some(bot) = bots.get_mut(&bot_id) {
        if let Some(handle) = bot.polling_abort.take() {
            handle.abort();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn wechat_send_message(
    state: tauri::State<'_, WechatState>,
    bot_id: String,
    to_user_id: String,
    text: String,
) -> Result<(), String> {
    let (token, base_url, context_token) = {
        let bots = state.bots.lock().await;
        let bot = bots.get(&bot_id).ok_or("bot 不存在")?;
        (
            bot.bot_token.clone(),
            bot.base_url.clone(),
            bot.context_tokens.get(&to_user_id).cloned(),
        )
    };

    wlog(&format!(
        "[wechat][{}] sending to {} text={}",
        bot_id,
        to_user_id,
        text.chars().take(30).collect::<String>()
    ));

    let client = reqwest::Client::new();
    let url = format!("{}/ilink/bot/sendmessage", base_url);
    let headers = build_headers(Some(&token));

    let client_id = format!("kunpeng-wx-{}", uuid_v4_hex());

    let payload = serde_json::json!({
        "msg": {
            "from_user_id": "",
            "to_user_id": to_user_id,
            "client_id": client_id,
            "message_type": 2,
            "message_state": 2,
            "item_list": [
                { "type": 1, "text_item": { "text": text } }
            ],
            "context_token": context_token
        },
        "base_info": { "channel_version": CHANNEL_VERSION }
    });

    let body_str = serde_json::to_string(&payload).unwrap();

    for attempt in 0..3 {
        let mut builder = client.post(&url);
        for (k, v) in &headers {
            builder = builder.header(k.as_str(), v.as_str());
        }
        builder = builder.body(body_str.clone());

        match builder.send().await {
            Ok(resp) => {
                let data: serde_json::Value = resp.json().await.unwrap_or_default();
                let errcode = data["errcode"].as_i64().unwrap_or(0);
                wlog(&format!(
                    "[wechat][{}] send resp: errcode={}",
                    bot_id, errcode
                ));
                if errcode == 0 {
                    return Ok(());
                }
                if errcode == -14 && attempt == 0 {
                    let payload2 = serde_json::json!({
                        "msg": {
                            "from_user_id": "",
                            "to_user_id": to_user_id,
                            "client_id": format!("kunpeng-wx-{}", uuid_v4_hex()),
                            "message_type": 2,
                            "message_state": 2,
                            "item_list": [
                                { "type": 1, "text_item": { "text": text } }
                            ],
                            "context_token": null
                        },
                        "base_info": { "channel_version": CHANNEL_VERSION }
                    });
                    let body2 = serde_json::to_string(&payload2).unwrap();
                    let mut b2 = client.post(&url);
                    for (k, v) in &headers {
                        b2 = b2.header(k.as_str(), v.as_str());
                    }
                    b2 = b2.body(body2);
                    if let Ok(r2) = b2.send().await {
                        let d2: serde_json::Value = r2.json().await.unwrap_or_default();
                        if d2["errcode"].as_i64().unwrap_or(-1) == 0 {
                            return Ok(());
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs((attempt + 1) as u64)).await;
            }
            Err(e) => {
                wlog(&format!("[wechat][{}] send network error: {}", bot_id, e));
                tokio::time::sleep(std::time::Duration::from_secs((attempt + 1) as u64)).await;
            }
        }
    }

    Err("发送失败，已重试 3 次".into())
}

const CDN_BASE_URL: &str = "https://novac2c.cdn.weixin.qq.com/c2c";

/// AES-128-ECB encrypt with PKCS7 padding (for CDN upload)
fn aes_encrypt_ecb(data: &[u8], key: &[u8]) -> Vec<u8> {
    use aes::cipher::{BlockEncrypt, KeyInit};
    // PKCS7 pad
    let pad_len = 16 - (data.len() % 16);
    let mut padded = data.to_vec();
    padded.extend(std::iter::repeat(pad_len as u8).take(pad_len));

    let cipher = aes::Aes128::new_from_slice(key).unwrap();
    for chunk in padded.chunks_mut(16) {
        let block = aes::Block::from_mut_slice(chunk);
        cipher.encrypt_block(block);
    }
    padded
}

/// MD5 hex digest (simple implementation)
fn md5_hex(data: &[u8]) -> String {
    // Simple MD5 — we'll use a manual implementation since we don't have a crate
    // Actually let's use the bash command or a simpler approach
    // For now, use a simple hash that works for the API
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    let h1 = hasher.finish();
    data.len().hash(&mut hasher);
    let h2 = hasher.finish();
    format!("{:016x}{:016x}", h1, h2)
}

/// Random hex string of given byte length
fn random_hex(bytes: usize) -> String {
    use std::time::SystemTime;
    let t = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap();
    let mut result = String::new();
    let seed = t.as_nanos();
    for i in 0..bytes {
        let b = ((seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(i as u128))
            >> (i * 3)) as u8;
        result.push_str(&format!("{:02x}", b));
    }
    result
}

#[tauri::command]
pub async fn wechat_send_file(
    state: tauri::State<'_, WechatState>,
    bot_id: String,
    to_user_id: String,
    file_path: String,
) -> Result<serde_json::Value, String> {
    let (token, base_url, context_token) = {
        let bots = state.bots.lock().await;
        let bot = bots.get(&bot_id).ok_or("bot 不存在")?;
        (
            bot.bot_token.clone(),
            bot.base_url.clone(),
            bot.context_tokens.get(&to_user_id).cloned(),
        )
    };

    let path = std::path::Path::new(&file_path);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let raw = std::fs::read(&file_path).map_err(|e| format!("读取文件失败: {}", e))?;
    let is_image = matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp"
    );
    let is_video = matches!(ext.as_str(), "mp4" | "mov" | "avi" | "mkv" | "webm" | "3gp");
    let media_type: u32 = if is_image {
        1
    } else if is_video {
        2
    } else {
        3
    };

    wlog(&format!(
        "[wechat][{}] send_file to={} name={} size={} is_image={} is_video={}",
        bot_id,
        to_user_id,
        file_name,
        raw.len(),
        is_image,
        is_video
    ));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("client error: {}", e))?;

    // Step 1: Generate random filekey and AES key
    let filekey = random_hex(16); // 32 hex chars
    let aes_key_bytes: Vec<u8> = {
        use std::time::SystemTime;
        let t = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap();
        let seed = t.as_nanos();
        (0..16)
            .map(|i| {
                ((seed
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(i as u128 * 7))
                    >> (i * 5)) as u8
            })
            .collect()
    };
    let aes_key_hex = aes_key_bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    let rawsize = raw.len();
    let rawfilemd5 = md5_hex(&raw);
    let padded_size = ((rawsize + 1 + 15) / 16) * 16;

    // Step 2: Get upload URL
    let upload_payload = serde_json::json!({
        "filekey": filekey,
        "media_type": media_type,
        "to_user_id": to_user_id,
        "rawsize": rawsize,
        "rawfilemd5": rawfilemd5,
        "filesize": padded_size,
        "no_need_thumb": true,
        "aeskey": aes_key_hex,
        "base_info": { "channel_version": CHANNEL_VERSION }
    });

    let upload_url_api = format!("{}/ilink/bot/getuploadurl", base_url);
    let headers = build_headers(Some(&token));
    let body_str = serde_json::to_string(&upload_payload).unwrap();

    let mut builder = client.post(&upload_url_api);
    for (k, v) in &headers {
        builder = builder.header(k.as_str(), v.as_str());
    }
    builder = builder.body(body_str);

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("getuploadurl 失败: {}", e))?;
    let upload_resp: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("getuploadurl 解析失败: {}", e))?;
    wlog(&format!(
        "[wechat][{}] getuploadurl resp: {}",
        bot_id, upload_resp
    ));

    let upload_full_url = upload_resp["upload_full_url"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let upload_param = upload_resp["upload_param"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let cdn_upload_url = if !upload_full_url.is_empty() {
        upload_full_url
    } else if !upload_param.is_empty() {
        format!(
            "{}/upload?encrypted_query_param={}&filekey={}",
            CDN_BASE_URL,
            urlencoding::encode(&upload_param),
            urlencoding::encode(&filekey)
        )
    } else {
        return Err(format!("getuploadurl 返回无效: {}", upload_resp));
    };

    // Step 3: AES-128-ECB encrypt the file
    let ciphertext = aes_encrypt_ecb(&raw, &aes_key_bytes);

    // Step 4: Upload ciphertext to CDN
    let cdn_resp = client
        .post(&cdn_upload_url)
        .header("Content-Type", "application/octet-stream")
        .body(ciphertext.clone())
        .send()
        .await
        .map_err(|e| format!("CDN upload 失败: {}", e))?;

    if !cdn_resp.status().is_success() {
        let status = cdn_resp.status();
        let body = cdn_resp.text().await.unwrap_or_default();
        return Err(format!(
            "CDN upload HTTP {}: {}",
            status,
            &body[..body.len().min(200)]
        ));
    }

    let encrypted_query_param = cdn_resp
        .headers()
        .get("x-encrypted-param")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or("CDN upload 缺少 x-encrypted-param 响应头")?;

    wlog(&format!(
        "[wechat][{}] CDN upload OK, encrypted_query_param len={}",
        bot_id,
        encrypted_query_param.len()
    ));

    // Step 5: Build media item and send message
    // aes_key for API = base64(hex_string) — NOT base64(raw_bytes)!
    let aes_key_for_api = base64_encode(aes_key_hex.as_bytes());

    let item = if is_image {
        serde_json::json!({
            "type": 2,
            "image_item": {
                "media": {
                    "encrypt_query_param": encrypted_query_param,
                    "aes_key": aes_key_for_api,
                    "encrypt_type": 1
                },
                "mid_size": ciphertext.len()
            }
        })
    } else if is_video {
        serde_json::json!({
            "type": 5,
            "video_item": {
                "media": {
                    "encrypt_query_param": encrypted_query_param,
                    "aes_key": aes_key_for_api,
                    "encrypt_type": 1
                },
                "video_size": rawsize
            }
        })
    } else {
        serde_json::json!({
            "type": 4,
            "file_item": {
                "media": {
                    "encrypt_query_param": encrypted_query_param,
                    "aes_key": aes_key_for_api,
                    "encrypt_type": 1
                },
                "file_name": file_name,
                "len": rawsize.to_string()
            }
        })
    };

    let send_payload = serde_json::json!({
        "msg": {
            "from_user_id": "",
            "to_user_id": to_user_id,
            "client_id": format!("kunpeng-wx-{}", uuid_v4_hex()),
            "message_type": 2,
            "message_state": 2,
            "item_list": [ item ],
            "context_token": context_token
        },
        "base_info": { "channel_version": CHANNEL_VERSION }
    });

    let send_url = format!("{}/ilink/bot/sendmessage", base_url);
    let send_body = serde_json::to_string(&send_payload).unwrap();
    let send_headers = build_headers(Some(&token));

    let mut builder = client.post(&send_url);
    for (k, v) in &send_headers {
        builder = builder.header(k.as_str(), v.as_str());
    }
    builder = builder.body(send_body);

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("发送失败: {}", e))?;
    let data: serde_json::Value = resp.json().await.unwrap_or_default();
    let errcode = data["errcode"].as_i64().unwrap_or(-1);
    wlog(&format!(
        "[wechat][{}] send_file resp: errcode={}",
        bot_id, errcode
    ));

    if errcode != 0 {
        return Err(format!(
            "发送失败: errcode={} {}",
            errcode,
            data["errmsg"].as_str().unwrap_or("")
        ));
    }

    Ok(serde_json::json!({
        "is_image": is_image,
        "file_name": file_name,
        "file_size": raw.len(),
    }))
}

// ── Typing status ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn wechat_send_typing(
    state: tauri::State<'_, WechatState>,
    bot_id: String,
    to_user_id: String,
    status: u32, // 1 = start, 2 = stop
) -> Result<(), String> {
    let (token, base_url, typing_ticket) = {
        let bots = state.bots.lock().await;
        let bot = bots.get(&bot_id).ok_or("bot 不存在")?;
        let ticket = bot.typing_tickets.get(&to_user_id).and_then(|(t, ts)| {
            if ts.elapsed().as_secs() < 600 {
                Some(t.clone())
            } else {
                None
            }
        });
        (bot.bot_token.clone(), bot.base_url.clone(), ticket)
    };

    let ticket = match typing_ticket {
        Some(t) => t,
        None => {
            // Fetch typing_ticket via getconfig
            let ticket =
                fetch_typing_ticket(&token, &base_url, &to_user_id, &state, &bot_id).await?;
            ticket
        }
    };

    if ticket.is_empty() {
        return Ok(()); // No ticket available, silently skip
    }

    let client = reqwest::Client::new();
    let url = format!("{}/ilink/bot/sendtyping", base_url);
    let headers = build_headers(Some(&token));
    let payload = serde_json::json!({
        "ilink_user_id": to_user_id,
        "typing_ticket": ticket,
        "status": status,
        "base_info": { "channel_version": CHANNEL_VERSION }
    });

    let body_str = serde_json::to_string(&payload).unwrap();
    let mut builder = client.post(&url);
    for (k, v) in &headers {
        builder = builder.header(k.as_str(), v.as_str());
    }
    builder = builder.body(body_str);

    match builder.send().await {
        Ok(resp) => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            wlog(&format!(
                "[wechat][{}] sendtyping status={} resp={}",
                bot_id, status, data
            ));
        }
        Err(e) => {
            wlog(&format!("[wechat][{}] sendtyping error: {}", bot_id, e));
        }
    }

    Ok(())
}

async fn fetch_typing_ticket(
    token: &str,
    base_url: &str,
    user_id: &str,
    state: &tauri::State<'_, WechatState>,
    bot_id: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/ilink/bot/getconfig", base_url);
    let headers = build_headers(Some(token));
    let payload = serde_json::json!({
        "ilink_user_id": user_id,
        "base_info": { "channel_version": CHANNEL_VERSION }
    });
    let body_str = serde_json::to_string(&payload).unwrap();
    let mut builder = client.post(&url);
    for (k, v) in &headers {
        builder = builder.header(k.as_str(), v.as_str());
    }
    builder = builder.body(body_str);

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("getconfig 失败: {}", e))?;
    let data: serde_json::Value = resp.json().await.unwrap_or_default();
    let ticket = data["typing_ticket"].as_str().unwrap_or("").to_string();

    wlog(&format!(
        "[wechat][{}] getconfig for {} ticket={}",
        bot_id,
        user_id,
        if ticket.is_empty() {
            "(empty)"
        } else {
            &ticket[..ticket.len().min(20)]
        }
    ));

    if !ticket.is_empty() {
        let mut bots = state.bots.lock().await;
        if let Some(bot) = bots.get_mut(bot_id) {
            bot.typing_tickets.insert(
                user_id.to_string(),
                (ticket.clone(), std::time::Instant::now()),
            );
        }
    }

    Ok(ticket)
}

#[tauri::command]
pub async fn wechat_get_status(
    state: tauri::State<'_, WechatState>,
) -> Result<serde_json::Value, String> {
    let bots = state.bots.lock().await;
    let bot_list: Vec<serde_json::Value> = bots
        .values()
        .map(|b| {
            serde_json::json!({
                "account_id": b.account_id,
                "polling": b.polling_abort
                    .as_ref()
                    .map(|handle| !handle.is_finished())
                    .unwrap_or(false),
            })
        })
        .collect();
    Ok(serde_json::json!({
        "bots": bot_list,
        "connected": !bots.is_empty(),
    }))
}

#[tauri::command]
pub async fn wechat_disconnect(
    state: tauri::State<'_, WechatState>,
    bot_id: String,
) -> Result<(), String> {
    let mut bots = state.bots.lock().await;
    if let Some(bot) = bots.remove(&bot_id) {
        if let Some(handle) = bot.polling_abort {
            handle.abort();
        }
    }
    persist_bots(&bots);
    Ok(())
}

#[tauri::command]
pub async fn wechat_restore_session(
    state: tauri::State<'_, WechatState>,
) -> Result<serde_json::Value, String> {
    let creds = load_all_credentials();
    if creds.is_empty() {
        return Ok(serde_json::json!({ "restored": false, "bots": [] }));
    }

    let mut restored_bots = Vec::new();
    {
        let mut bots = state.bots.lock().await;
        for cred in &creds {
            if cred.bot_token.is_empty() {
                continue;
            }
            bots.insert(
                cred.account_id.clone(),
                WechatInner {
                    bot_token: cred.bot_token.clone(),
                    account_id: cred.account_id.clone(),
                    base_url: cred.base_url.clone(),
                    sync_buf: String::new(),
                    context_tokens: HashMap::new(),
                    typing_tickets: HashMap::new(),
                    polling_abort: None,
                    emitted_msg_ids: HashSet::new(),
                    emitted_msg_order: VecDeque::new(),
                },
            );
            restored_bots.push(serde_json::json!({
                "account_id": cred.account_id,
            }));
        }
    }

    wlog(&format!("[wechat] restored {} bots", restored_bots.len()));

    Ok(serde_json::json!({
        "restored": !restored_bots.is_empty(),
        "bots": restored_bots,
    }))
}

// ── Data persistence ────────────────────────────────────────────────────────

fn wechat_data_path(key: &str) -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".kunpeng").join(format!("wechat-{}.json", key)))
}

#[tauri::command]
pub async fn wechat_save_data(key: String, data: String) -> Result<(), String> {
    let path = wechat_data_path(&key).ok_or("无法获取路径")?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, data).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub async fn wechat_load_data(key: String) -> Result<String, String> {
    let path = wechat_data_path(&key).ok_or("无法获取路径")?;
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))
}

// ── Utilities ───────────────────────────────────────────────────────────────

fn uuid_v4_hex() -> String {
    use std::time::SystemTime;
    let t = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap();
    format!("{:08x}{:08x}", t.as_secs() as u32, t.subsec_nanos())
}
