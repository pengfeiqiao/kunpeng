use futures::stream;
use serde::Serialize;
use std::path::Path;
use std::time::Duration;
use tauri::Window;
use tokio::io::AsyncReadExt;

const UPLOAD_EVENT: &str = "kimi-video-upload-progress";
const CHUNK_SIZE: usize = 1024 * 1024;
const MAX_VIDEO_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KimiUploadProgress {
    upload_id: String,
    loaded_bytes: u64,
    total_bytes: u64,
    percent: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiUploadResult {
    file_id: String,
    url: String,
}

fn files_endpoint(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/coding/v1") || base.ends_with("/v1") {
        format!("{}/files", base)
    } else {
        format!("{}/v1/files", base)
    }
}

fn emit_progress(window: &Window, upload_id: &str, loaded: u64, total: u64) {
    let percent = if total == 0 {
        0
    } else {
        ((loaded.saturating_mul(100) / total).min(100)) as u8
    };
    let _ = window.emit(
        UPLOAD_EVENT,
        KimiUploadProgress {
            upload_id: upload_id.to_string(),
            loaded_bytes: loaded,
            total_bytes: total,
            percent,
        },
    );
}

#[tauri::command]
pub async fn kimi_upload_video(
    window: Window,
    api_key: String,
    base_url: String,
    file_path: String,
    upload_id: String,
) -> Result<KimiUploadResult, String> {
    if api_key.trim().is_empty() {
        return Err("未配置 Kimi API Key".to_string());
    }
    if upload_id.trim().is_empty() {
        return Err("Kimi 上传任务缺少 uploadId".to_string());
    }

    let path = Path::new(&file_path);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("video.mp4")
        .to_string();
    let mime = super::mime_of_path(&file_path);
    if !mime.starts_with("video/") {
        return Err(format!("Kimi 只接受视频文件，当前类型为 {}", mime));
    }

    let file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("读取 Kimi 视频失败: {}", error))?;
    let total = file
        .metadata()
        .await
        .map_err(|error| format!("读取 Kimi 视频大小失败: {}", error))?
        .len();
    if total == 0 {
        return Err("不能上传空视频".to_string());
    }
    if total > MAX_VIDEO_BYTES {
        return Err(format!(
            "视频大小为 {:.1} MB，超过 Kimi 文件输入的 100 MB 上限",
            total as f64 / 1024.0 / 1024.0
        ));
    }

    emit_progress(&window, &upload_id, 0, total);
    let progress_window = window.clone();
    let progress_id = upload_id.clone();
    let body_stream = stream::try_unfold((file, 0_u64), move |(mut file, loaded)| {
        let progress_window = progress_window.clone();
        let progress_id = progress_id.clone();
        async move {
            let mut buffer = vec![0_u8; CHUNK_SIZE];
            let read = file.read(&mut buffer).await?;
            if read == 0 {
                return Ok::<_, std::io::Error>(None);
            }
            buffer.truncate(read);
            let next_loaded = loaded + read as u64;
            emit_progress(&progress_window, &progress_id, next_loaded, total);
            Ok(Some((buffer, (file, next_loaded))))
        }
    });

    let part = reqwest::multipart::Part::stream_with_length(
        reqwest::Body::wrap_stream(body_stream),
        total,
    )
    .file_name(file_name)
    .mime_str(mime)
    .map_err(|error| format!("设置 Kimi 视频类型失败: {}", error))?;
    let form = reqwest::multipart::Form::new()
        .text("purpose", "video")
        .part("file", part);

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|error| format!("创建 Kimi 上传客户端失败: {}", error))?;
    let response = client
        .post(files_endpoint(&base_url))
        .bearer_auth(api_key.trim())
        .header("User-Agent", "Kunpeng/2.6.24")
        .header("x-app", "kunpeng")
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Kimi 视频上传失败: {}", error))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取 Kimi 上传响应失败: {}", error))?;
    if !status.is_success() {
        // Never surface the credential if an error body echoes it back.
        let safe = text.replace(api_key.trim(), "[REDACTED]");
        return Err(format!(
            "Kimi 视频上传被拒绝 (HTTP {}): {}",
            status.as_u16(),
            safe.chars().take(600).collect::<String>()
        ));
    }

    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("Kimi 上传响应不是 JSON: {}; {}", error, text))?;
    let file_id = parsed
        .get("id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Kimi 上传成功但没有返回文件 ID: {}", text))?
        .to_string();
    emit_progress(&window, &upload_id, total, total);

    Ok(KimiUploadResult {
        url: format!("ms://{}", file_id),
        file_id,
    })
}

#[cfg(test)]
mod tests {
    use super::files_endpoint;

    #[test]
    fn normalizes_kimi_file_endpoints() {
        assert_eq!(
            files_endpoint("https://api.kimi.com/coding/"),
            "https://api.kimi.com/coding/v1/files"
        );
        assert_eq!(
            files_endpoint("https://api.kimi.com/coding/v1"),
            "https://api.kimi.com/coding/v1/files"
        );
    }
}
