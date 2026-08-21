use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContent {
    pub content: String,
    pub total_lines: usize,
    pub canonical_path: String,
    pub size_bytes: u64,
    pub modified_ms: u128,
    pub content_hash: String,
    pub offset: usize,
    pub returned_lines: usize,
    pub next_offset: Option<usize>,
    pub truncated: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifiedMutation {
    pub canonical_path: String,
    pub size_bytes: u64,
    pub modified_ms: u128,
    pub content_hash: String,
    pub verified: bool,
}

fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn modified_ms(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn content_hash(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn collect_name_matches(
    dir: &Path,
    target_name: &str,
    depth: usize,
    visited: &mut usize,
    out: &mut Vec<PathBuf>,
) {
    if depth == 0 || out.len() >= 5 || *visited >= 5000 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        *visited += 1;
        let path = entry.path();
        if path.file_name().and_then(|name| name.to_str()) == Some(target_name) {
            out.push(path.clone());
            if out.len() >= 5 {
                return;
            }
        }
        if path.is_dir() {
            collect_name_matches(&path, target_name, depth - 1, visited, out);
            if out.len() >= 5 || *visited >= 5000 {
                return;
            }
        }
    }
}

fn missing_path_error(path: &Path, source: &io::Error) -> String {
    let mut ancestor = path.parent();
    while let Some(candidate) = ancestor {
        if candidate.exists() {
            break;
        }
        ancestor = candidate.parent();
    }

    let mut suggestions = Vec::new();
    if let (Some(root), Some(name)) = (ancestor, path.file_name().and_then(|value| value.to_str()))
    {
        let mut visited = 0;
        collect_name_matches(root, name, 6, &mut visited, &mut suggestions);
    }
    let hint = if suggestions.is_empty() {
        String::new()
    } else {
        format!(
            "\n你可能要找：\n{}",
            suggestions
                .iter()
                .map(|candidate| format!("- {}", candidate.display()))
                .collect::<Vec<_>>()
                .join("\n")
        )
    };
    format!(
        "File not found on the live filesystem: {} ({}){}",
        path.display(),
        source,
        hint
    )
}

fn verify_written_file(path: &Path, expected: &[u8]) -> Result<VerifiedMutation, String> {
    let actual = fs::read(path).map_err(|error| {
        format!(
            "Write completed but verification read failed for {}: {}",
            path.display(),
            error
        )
    })?;
    if actual != expected {
        return Err(format!(
            "Write verification failed for {}: live disk content does not match the requested content",
            path.display()
        ));
    }
    let metadata = fs::metadata(path).map_err(|error| {
        format!(
            "Failed to verify metadata for {}: {}",
            path.display(),
            error
        )
    })?;
    let canonical_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    Ok(VerifiedMutation {
        canonical_path: canonical_path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        modified_ms: modified_ms(&metadata),
        content_hash: content_hash(&actual),
        verified: true,
    })
}

/// Read a file with optional line offset and limit.
/// Returns content with line numbers (cat -n style).
#[tauri::command]
pub async fn read_file(
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<FileContent, String> {
    let file_path = expand_home(&path);
    let mut attempts = 0;
    let (bytes, metadata) = loop {
        attempts += 1;
        let before = match fs::metadata(&file_path) {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(missing_path_error(&file_path, &error));
            }
            Err(error) => {
                return Err(format!(
                    "Failed to inspect {}: {}",
                    file_path.display(),
                    error
                ))
            }
        };
        if before.is_dir() {
            return Err(format!(
                "Path is a directory, not a file: {}",
                file_path.display()
            ));
        }
        let bytes = fs::read(&file_path).map_err(|error| {
            format!(
                "Failed to read {} from live filesystem: {}",
                file_path.display(),
                error
            )
        })?;
        let after = fs::metadata(&file_path).map_err(|error| {
            format!(
                "Failed to verify {} after reading: {}",
                file_path.display(),
                error
            )
        })?;
        let changed = before.len() != after.len() || modified_ms(&before) != modified_ms(&after);
        if !changed || attempts >= 2 {
            if changed {
                return Err(format!(
                    "File changed while it was being read: {}. Retry read_file so the model never receives a mixed snapshot.",
                    file_path.display()
                ));
            }
            break (bytes, after);
        }
    };
    let text = String::from_utf8(bytes.clone())
        .map_err(|_| format!("File is not valid UTF-8: {}", file_path.display()))?;
    let all_lines: Vec<&str> = text.lines().collect();

    let total_lines = all_lines.len();
    let start = offset.unwrap_or(0).min(total_lines);
    let count = limit.unwrap_or(2000);
    let end = start.saturating_add(count).min(total_lines);

    let mut output = String::new();
    for (i, line) in all_lines[start..end].iter().enumerate() {
        let line_num = start + i + 1; // 1-based
        output.push_str(&format!("{}\t{}\n", line_num, line));
    }

    let canonical_path = fs::canonicalize(&file_path).unwrap_or(file_path.clone());
    let truncated = end < total_lines;

    Ok(FileContent {
        content: output,
        total_lines,
        canonical_path: canonical_path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        modified_ms: modified_ms(&metadata),
        content_hash: content_hash(&bytes),
        offset: start,
        returned_lines: end.saturating_sub(start),
        next_offset: truncated.then_some(end),
        truncated,
    })
}

/// Write content to a file, creating parent directories if needed.
#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<VerifiedMutation, String> {
    let file_path = expand_home(&path);

    // Create parent directories
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    fs::write(&file_path, &content).map_err(|e| format!("Failed to write file: {}", e))?;
    verify_written_file(&file_path, content.as_bytes())
}

/// Append content to a file (created if missing). Unlike a read-modify-write
/// in the frontend, OS-level append is atomic per write call — concurrent
/// log appends interleave instead of overwriting each other.
#[tauri::command]
pub async fn append_file(path: String, content: String) -> Result<(), String> {
    use std::io::Write;

    let file_path = Path::new(&path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file_path)
        .map_err(|e| format!("Failed to open file for append: {}", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to append to file: {}", e))?;
    Ok(())
}

/// Edit a file by replacing old_string with new_string.
/// If replace_all is false (default), old_string must appear exactly once.
#[tauri::command]
pub async fn edit_file(
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
) -> Result<VerifiedMutation, String> {
    let file_path = expand_home(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    let replace_all = replace_all.unwrap_or(false);

    if !replace_all {
        let count = content.matches(&old_string).count();
        if count == 0 {
            return Err("old_string not found in file".to_string());
        }
        if count > 1 {
            return Err(format!(
                "old_string found {} times in file. Use replace_all=true or provide a more specific string.",
                count
            ));
        }
    }

    let new_content = if replace_all {
        content.replace(&old_string, &new_string)
    } else {
        content.replacen(&old_string, &new_string, 1)
    };

    fs::write(&file_path, &new_content).map_err(|e| format!("Failed to write file: {}", e))?;
    verify_written_file(&file_path, new_content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::{read_file, write_file};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_path(label: &str) -> String {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("kunpeng-{}-{}.txt", label, nonce))
            .to_string_lossy()
            .to_string()
    }

    #[tokio::test]
    async fn repeated_read_observes_live_disk_rewrite() {
        let path = test_path("fresh-read");
        write_file(path.clone(), "old snapshot\n".to_string())
            .await
            .unwrap();
        let first = read_file(path.clone(), None, None).await.unwrap();
        write_file(path.clone(), "new live content\n".to_string())
            .await
            .unwrap();
        let second = read_file(path.clone(), None, None).await.unwrap();

        assert!(first.content.contains("old snapshot"));
        assert!(second.content.contains("new live content"));
        assert_ne!(first.content_hash, second.content_hash);
        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn offset_beyond_end_returns_empty_page_instead_of_panicking() {
        let path = test_path("offset");
        write_file(path.clone(), "one\ntwo\n".to_string())
            .await
            .unwrap();
        let result = read_file(path.clone(), Some(999), Some(20)).await.unwrap();
        assert_eq!(result.total_lines, 2);
        assert_eq!(result.returned_lines, 0);
        assert!(!result.truncated);
        let _ = fs::remove_file(path);
    }
}
