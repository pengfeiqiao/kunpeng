use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use serde::Serialize;

// ── Payloads emitted to the frontend ─────────────────────────────────────────

#[derive(Serialize, Clone)]
struct StreamChunkPayload {
    request_id: String,
    chunk: String,
}

#[derive(Serialize, Clone)]
struct StreamErrorPayload {
    request_id: String,
    status: u16,
    message: String,
}

#[derive(Serialize, Clone)]
struct StreamDonePayload {
    request_id: String,
}

// ── Shared state for abort support ───────────────────────────────────────────
//
// The `active` map is wrapped in `Arc<Mutex<...>>` (std, not tokio) so:
//   * The Drop guard on the spawned task can synchronously remove its entry
//     when the task ends, no matter how — natural completion, early return,
//     panic, or `AbortHandle::abort()`.
//   * The lock is only held for an O(1) HashMap insert/remove and never
//     across an `await`, so a blocking std::Mutex is fine inside async code.
//   * `tauri::State<StreamProxyState>` and the spawned task can both share
//     the same logical map by cloning the inner Arc — no global singletons.

type ActiveMap = Arc<Mutex<HashMap<String, tokio::task::AbortHandle>>>;

#[derive(Clone)]
pub struct StreamProxyState {
    active: ActiveMap,
    client: reqwest::Client,
}

impl Default for StreamProxyState {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .tcp_keepalive(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
            client,
        }
    }
}

impl StreamProxyState {
    /// Abort every active stream. Used during graceful shutdown so spawned
    /// tasks don't get yanked by the runtime mid-network-read (which can
    /// leave the underlying TCP socket in TIME_WAIT and the destination
    /// server thinking we'll come back).
    pub fn abort_all(&self) -> usize {
        let mut map = self.active.lock().unwrap();
        let count = map.len();
        for (_, handle) in map.drain() {
            handle.abort();
        }
        count
    }
}

// ── Timeout config (env-overridable, see plan Tier 0.1 / Tier 1.5) ──────────

fn env_duration_ms(key: &str, default_ms: u64) -> std::time::Duration {
    let ms = std::env::var(key)
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(default_ms);
    std::time::Duration::from_millis(ms)
}

fn first_chunk_timeout() -> std::time::Duration {
    env_duration_ms("KUNPENG_STREAM_FIRST_CHUNK_TIMEOUT_MS", 120_000)
}

fn idle_timeout() -> std::time::Duration {
    env_duration_ms("KUNPENG_STREAM_IDLE_TIMEOUT_MS", 90_000)
}

// ── Active-task guard ────────────────────────────────────────────────────────
//
// RAII removes the request_id from `state.active` when the spawned task ends,
// no matter how it ends. Without this, the HashMap leaked entries on every
// stream that didn't go through `abort_stream_request` (i.e. virtually every
// stream) — a slow memory leak that compounded over a session.

struct ActiveGuard {
    active: ActiveMap,
    rid: String,
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = self.active.lock() {
            map.remove(&self.rid);
        }
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Stream an HTTP POST request and emit SSE chunks as Tauri events.
///
/// The command spawns a background task that:
/// 1. Sends the POST request with all provided headers (bypassing CORS).
/// 2. Reads the streaming response body chunk-by-chunk.
/// 3. Emits `stream-chunk-{request_id}` for each chunk.
/// 4. Emits `stream-done-{request_id}` when the stream ends.
/// 5. Emits `stream-error-{request_id}` on HTTP / network / idle-timeout errors.
///
/// Idle-timeout behavior:
///   * First chunk must arrive within FIRST_CHUNK_TIMEOUT (default 120s).
///   * Each subsequent chunk must arrive within IDLE_TIMEOUT (default 60s).
///   * Both are env-overridable via KUNPENG_STREAM_FIRST_CHUNK_TIMEOUT_MS /
///     KUNPENG_STREAM_IDLE_TIMEOUT_MS.
///
/// The command itself returns immediately after spawning the task,
/// so the frontend can start listening for events right away.
#[tauri::command]
pub async fn stream_http_request(
    window: tauri::Window,
    state: tauri::State<'_, StreamProxyState>,
    request_id: String,
    url: String,
    headers: HashMap<String, String>,
    body: String,
) -> Result<(), String> {
    let rid = request_id.clone();
    let win = window.clone();
    let active = state.active.clone();
    let client = state.client.clone();

    let first_to = first_chunk_timeout();
    let idle_to = idle_timeout();

    let task_active = active.clone();
    let task_rid = rid.clone();
    let handle = tokio::spawn(async move {
        // RAII: guarantees state.active is cleaned up when this task ends.
        let _guard = ActiveGuard {
            active: task_active,
            rid: task_rid.clone(),
        };
        let rid = task_rid;

        // Values sent in auth headers must never come back to the WebView:
        // some gateways echo them in error bodies. Collect them for redaction.
        let secrets: Vec<String> = headers
            .iter()
            .filter(|(k, v)| {
                let k = k.to_ascii_lowercase();
                (k.contains("authorization") || k.contains("api-key") || k.contains("token"))
                    && v.len() >= 8
            })
            .map(|(_, v)| v.clone())
            .collect();
        let redact = |text: String| -> String {
            let mut out = text;
            for secret in &secrets {
                if out.contains(secret.as_str()) {
                    out = out.replace(secret.as_str(), "[REDACTED]");
                }
            }
            out
        };

        eprintln!(
            "🔄 Starting stream for request {} (first_chunk_timeout={:?}, idle_timeout={:?})",
            rid, first_to, idle_to
        );
        let mut builder = client.post(&url);
        for (k, v) in &headers {
            builder = builder.header(k.as_str(), v.as_str());
        }
        builder = builder.body(body);

        let response = match builder.send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = win.emit(
                    &format!("stream-error-{}", rid),
                    StreamErrorPayload {
                        request_id: rid.clone(),
                        status: 0,
                        message: redact(format!("Network error: {}", e)),
                    },
                );
                return;
            }
        };

        let status = response.status();
        if !status.is_success() {
            let err_text = response.text().await.unwrap_or_default();
            let _ = win.emit(
                &format!("stream-error-{}", rid),
                StreamErrorPayload {
                    request_id: rid.clone(),
                    status: status.as_u16(),
                    message: redact(err_text),
                },
            );
            return;
        }

        // Stream response body with chunk coalescing
        // Buffer chunks and emit at most once per ~16ms or 4KB to reduce IPC overhead
        // Uses a raw byte buffer to avoid splitting multi-byte UTF-8 characters
        use tokio::time::{timeout, Duration, Instant};

        let mut stream = response.bytes_stream();
        let mut raw_buf: Vec<u8> = Vec::with_capacity(8192);
        let mut last_emit = Instant::now();
        let mut first_chunk_received = false;
        const COALESCE_MS: u64 = 16;
        const COALESCE_BYTES: usize = 4096;

        /// Find the last valid UTF-8 boundary in a byte buffer.
        /// Returns the number of bytes that form valid UTF-8 from the start.
        /// Any trailing incomplete multi-byte sequence is left for the next chunk.
        fn utf8_safe_len(buf: &[u8]) -> usize {
            match std::str::from_utf8(buf) {
                Ok(_) => buf.len(),
                Err(e) => e.valid_up_to(),
            }
        }

        /// Drain valid UTF-8 from the front of the buffer, return as String.
        /// Incomplete trailing bytes remain in the buffer.
        fn drain_utf8(buf: &mut Vec<u8>) -> String {
            let safe = utf8_safe_len(buf);
            if safe == 0 {
                return String::new();
            }
            let text = String::from_utf8(buf[..safe].to_vec()).unwrap_or_default();
            buf.drain(..safe);
            text
        }

        loop {
            // Flush if buffer is large enough or coalesce window expired
            let safe_len = utf8_safe_len(&raw_buf);
            if safe_len > 0
                && (safe_len >= COALESCE_BYTES
                    || last_emit.elapsed() >= Duration::from_millis(COALESCE_MS))
            {
                let text = drain_utf8(&mut raw_buf);
                if !text.is_empty() {
                    let _ = win.emit(
                        &format!("stream-chunk-{}", rid),
                        StreamChunkPayload {
                            request_id: rid.clone(),
                            chunk: text,
                        },
                    );
                    last_emit = Instant::now();
                }
            }

            // Pick the timeout budget for the next chunk: longer for the very
            // first chunk (model thinking), shorter once data is flowing.
            let chunk_budget = if first_chunk_received {
                idle_to
            } else {
                first_to
            };

            if raw_buf.is_empty() || utf8_safe_len(&raw_buf) == 0 {
                // No emittable data — block until next chunk arrives, but no
                // longer than chunk_budget. Without this timeout, a half-dead
                // upstream connection (TCP RST not delivered) wedges the task
                // forever and the frontend `await queue.next()` hangs along
                // with it. This is the bug behind the "闪崩没消息" reports.
                match timeout(chunk_budget, stream.next()).await {
                    Ok(Some(Ok(bytes))) => {
                        first_chunk_received = true;
                        raw_buf.extend_from_slice(&bytes);
                    }
                    Ok(Some(Err(e))) => {
                        let _ = win.emit(
                            &format!("stream-error-{}", rid),
                            StreamErrorPayload {
                                request_id: rid.clone(),
                                status: 0,
                                message: format!("Stream read error: {}", e),
                            },
                        );
                        return;
                    }
                    Ok(None) => {
                        // Stream ended — flush whatever is left (lossy for any remaining bytes)
                        if !raw_buf.is_empty() {
                            let text = String::from_utf8_lossy(&raw_buf).to_string();
                            if !text.is_empty() {
                                let _ = win.emit(
                                    &format!("stream-chunk-{}", rid),
                                    StreamChunkPayload {
                                        request_id: rid.clone(),
                                        chunk: text,
                                    },
                                );
                            }
                            raw_buf.clear();
                        }
                        break;
                    }
                    Err(_) => {
                        let secs = chunk_budget.as_secs();
                        let phase = if first_chunk_received {
                            "idle"
                        } else {
                            "first chunk"
                        };
                        eprintln!("⏱️  Stream {} {} timeout after {}s", rid, phase, secs);
                        let _ = win.emit(
                            &format!("stream-error-{}", rid),
                            StreamErrorPayload {
                                request_id: rid.clone(),
                                status: 0,
                                message: format!(
                                    "Stream {} timeout ({}s without data)",
                                    phase, secs
                                ),
                            },
                        );
                        return;
                    }
                }
            } else {
                // Have buffered data — wait at most until coalesce window expires.
                // This branch's timeout is the tight COALESCE_MS (16ms) for IPC
                // efficiency, NOT the idle timeout — because we're bounded by
                // the buffered-data flush above, idle starvation can't stall here.
                let remaining =
                    Duration::from_millis(COALESCE_MS).saturating_sub(last_emit.elapsed());
                match timeout(remaining, stream.next()).await {
                    Ok(Some(Ok(bytes))) => {
                        first_chunk_received = true;
                        raw_buf.extend_from_slice(&bytes);
                    }
                    Ok(Some(Err(e))) => {
                        // Flush remaining buffer before reporting error
                        let text = drain_utf8(&mut raw_buf);
                        if !text.is_empty() {
                            let _ = win.emit(
                                &format!("stream-chunk-{}", rid),
                                StreamChunkPayload {
                                    request_id: rid.clone(),
                                    chunk: text,
                                },
                            );
                        }
                        let _ = win.emit(
                            &format!("stream-error-{}", rid),
                            StreamErrorPayload {
                                request_id: rid.clone(),
                                status: 0,
                                message: format!("Stream read error: {}", e),
                            },
                        );
                        return;
                    }
                    Ok(None) => {
                        // Stream ended — flush remaining buffer
                        if !raw_buf.is_empty() {
                            let text = String::from_utf8_lossy(&raw_buf).to_string();
                            if !text.is_empty() {
                                let _ = win.emit(
                                    &format!("stream-chunk-{}", rid),
                                    StreamChunkPayload {
                                        request_id: rid.clone(),
                                        chunk: text,
                                    },
                                );
                            }
                            raw_buf.clear();
                        }
                        break;
                    }
                    Err(_) => {
                        // Coalesce window expired — loop back to flush
                        continue;
                    }
                }
            }
        }

        // Stream finished successfully
        eprintln!("✅ Stream finished for request {}", rid);
        let _ = win.emit(
            &format!("stream-done-{}", rid),
            StreamDonePayload {
                request_id: rid.clone(),
            },
        );
    });

    // Store the abort handle so the frontend can cancel
    let abort_handle = handle.abort_handle();
    if let Ok(mut map) = active.lock() {
        if let Some(previous) = map.insert(request_id, abort_handle) {
            // A request id must identify one stream. Abort an older colliding
            // task rather than silently losing its cancellation handle.
            previous.abort();
        }
    }

    Ok(())
}

/// Abort an in-flight streaming request.
#[tauri::command]
pub async fn abort_stream_request(
    state: tauri::State<'_, StreamProxyState>,
    request_id: String,
) -> Result<(), String> {
    if let Ok(mut map) = state.active.lock() {
        if let Some(handle) = map.remove(&request_id) {
            handle.abort();
        }
    }
    Ok(())
}
