//! Bounded-memory command capture. Full output is spooled up to a disk quota;
//! the model can page it without re-running a command.
use std::{
    io::Read,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
const MAX_BYTES: usize = 16 * 1024 * 1024;
static NEXT: AtomicU64 = AtomicU64::new(0);
#[derive(Debug)]
struct LogFile(PathBuf);
impl Drop for LogFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
#[derive(Clone, Debug)]
pub(super) struct CapturedOutput {
    file: Arc<LogFile>,
    pub bytes: usize,
    pub chars: usize,
    pub capped: bool,
}

// Retain incomplete UTF-8 sequences across read boundaries; replace malformed bytes.
fn decode(pending: &mut Vec<u8>, eof: bool) -> String {
    let mut text = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(valid) => {
                text.push_str(valid);
                pending.clear();
                break;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                text.push_str(std::str::from_utf8(&pending[..valid]).unwrap());
                pending.drain(..valid);
                if let Some(size) = error.error_len() {
                    text.push('\u{fffd}');
                    pending.drain(..size);
                } else {
                    if eof {
                        text.push('\u{fffd}');
                        pending.clear();
                    }
                    break;
                }
            }
        }
    }
    text
}
impl CapturedOutput {
    pub fn page(
        &self,
        offset: usize,
        limit: usize,
    ) -> Result<(String, usize, Option<usize>), String> {
        let mut file = std::fs::File::open(&self.file.0).map_err(|e| e.to_string())?;
        let mut pending = Vec::new();
        let mut buffer = [0; 8192];
        let mut seen = 0;
        let mut result = String::new();
        let mut returned = 0;
        loop {
            let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
            pending.extend_from_slice(&buffer[..n]);
            for ch in decode(&mut pending, n == 0).chars() {
                if seen >= offset && returned < limit {
                    result.push(ch);
                    returned += 1;
                }
                seen += 1;
            }
            if n == 0 || returned >= limit {
                break;
            }
        }
        let end = offset.saturating_add(returned);
        Ok((result, returned, (end < self.chars).then_some(end)))
    }
}
async fn append(
    file: &mut tokio::fs::File,
    text: &str,
    output: &mut CapturedOutput,
    cap: usize,
) -> Result<(), String> {
    let remaining = cap.saturating_sub(output.bytes);
    let mut end = remaining.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    file.write_all(text[..end].as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    output.bytes += end;
    output.chars += text[..end].chars().count();
    output.capped |= end < text.len();
    Ok(())
}
pub(super) async fn capture(reader: impl AsyncRead + Unpin) -> Result<CapturedOutput, String> {
    capture_with_limit(reader, MAX_BYTES).await
}
async fn capture_with_limit(
    mut reader: impl AsyncRead + Unpin,
    cap: usize,
) -> Result<CapturedOutput, String> {
    let path = std::env::temp_dir().join(format!(
        "kunpeng-output-{}-{}-{}.log",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&path).await.map_err(|e| e.to_string())?;
    let mut output = CapturedOutput {
        file: Arc::new(LogFile(path)),
        bytes: 0,
        chars: 0,
        capped: false,
    };
    let mut buffer = [0; 8192];
    let mut pending = Vec::new();
    loop {
        let n = reader.read(&mut buffer).await.map_err(|e| e.to_string())?;
        pending.extend_from_slice(&buffer[..n]);
        append(&mut file, &decode(&mut pending, n == 0), &mut output, cap).await?;
        if n == 0 {
            break;
        }
    }
    if output.capped {
        let notice =
            "\n[命令日志超过 16MiB 保存上限，后续输出已丢弃；不要为读取日志重新执行命令。]\n";
        file.write_all(notice.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        output.bytes += notice.len();
        output.chars += notice.chars().count();
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(output)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn multibyte_paging_and_file_cleanup() {
        let text = "a".repeat(8191) + "鲲鹏🎥尾部";
        let output = capture(text.as_bytes()).await.unwrap();
        let path = output.file.0.clone();
        assert_eq!(output.page(8191, 3).unwrap().0, "鲲鹏🎥");
        assert_eq!(output.page(8194, 3).unwrap().0, "尾部");
        let copy = output.clone();
        drop(output);
        assert!(path.exists());
        drop(copy);
        assert!(!path.exists());
    }
    #[tokio::test]
    async fn huge_output_is_drained_but_disk_is_bounded() {
        let text = "z".repeat(200_000);
        let output = capture_with_limit(text.as_bytes(), 1024).await.unwrap();
        assert!(output.capped);
        assert!(output.bytes < 2048);
        assert!(output.page(1024, 200).unwrap().0.contains("保存上限"));
    }
}
