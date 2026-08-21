//! project_archive — 工程打包/导入（zip）。
//!
//! export_project_zip: 把工坊项目目录 + 画布文件 + 画布引用的 workspace 图
//! 打包成 zip 存桌面。zip 内用相对路径，manifest 记录源 home + id。
//!
//! import_project_zip: 解压、生成新 id、落地、重映射绝对路径（home + id），
//! 返回新 aigc/canvas project id，前端再注册索引 + 打开。

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::FileOptions;
use zip::write::ZipWriter;
use zip::ZipArchive;

#[derive(Serialize)]
struct Manifest {
    schema: String,
    version: u32,
    source_home: String,
    source_aigc_id: Option<String>,
    source_canvas_id: Option<String>,
    name: String,
    exported_at: String,
    project_assets: Vec<ArchivedAsset>,
    canvas_assets: Vec<ArchivedAsset>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct ArchivedAsset {
    original_path: String,
    source_values: Vec<String>,
    archive_path: String,
}

#[derive(Deserialize, Default)]
struct ManifestRead {
    #[serde(default)]
    source_home: String,
    #[serde(default)]
    source_aigc_id: Option<String>,
    #[serde(default)]
    source_canvas_id: Option<String>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    project_assets: Vec<ArchivedAsset>,
    #[serde(default)]
    canvas_assets: Vec<ArchivedAsset>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub aigc_project_id: Option<String>,
    pub canvas_project_id: Option<String>,
    pub name: String,
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())
}

/// 生成简短 slug（仅小写字母数字 + 连字符）
fn slugify(s: &str) -> String {
    let slug: String = s
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "project".to_string()
    } else if slug.len() > 24 {
        slug[..24].trim_matches('-').to_string()
    } else {
        slug
    }
}

/// 生成新 aigc 项目 id：proj-<8位随机>-<slug>
fn new_aigc_id(name: &str) -> String {
    let slug = slugify(name);
    let r: u64 = simple_random();
    format!("proj-{:016x}-{}", r, slug)
}

/// 生成新 canvas 项目 id：canvas-<8位随机>
fn new_canvas_id() -> String {
    let r: u64 = simple_random();
    format!("canvas-{:016x}", r)
}

/// 轻量随机（不依赖 rand crate，用系统时间 + 进程 id 做 seed）
fn simple_random() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let pid = std::process::id() as u64;
    // 简单混合
    let mut x = nanos ^ (pid << 32);
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    x
}

/// 递归把目录下所有文件加入 zip（路径相对 base_dir）。
fn add_dir_to_zip<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    base: &Path,
    zip_prefix: &str,
) -> std::io::Result<()> {
    if !base.exists() {
        return Ok(());
    }
    let mut stack = vec![base.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            let ty = entry.file_type()?;
            if ty.is_dir() {
                stack.push(path);
            } else if ty.is_file() {
                let rel = path.strip_prefix(base).unwrap_or(&path);
                let zip_name = if zip_prefix.is_empty() {
                    rel.to_string_lossy().to_string()
                } else {
                    format!("{}/{}", zip_prefix, rel.to_string_lossy())
                };
                zip.start_file(&zip_name, FileOptions::default())?;
                let mut f = fs::File::open(&path)?;
                let mut buf = Vec::with_capacity(8192);
                f.read_to_end(&mut buf)?;
                zip.write_all(&buf)?;
            }
        }
    }
    Ok(())
}

/// 把单个文件加入 zip
fn add_file_to_zip<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    abs_path: &Path,
    zip_name: &str,
) -> std::io::Result<()> {
    if !abs_path.exists() {
        return Ok(());
    }
    zip.start_file(zip_name, FileOptions::default())?;
    let mut f = fs::File::open(abs_path)?;
    let mut buf = Vec::with_capacity(8192);
    f.read_to_end(&mut buf)?;
    zip.write_all(&buf)?;
    Ok(())
}

fn decode_asset_url(raw: &str, prefix: &str) -> Option<String> {
    let rest = raw.strip_prefix(prefix)?;
    let no_query = rest.split('?').next().unwrap_or(rest);
    let decoded = urlencoding::decode(no_query).ok()?.to_string();
    Some(if decoded.starts_with('/') {
        decoded
    } else {
        format!("/{}", decoded)
    })
}

fn normalize_local_path(raw: &str, home: &Path) -> Option<String> {
    let s = raw.trim();
    if s.is_empty()
        || s.starts_with("http://")
        || s.starts_with("https://") && !s.starts_with("https://asset.localhost/")
    {
        return None;
    }
    let path = if let Some(p) = s.strip_prefix("file://") {
        urlencoding::decode(p).ok()?.to_string()
    } else if let Some(p) = decode_asset_url(s, "asset://localhost/") {
        p
    } else if let Some(p) = decode_asset_url(s, "https://asset.localhost/") {
        p
    } else if let Some(p) = s.strip_prefix("~/") {
        home.join(p).to_string_lossy().to_string()
    } else if s.starts_with('/') {
        s.to_string()
    } else {
        return None;
    };
    let no_query = path.split('?').next().unwrap_or(&path).to_string();
    if no_query.starts_with('/') {
        Some(no_query)
    } else {
        None
    }
}

fn collect_local_asset_refs_from_value(
    value: &serde_json::Value,
    home: &Path,
    out: &mut Vec<(String, String)>,
) {
    match value {
        serde_json::Value::String(s) => {
            if let Some(abs) = normalize_local_path(s, home) {
                out.push((s.clone(), abs));
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_local_asset_refs_from_value(item, home, out);
            }
        }
        serde_json::Value::Object(map) => {
            for item in map.values() {
                collect_local_asset_refs_from_value(item, home, out);
            }
        }
        _ => {}
    }
}

fn collect_local_asset_refs(canvas_json: &str, home: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(canvas_json) {
        collect_local_asset_refs_from_value(&value, home, &mut out);
    }
    out
}

fn collect_local_asset_refs_from_json_files(base: &Path, home: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if !base.exists() {
        return out;
    }
    let mut stack = vec![base.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let ty = match entry.file_type() {
                Ok(v) => v,
                Err(_) => continue,
            };
            if ty.is_dir() {
                stack.push(path);
            } else if ty.is_file() {
                let is_json = path
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case("json"))
                    .unwrap_or(false);
                if !is_json {
                    continue;
                }
                if let Ok(content) = fs::read_to_string(&path) {
                    out.extend(collect_local_asset_refs(&content, home));
                }
            }
        }
    }
    out
}

fn archive_local_assets<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    refs: Vec<(String, String)>,
    archive_root: &str,
    workspace_dir: &Path,
) -> Vec<ArchivedAsset> {
    let mut archived_assets: Vec<ArchivedAsset> = Vec::new();
    let mut grouped: HashMap<String, Vec<String>> = HashMap::new();
    for (source_value, abs_path) in refs {
        grouped.entry(abs_path).or_default().push(source_value);
    }
    let mut used_zip_names: HashSet<String> = HashSet::new();
    for (idx, (abs_path, source_values)) in grouped.into_iter().enumerate() {
        let p = Path::new(&abs_path);
        if !p.exists() {
            continue;
        }
        let zip_name = if let Ok(rel) = p.strip_prefix(workspace_dir) {
            format!("{}/workspace/{}", archive_root, rel.to_string_lossy())
        } else {
            let file_name = p
                .file_name()
                .and_then(|x| x.to_str())
                .unwrap_or("asset.bin");
            format!("{}/local/{:04}-{}", archive_root, idx, file_name)
        };
        if used_zip_names.insert(zip_name.clone()) {
            if add_file_to_zip(zip, p, &zip_name).is_ok() {
                let mut values = source_values;
                if !values.iter().any(|v| v == &abs_path) {
                    values.push(abs_path.clone());
                }
                archived_assets.push(ArchivedAsset {
                    original_path: abs_path,
                    source_values: values,
                    archive_path: zip_name,
                });
            }
        }
    }
    archived_assets
}

fn infer_name_from_project(project_dir: &Path) -> Option<String> {
    let project_json_path = project_dir.join("project.json");
    let s = fs::read_to_string(&project_json_path).ok()?;
    let v = serde_json::from_str::<serde_json::Value>(&s).ok()?;
    v.get("name")
        .and_then(|n| n.as_str())
        .map(|s| s.to_string())
}

fn first_child_dir_name(base: &Path) -> Option<String> {
    let entries = fs::read_dir(base).ok()?;
    for entry in entries.flatten() {
        if entry.file_type().ok()?.is_dir() {
            return entry.file_name().to_str().map(|s| s.to_string());
        }
    }
    None
}

fn read_manifest_or_infer(
    tmp_base: &Path,
    zip_path: &str,
    home: &Path,
) -> Result<ManifestRead, String> {
    let manifest_path = tmp_base.join("manifest.json");
    if manifest_path.exists() {
        let manifest_str =
            fs::read_to_string(&manifest_path).map_err(|e| format!("读 manifest 失败: {}", e))?;
        let mut manifest: ManifestRead = serde_json::from_str(&manifest_str)
            .map_err(|e| format!("解析 manifest 失败: {}", e))?;
        if manifest.name.trim().is_empty() {
            manifest.name = "导入工程".to_string();
        }
        if manifest.source_home.trim().is_empty() {
            manifest.source_home = home.to_string_lossy().to_string();
        }
        return Ok(manifest);
    }

    let old_aigc_id = first_child_dir_name(&tmp_base.join("aigc-memory/projects"));
    let old_canvas_id = if tmp_base.join("canvas/canvas.json").exists() {
        Some("canvas".to_string())
    } else {
        None
    };
    let name = old_aigc_id
        .as_ref()
        .and_then(|id| infer_name_from_project(&tmp_base.join("aigc-memory/projects").join(id)))
        .or_else(|| {
            Path::new(zip_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "导入工程".to_string());

    Ok(ManifestRead {
        source_home: home.to_string_lossy().to_string(),
        source_aigc_id: old_aigc_id,
        source_canvas_id: old_canvas_id,
        name,
        project_assets: Vec::new(),
        canvas_assets: Vec::new(),
    })
}

#[tauri::command]
pub fn export_project_zip(
    aigc_project_id: Option<String>,
    canvas_project_id: Option<String>,
    canvas_meta_json: Option<String>,
) -> Result<String, String> {
    let home = home()?;

    // 项目名：优先工坊 project.json，其次 canvas meta，最后用 canvas id
    let mut name = "未命名画布".to_string();
    let mut aigc_dir_opt: Option<PathBuf> = None;
    if let Some(ref aigc_id) = aigc_project_id {
        let aigc_dir = home.join(".kunpeng/aigc-memory/projects").join(aigc_id);
        if aigc_dir.exists() {
            aigc_dir_opt = Some(aigc_dir.clone());
            let project_json_path = aigc_dir.join("project.json");
            if let Ok(s) = fs::read_to_string(&project_json_path) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                    if let Some(n) = v.get("name").and_then(|n| n.as_str()) {
                        name = n.to_string();
                    }
                }
            }
        }
    }
    if name == "未命名画布" {
        if let Some(ref meta) = canvas_meta_json {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(meta) {
                if let Some(n) = v.get("name").and_then(|n| n.as_str()) {
                    name = n.to_string();
                }
            }
        }
    }
    if name == "未命名画布" {
        if let Some(ref cid) = canvas_project_id {
            name = cid.clone();
        }
    }

    // 桌面输出路径
    let desktop = home.join("Desktop");
    let _ = fs::create_dir_all(&desktop);
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let slug = slugify(&name);
    let zip_path = desktop.join(format!("{}-{}.zip", slug, ts));

    let file = fs::File::create(&zip_path).map_err(|e| format!("创建 zip 失败: {}", e))?;
    let mut zip = ZipWriter::new(file);

    let workspace_dir = home.join(".kunpeng/workspace");
    let mut archived_project_assets: Vec<ArchivedAsset> = Vec::new();

    // 1. 工坊项目目录 → aigc-memory/projects/<id>/（自由画布无工坊项目则跳过）
    if let (Some(ref aigc_id), Some(ref aigc_dir)) = (&aigc_project_id, &aigc_dir_opt) {
        let aigc_prefix = format!("aigc-memory/projects/{}", aigc_id);
        add_dir_to_zip(&mut zip, aigc_dir, &aigc_prefix)
            .map_err(|e| format!("打包工坊目录失败: {}", e))?;
        let project_refs = collect_local_asset_refs_from_json_files(aigc_dir, &home);
        archived_project_assets =
            archive_local_assets(&mut zip, project_refs, "project-assets", &workspace_dir);
    }

    // 2. 画布文件
    let mut canvas_json: Option<String> = None;
    if let Some(ref canvas_id) = canvas_project_id {
        let canvas_file = home
            .join(".kunpeng/projects")
            .join(canvas_id)
            .join("canvas.json");
        if canvas_file.exists() {
            let content = fs::read_to_string(&canvas_file)
                .map_err(|e| format!("读 canvas.json 失败: {}", e))?;
            canvas_json = Some(content.clone());
            add_file_to_zip(&mut zip, &canvas_file, "canvas/canvas.json")
                .map_err(|e| format!("打包 canvas.json 失败: {}", e))?;
        }
        if let Some(ref meta) = canvas_meta_json {
            zip.start_file("canvas/canvasProject.json", FileOptions::default())
                .map_err(|e| format!("写 canvasProject.json 失败: {}", e))?;
            zip.write_all(meta.as_bytes())
                .map_err(|e| format!("写 meta 失败: {}", e))?;
        }
    }

    // 3. 画布引用的本地资源 → canvas-assets/...
    //
    // 老版本只扫描 localPath + workspace，很多节点会把资源放在
    // generatedImageUrl/referenceImages/generatedVideoUrl 里，导致导出包缺图。
    // 这里直接遍历 canvas.json 的所有字符串：绝对路径、file://、asset://
    // 都按“源字符串 -> 归档文件”的映射记录进 manifest，导入时做精确替换。
    let archived_assets: Vec<ArchivedAsset> = if let Some(ref cj) = canvas_json {
        archive_local_assets(
            &mut zip,
            collect_local_asset_refs(cj, &home),
            "canvas-assets",
            &workspace_dir,
        )
    } else {
        Vec::new()
    };

    // 4. manifest.json
    let manifest = Manifest {
        schema: "kunpeng-project-v1".to_string(),
        version: 1,
        source_home: home.to_string_lossy().to_string(),
        source_aigc_id: aigc_project_id.clone(),
        source_canvas_id: canvas_project_id.clone(),
        name: name.clone(),
        exported_at: chrono::Local::now().to_rfc3339(),
        project_assets: archived_project_assets,
        canvas_assets: archived_assets,
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("序列化 manifest 失败: {}", e))?;
    zip.start_file("manifest.json", FileOptions::default())
        .map_err(|e| format!("写 manifest 失败: {}", e))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("写 manifest 内容失败: {}", e))?;

    zip.finish().map_err(|e| format!("完成 zip 失败: {}", e))?;
    Ok(zip_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_project_zip(zip_path: String) -> Result<ImportResult, String> {
    let home = home()?;
    let tmp_base = std::env::temp_dir().join(format!("kunpeng-import-{}", simple_random()));
    fs::create_dir_all(&tmp_base).map_err(|e| format!("创建临时目录失败: {}", e))?;

    // 1. 解压
    let zip_file = fs::File::open(&zip_path).map_err(|e| format!("打开 zip 失败: {}", e))?;
    let mut archive = ZipArchive::new(zip_file).map_err(|e| format!("读取 zip 失败: {}", e))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("读 zip 条目失败: {}", e))?;
        let outpath = match entry.enclosed_name() {
            Some(p) => tmp_base.join(p),
            None => continue,
        };
        if entry.is_dir() {
            let _ = fs::create_dir_all(&outpath);
        } else {
            let _ = fs::create_dir_all(outpath.parent().unwrap_or(&tmp_base));
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("创建解压文件失败 {}: {}", outpath.display(), e))?;
            let mut buf = Vec::with_capacity(8192);
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("解压读失败: {}", e))?;
            outfile
                .write_all(&buf)
                .map_err(|e| format!("解压写失败: {}", e))?;
        }
    }

    // 2. 读 manifest。旧包如果没有 manifest，也尽量从目录结构推断，
    // 不让用户因为元数据缺失直接导入失败。
    let manifest = read_manifest_or_infer(&tmp_base, &zip_path, &home)?;
    let source_home = manifest.source_home;
    let old_aigc_id_opt = manifest.source_aigc_id;
    let old_canvas_id = if manifest.source_canvas_id.is_some() {
        manifest.source_canvas_id
    } else if tmp_base.join("canvas/canvas.json").exists() {
        Some("canvas".to_string())
    } else {
        None
    };
    let name = if manifest.name.trim().is_empty() {
        "导入工程".to_string()
    } else {
        manifest.name
    };

    // 3. 生成新 id（工坊 id 仅当 zip 里真的有工坊目录时才生成）
    let new_aigc_id_opt = old_aigc_id_opt.as_ref().and_then(|old_id| {
        let src = tmp_base.join("aigc-memory/projects").join(old_id);
        if src.exists() {
            Some(new_aigc_id(&name))
        } else {
            None
        }
    });
    let new_canvas_id = old_canvas_id.as_ref().map(|_| new_canvas_id());
    let mut final_aigc_project_id: Option<String> = None;

    // 4. 落地工坊目录 + 重映射（仅当有工坊项目）
    if let (Some(ref old_aigc_id), Some(ref new_aigc_id)) = (&old_aigc_id_opt, &new_aigc_id_opt) {
        let src_aigc_dir = tmp_base.join("aigc-memory/projects").join(old_aigc_id);
        let dst_aigc_dir = home.join(".kunpeng/aigc-memory/projects").join(new_aigc_id);
        if src_aigc_dir.exists() {
            fs::create_dir_all(&dst_aigc_dir).map_err(|e| format!("创建工坊目录失败: {}", e))?;
            copy_dir_recursive(&src_aigc_dir, &dst_aigc_dir, true)
                .map_err(|e| format!("落地工坊目录失败: {}", e))?;
            let imported_base = home.join(".kunpeng/imported-assets").join(new_aigc_id);
            let project_assets_src = tmp_base.join("project-assets");
            if project_assets_src.exists() {
                let project_assets_dst = imported_base.join("project-assets");
                let _ = fs::create_dir_all(&project_assets_dst);
                let _ = copy_dir_recursive(&project_assets_src, &project_assets_dst, true);
            }
            // 重映射 workshop.json + project.json 里的绝对路径
            let new_home_str = home.to_string_lossy().to_string();
            let old_prefix = format!(
                "{}/.kunpeng/aigc-memory/projects/{}",
                source_home, old_aigc_id
            );
            let new_prefix = format!(
                "{}/.kunpeng/aigc-memory/projects/{}",
                new_home_str, new_aigc_id
            );
            for fname in &["workshop.json", "project.json", "editor.json"] {
                let fp = dst_aigc_dir.join(fname);
                if fp.exists() {
                    if let Ok(s) = fs::read_to_string(&fp) {
                        let mut replaced = s;
                        for asset in &manifest.project_assets {
                            let dst = imported_base.join(&asset.archive_path);
                            if !dst.exists() {
                                continue;
                            }
                            let dst_str = dst.to_string_lossy().to_string();
                            if !asset.original_path.is_empty() {
                                replaced = replaced.replace(&asset.original_path, &dst_str);
                            }
                            for source_value in &asset.source_values {
                                if !source_value.is_empty() {
                                    replaced = replaced.replace(source_value, &dst_str);
                                }
                            }
                        }
                        let mut replaced = replaced.replace(&old_prefix, &new_prefix);
                        // 也替换 source_home 根（覆盖 voicePath 等可能用到的 home 根路径，
                        // 但只替换出现在 aigc-memory/projects 上下文里的——简单起见全替换 home 根）
                        replaced = if source_home != new_home_str {
                            replaced.replace(&source_home, &new_home_str)
                        } else {
                            replaced
                        };
                        replaced = replaced.replace(old_aigc_id, new_aigc_id);
                        let _ = fs::write(&fp, replaced);
                    }
                }
            }
            final_aigc_project_id = Some(new_aigc_id.clone());
        }
    }

    // 5. 画布文件落地 + 重映射
    let mut final_canvas_id: Option<String> = None;
    if let (Some(_old_cid), Some(new_cid)) = (&old_canvas_id, &new_canvas_id) {
        let canvas_src = tmp_base.join("canvas/canvas.json");
        if canvas_src.exists() {
            let content = fs::read_to_string(&canvas_src)
                .map_err(|e| format!("读 canvas.json 失败: {}", e))?;
            let new_home_str = home.to_string_lossy().to_string();

            // workspace 资产：落地 canvas-assets/workspace → ~/.kunpeng/imported-assets/<key>/workspace
            // key 优先用工坊 id（关联工坊的画布），否则用 canvas id（自由画布）
            let imported_key = new_aigc_id_opt.clone().unwrap_or_else(|| new_cid.clone());
            let imported_base = home.join(".kunpeng/imported-assets").join(&imported_key);
            let _ = fs::create_dir_all(&imported_base);
            let canvas_assets_src = tmp_base.join("canvas-assets");
            if canvas_assets_src.exists() {
                let _ = copy_dir_recursive(&canvas_assets_src, &imported_base, true);
            }
            let old_ws_prefix = format!("{}/.kunpeng/workspace", source_home);
            let new_ws_prefix = format!(
                "{}/.kunpeng/imported-assets/{}/workspace",
                new_home_str, imported_key
            );

            // 重映射 localPath 字符串
            let mut replaced = content;
            // 新包：优先按 manifest 中的精确资源映射替换。它能覆盖
            // localPath、asset:// 显示 URL、referenceImages[].url 等各种字段。
            for asset in &manifest.canvas_assets {
                let rel = asset
                    .archive_path
                    .strip_prefix("canvas-assets/")
                    .unwrap_or(&asset.archive_path);
                let dst = imported_base.join(rel);
                if !dst.exists() {
                    continue;
                }
                let dst_str = dst.to_string_lossy().to_string();
                if !asset.original_path.is_empty() {
                    replaced = replaced.replace(&asset.original_path, &dst_str);
                }
                for source_value in &asset.source_values {
                    if !source_value.is_empty() {
                        replaced = replaced.replace(source_value, &dst_str);
                    }
                }
            }
            // 工坊资产路径（仅当有关联工坊项目）
            if let (Some(ref old_aigc_id), Some(ref new_aigc_id)) =
                (&old_aigc_id_opt, &final_aigc_project_id)
            {
                let old_aigc_prefix = format!(
                    "{}/.kunpeng/aigc-memory/projects/{}",
                    source_home, old_aigc_id
                );
                let new_aigc_prefix = format!(
                    "{}/.kunpeng/aigc-memory/projects/{}",
                    new_home_str, new_aigc_id
                );
                replaced = replaced.replace(&old_aigc_prefix, &new_aigc_prefix);
            }
            if !source_home.trim().is_empty() {
                replaced = replaced.replace(&old_ws_prefix, &new_ws_prefix);
            }
            // 兜底：替换 source_home 根（覆盖其他可能的绝对路径）
            if !source_home.trim().is_empty() && source_home != new_home_str {
                replaced = replaced.replace(&source_home, &new_home_str);
            }

            // 写到 ~/.kunpeng/projects/<newCanvasId>/canvas.json
            let dst_canvas_dir = home.join(".kunpeng/projects").join(new_cid);
            let _ = fs::create_dir_all(&dst_canvas_dir);
            let dst_canvas_file = dst_canvas_dir.join("canvas.json");
            fs::write(&dst_canvas_file, replaced)
                .map_err(|e| format!("写 canvas.json 失败: {}", e))?;
            final_canvas_id = Some(new_cid.clone());
        }
    }

    // 6. 清理临时目录
    let _ = fs::remove_dir_all(&tmp_base);

    Ok(ImportResult {
        aigc_project_id: final_aigc_project_id,
        canvas_project_id: final_canvas_id,
        name,
    })
}

/// 递归拷贝目录（同 commands.rs 的 copy_dir_recursive，这里独立实现避免改 commands.rs）
fn copy_dir_recursive(src: &Path, dst: &Path, overwrite: bool) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &to, overwrite)?;
        } else if overwrite || !to.exists() {
            fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}
