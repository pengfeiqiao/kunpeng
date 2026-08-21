use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

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

fn epoch_ms(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

const DEFAULT_TREE_IGNORES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
];
const DIRECTORY_SCAN_CAP: usize = 10_000;

#[derive(Debug, Serialize, Deserialize)]
pub struct DirectoryEntry {
    pub path: String,
    pub name: String,
    pub depth: usize,
    pub size_bytes: u64,
    pub modified_ms: u128,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub line_count: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirectoryListResult {
    pub root: String,
    pub scanned_at_ms: u128,
    pub depth: usize,
    pub ignored: Vec<String>,
    pub entries: Vec<DirectoryEntry>,
    pub total_entries: usize,
    pub offset: usize,
    pub returned_entries: usize,
    pub next_offset: Option<usize>,
    pub truncated: bool,
    pub scan_capped: bool,
}

fn optional_line_count(path: &Path, size: u64, enabled: bool) -> Option<usize> {
    if !enabled || size > 2 * 1024 * 1024 {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    if bytes.is_empty() {
        return Some(0);
    }
    let newlines = bytes.iter().filter(|byte| **byte == b'\n').count();
    Some(newlines + usize::from(!bytes.ends_with(b"\n")))
}

fn collect_directory_entries(
    current: &Path,
    level: usize,
    max_depth: usize,
    include_hidden: bool,
    include_ignored: bool,
    include_line_counts: bool,
    output: &mut Vec<DirectoryEntry>,
) {
    if level > max_depth || output.len() >= DIRECTORY_SCAN_CAP {
        return;
    }
    let Ok(read_dir) = fs::read_dir(current) else {
        return;
    };
    let mut children: Vec<_> = read_dir.filter_map(Result::ok).collect();
    children.sort_by(|a, b| {
        let a_dir = a.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        b_dir.cmp(&a_dir).then_with(|| {
            a.file_name()
                .to_string_lossy()
                .cmp(&b.file_name().to_string_lossy())
        })
    });

    for child in children {
        if output.len() >= DIRECTORY_SCAN_CAP {
            return;
        }
        let name = child.file_name().to_string_lossy().to_string();
        if (!include_hidden && name.starts_with('.'))
            || (!include_ignored && DEFAULT_TREE_IGNORES.contains(&name.as_str()))
        {
            continue;
        }
        let path = child.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        let is_symlink = metadata.file_type().is_symlink();
        let is_dir = metadata.is_dir();
        output.push(DirectoryEntry {
            path: path.to_string_lossy().to_string(),
            name,
            depth: level,
            size_bytes: metadata.len(),
            modified_ms: metadata.modified().map(epoch_ms).unwrap_or(0),
            is_dir,
            is_symlink,
            line_count: (!is_dir && !is_symlink)
                .then(|| optional_line_count(&path, metadata.len(), include_line_counts))
                .flatten(),
        });
        if is_dir && !is_symlink && level < max_depth {
            collect_directory_entries(
                &path,
                level + 1,
                max_depth,
                include_hidden,
                include_ignored,
                include_line_counts,
                output,
            );
        }
    }
}

/// Browse a live directory tree with bounded depth, paging and optional line counts.
#[tauri::command]
pub async fn list_directory(
    path: Option<String>,
    depth: Option<usize>,
    offset: Option<usize>,
    limit: Option<usize>,
    include_hidden: Option<bool>,
    include_ignored: Option<bool>,
    include_line_counts: Option<bool>,
) -> Result<DirectoryListResult, String> {
    let requested = expand_home(path.as_deref().unwrap_or("."));
    let root = fs::canonicalize(&requested).map_err(|error| {
        format!(
            "Cannot browse live filesystem directory {}: {}",
            requested.display(),
            error
        )
    })?;
    if !root.is_dir() {
        return Err(format!("Path is not a directory: {}", root.display()));
    }

    let max_depth = depth.unwrap_or(2).clamp(1, 4);
    let start = offset.unwrap_or(0);
    let page_limit = limit.unwrap_or(200).clamp(1, 500);
    let include_ignored = include_ignored.unwrap_or(false);
    let mut all = Vec::new();
    collect_directory_entries(
        &root,
        1,
        max_depth,
        include_hidden.unwrap_or(false),
        include_ignored,
        include_line_counts.unwrap_or(false),
        &mut all,
    );
    let scan_capped = all.len() >= DIRECTORY_SCAN_CAP;
    let total_entries = all.len();
    let safe_start = start.min(total_entries);
    let end = safe_start.saturating_add(page_limit).min(total_entries);
    let entries: Vec<DirectoryEntry> = all.drain(safe_start..end).collect();
    let truncated = end < total_entries;

    Ok(DirectoryListResult {
        root: root.to_string_lossy().to_string(),
        scanned_at_ms: epoch_ms(SystemTime::now()),
        depth: max_depth,
        ignored: if include_ignored {
            Vec::new()
        } else {
            DEFAULT_TREE_IGNORES
                .iter()
                .map(|value| value.to_string())
                .collect()
        },
        returned_entries: entries.len(),
        entries,
        total_entries,
        offset: safe_start,
        next_offset: truncated.then_some(end),
        truncated,
        scan_capped,
    })
}

/// Expand common brace globs before handing them to the `glob` crate, which
/// intentionally does not implement shell-style `{ts,tsx}` expansion.
fn expand_braces(pattern: &str) -> Vec<String> {
    let Some(open) = pattern.find('{') else {
        return vec![pattern.to_string()];
    };
    let Some(close_rel) = pattern[open + 1..].find('}') else {
        return vec![pattern.to_string()];
    };
    let close = open + 1 + close_rel;
    let choices: Vec<&str> = pattern[open + 1..close]
        .split(',')
        .filter(|part| !part.is_empty())
        .collect();
    if choices.len() < 2 {
        return vec![pattern.to_string()];
    }
    let mut expanded = Vec::new();
    for choice in choices {
        let next = format!("{}{}{}", &pattern[..open], choice, &pattern[close + 1..]);
        expanded.extend(expand_braces(&next));
    }
    expanded
}

/// Search files matching a glob pattern.
#[derive(Debug, Serialize, Deserialize)]
pub struct GlobMatch {
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: u128,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GlobSearchResult {
    pub root: String,
    pub scanned_at_ms: u128,
    pub matches: Vec<GlobMatch>,
}

#[tauri::command]
pub async fn glob_search(
    pattern: String,
    path: Option<String>,
) -> Result<GlobSearchResult, String> {
    let base_path = expand_home(path.as_deref().unwrap_or("."));
    let canonical_base = fs::canonicalize(&base_path).map_err(|error| {
        format!(
            "Cannot search live filesystem root {}: {}",
            base_path.display(),
            error
        )
    })?;
    let base = canonical_base.to_string_lossy().to_string();
    let full_pattern = if pattern.starts_with('/') {
        pattern
    } else {
        format!("{}/{}", base, pattern)
    };

    let mut result_paths: Vec<String> = Vec::new();
    for expanded_pattern in expand_braces(&full_pattern) {
        let entries =
            glob::glob(&expanded_pattern).map_err(|e| format!("Invalid glob pattern: {}", e))?;
        for entry in entries {
            match entry {
                Ok(path) => {
                    if let Some(s) = path.to_str() {
                        if !result_paths.iter().any(|existing| existing == s) {
                            result_paths.push(s.to_string());
                        }
                    }
                }
                Err(e) => {
                    eprintln!("glob error: {}", e);
                }
            }
        }
    }

    // Sort by modification time (newest first)
    result_paths.sort_by(|a, b| {
        let mtime_a = std::fs::metadata(a)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let mtime_b = std::fs::metadata(b)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        mtime_b.cmp(&mtime_a)
    });

    let matches = result_paths
        .into_iter()
        .filter_map(|path| {
            let metadata = fs::metadata(&path).ok()?;
            Some(GlobMatch {
                path,
                size_bytes: metadata.len(),
                modified_ms: metadata.modified().map(epoch_ms).unwrap_or(0),
                is_dir: metadata.is_dir(),
            })
        })
        .collect();

    Ok(GlobSearchResult {
        root: base,
        scanned_at_ms: epoch_ms(SystemTime::now()),
        matches,
    })
}

#[cfg(test)]
mod tests {
    use super::{expand_braces, glob_search, grep_search, list_directory};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("kunpeng-search-{}-{}", label, nonce))
    }

    #[test]
    fn expands_one_brace_group() {
        assert_eq!(
            expand_braces("src/**/*.{ts,tsx}"),
            vec!["src/**/*.ts", "src/**/*.tsx"]
        );
    }

    #[test]
    fn expands_multiple_groups() {
        assert_eq!(
            expand_braces("{src,test}/**/*.{ts,tsx}"),
            vec![
                "src/**/*.ts",
                "src/**/*.tsx",
                "test/**/*.ts",
                "test/**/*.tsx"
            ],
        );
    }

    #[tokio::test]
    async fn grep_observes_rewritten_live_file() {
        let root = test_dir("fresh");
        fs::create_dir_all(&root).unwrap();
        let file = root.join("sample.swift");
        fs::write(&file, "oldSymbol\n").unwrap();
        let first = grep_search(
            "oldSymbol".to_string(),
            Some(root.to_string_lossy().to_string()),
            None,
            None,
            None,
        )
        .await
        .unwrap();
        fs::write(&file, "newSymbol\n").unwrap();
        let stale = grep_search(
            "oldSymbol".to_string(),
            Some(root.to_string_lossy().to_string()),
            None,
            None,
            None,
        )
        .await
        .unwrap();
        let current = grep_search(
            "newSymbol".to_string(),
            Some(root.to_string_lossy().to_string()),
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(first.matches.len(), 1);
        assert!(stale.matches.is_empty());
        assert_eq!(current.matches.len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn grep_supports_regex_alternation() {
        let root = test_dir("alternation");
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("Models.swift"),
            "struct CursorStyle {}\nstruct ZoomSettings {}\nstruct OtherType {}\n",
        )
        .unwrap();

        let result = grep_search(
            "struct CursorStyle|struct ZoomSettings|struct MissingType".to_string(),
            Some(root.to_string_lossy().to_string()),
            Some("*.swift".to_string()),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(result.matches.len(), 2);
        assert!(result.matches[0].content.contains("CursorStyle"));
        assert!(result.matches[1].content.contains("ZoomSettings"));
        assert_eq!(
            result.pattern,
            "struct CursorStyle|struct ZoomSettings|struct MissingType"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn glob_returns_live_metadata() {
        let root = test_dir("glob");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("sample.ts"), "hello").unwrap();
        let result = glob_search("*.ts".to_string(), Some(root.to_string_lossy().to_string()))
            .await
            .unwrap();
        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].size_bytes, 5);
        assert!(!result.matches[0].is_dir);
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn directory_listing_is_bounded_and_ignores_heavy_folders() {
        let root = test_dir("directory");
        fs::create_dir_all(root.join("Sources/Nested")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("Sources/App.swift"), "one\ntwo\n").unwrap();
        fs::write(root.join("Sources/Nested/Deep.swift"), "deep\n").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "ignored\n").unwrap();

        let result = list_directory(
            Some(root.to_string_lossy().to_string()),
            Some(2),
            None,
            Some(50),
            Some(false),
            Some(false),
            Some(true),
        )
        .await
        .unwrap();

        assert!(result.entries.iter().any(|entry| {
            entry.name == "App.swift" && entry.line_count == Some(2) && entry.depth == 2
        }));
        assert!(!result
            .entries
            .iter()
            .any(|entry| entry.name == "node_modules"));
        assert!(!result
            .entries
            .iter()
            .any(|entry| entry.name == "Deep.swift"));
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn directory_listing_supports_stable_paging() {
        let root = test_dir("directory-page");
        fs::create_dir_all(&root).unwrap();
        for name in ["a.txt", "b.txt", "c.txt"] {
            fs::write(root.join(name), name).unwrap();
        }
        let first = list_directory(
            Some(root.to_string_lossy().to_string()),
            Some(1),
            Some(0),
            Some(2),
            None,
            None,
            None,
        )
        .await
        .unwrap();
        let second = list_directory(
            Some(root.to_string_lossy().to_string()),
            Some(1),
            first.next_offset,
            Some(2),
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(first.returned_entries, 2);
        assert_eq!(first.next_offset, Some(2));
        assert_eq!(second.returned_entries, 1);
        assert!(!second.truncated);
        let _ = fs::remove_dir_all(root);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GrepMatch {
    pub file: String,
    pub line: usize,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GrepSearchResult {
    pub root: String,
    pub pattern: String,
    pub engine: String,
    pub scanned_at_ms: u128,
    pub matches: Vec<GrepMatch>,
    pub truncated: bool,
    pub max_results: usize,
}

/// Search file contents using ripgrep (rg) or fallback to grep.
#[tauri::command]
pub async fn grep_search(
    pattern: String,
    path: Option<String>,
    file_glob: Option<String>,
    context_lines: Option<usize>,
    max_results: Option<usize>,
) -> Result<GrepSearchResult, String> {
    let requested_path = expand_home(path.as_deref().unwrap_or("."));
    let canonical_path = fs::canonicalize(&requested_path).map_err(|error| {
        format!(
            "Cannot search live filesystem path {}: {}",
            requested_path.display(),
            error
        )
    })?;
    let search_path = canonical_path.to_string_lossy().to_string();
    let max = max_results.unwrap_or(250);

    // Try ripgrep first, fall back to grep
    let rg_available = Command::new("rg").arg("--version").output().is_ok();

    let engine = if rg_available { "ripgrep" } else { "grep -E" };
    let output = if rg_available {
        let mut cmd = Command::new("rg");
        cmd.arg("--line-number")
            .arg("--no-heading")
            .arg("--color=never")
            .arg("--regexp")
            .arg(&pattern)
            .arg("--max-count")
            .arg(max.to_string());

        if let Some(ref glob) = file_glob {
            cmd.arg("--glob").arg(glob);
        }
        if let Some(ctx) = context_lines {
            cmd.arg("-C").arg(ctx.to_string());
        }

        cmd.arg("--").arg(&search_path);
        cmd.output()
            .map_err(|e| format!("Failed to run rg: {}", e))?
    } else {
        let mut cmd = Command::new("grep");
        cmd.arg("-rn").arg("--color=never").arg("-E");

        if let Some(ref glob) = file_glob {
            cmd.arg("--include").arg(glob);
        }

        cmd.arg(&pattern).arg(&search_path);
        cmd.output()
            .map_err(|e| format!("Failed to run grep: {}", e))?
    };

    if !output.status.success() && output.status.code() != Some(1) {
        return Err(format!(
            "Search command failed in {}: {}",
            search_path,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results: Vec<GrepMatch> = Vec::new();
    let mut saw_extra = false;

    for line in stdout.lines() {
        if results.len() >= max {
            saw_extra = true;
            break;
        }
        // Parse "file:line:content" format
        let parts: Vec<&str> = line.splitn(3, ':').collect();
        if parts.len() >= 3 {
            if let Ok(line_num) = parts[1].parse::<usize>() {
                results.push(GrepMatch {
                    file: parts[0].to_string(),
                    line: line_num,
                    content: parts[2].to_string(),
                });
            }
        }
    }

    Ok(GrepSearchResult {
        root: search_path,
        pattern,
        engine: engine.to_string(),
        scanned_at_ms: epoch_ms(SystemTime::now()),
        matches: results,
        truncated: saw_extra,
        max_results: max,
    })
}
