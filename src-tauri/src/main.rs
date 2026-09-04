#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

mod browser;
mod commands;
mod dsh;
mod kimi;
mod lark;
mod mcp_stdio;
mod project_archive;
mod stream_proxy;
mod tools;
mod wechat;

use commands::*;
use tauri::{
    CustomMenuItem, Manager, RunEvent, SystemTray, SystemTrayEvent, SystemTrayMenu,
    SystemTrayMenuItem, WindowEvent,
};

#[cfg(target_os = "macos")]
use cocoa::appkit::{NSColor, NSWindow};
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil, NO};

fn mime_of_path(path: &str) -> &'static str {    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
async fn runninghub_app_upload(
    api_key: String,
    file_path: String,
    upload_url: Option<String>,
) -> Result<String, String> {
    // Keep a copy for redacting error bodies that might echo the credential.
    let redact_key = api_key.trim().to_string();
    // 站点（国内 .cn / 国际 .ai）由前端按设置传入；缺省保持国内站。
    let upload_url = upload_url
        .filter(|u| u.starts_with("https://"))
        .unwrap_or_else(|| "https://www.runninghub.cn/task/openapi/upload".to_string());
    let upload_host = upload_url
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("www.runninghub.cn")
        .to_string();
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .to_string();
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("读取上传文件失败: {}", e))?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str(mime_of_path(&file_path))
        .map_err(|e| format!("识别上传文件 MIME 失败: {}", e))?;
    let form = reqwest::multipart::Form::new()
        .text("apiKey", api_key)
        .text("fileType", "input")
        .part("file", part);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("创建上传客户端失败: {}", e))?;
    let resp = client
        .post(&upload_url)
        .header("Host", &upload_host)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("RunningHub AI-app 上传请求失败: {}", e))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取 RunningHub 上传响应失败: {}", e))?;
    if !status.is_success() {
        let safe = if redact_key.len() >= 8 {
            text.replace(&redact_key, "[REDACTED]")
        } else {
            text.clone()
        };
        return Err(format!(
            "RunningHub AI-app 上传失败 (HTTP {}): {}",
            status.as_u16(),
            safe.chars().take(500).collect::<String>()
        ));
    }
    let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
        let safe = if redact_key.len() >= 8 {
            text.replace(&redact_key, "[REDACTED]")
        } else {
            text.clone()
        };
        format!(
            "RunningHub AI-app 上传响应不是 JSON: {}; {}",
            e,
            safe.chars().take(300).collect::<String>()
        )
    })?;
    if parsed.get("code").and_then(|v| v.as_i64()) == Some(0) {
        if let Some(file_name) = parsed
            .get("data")
            .and_then(|d| d.get("fileName"))
            .and_then(|v| v.as_str())
        {
            return Ok(file_name.to_string());
        }
    }
    Err(format!(
        "RunningHub AI-app 上传被拒绝: {}",
        parsed.get("msg").and_then(|v| v.as_str()).unwrap_or(&text)
    ))
}

#[tauri::command]
async fn runninghub_standard_upload(api_key: String, file_path: String) -> Result<String, String> {
    // Keep a copy for redacting error bodies that might echo the credential.
    let redact_key = api_key.trim().to_string();
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .to_string();
    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("读取上传文件失败: {}", e))?;
    let size = bytes.len();
    let mime = mime_of_path(&file_path);
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name.clone())
        .mime_str(mime)
        .map_err(|e| format!("识别上传文件 MIME 失败: {}", e))?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("创建上传客户端失败: {}", e))?;
    let resp = client
        .post("https://www.runninghub.cn/openapi/v2/media/upload/binary")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            format!(
                "RunningHub 标准上传请求失败: {}; file={}, mime={}, size={}",
                e, file_name, mime, size
            )
        })?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取 RunningHub 标准上传响应失败: {}", e))?;
    if !status.is_success() {
        let safe = if redact_key.len() >= 8 {
            text.replace(&redact_key, "[REDACTED]")
        } else {
            text.clone()
        };
        return Err(format!(
            "RunningHub 标准上传失败 (HTTP {}): {}; file={}, mime={}, size={}",
            status.as_u16(),
            safe.chars().take(500).collect::<String>(),
            file_name,
            mime,
            size
        ));
    }
    let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
        let safe = if redact_key.len() >= 8 {
            text.replace(&redact_key, "[REDACTED]")
        } else {
            text.clone()
        };
        format!(
            "RunningHub 标准上传响应不是 JSON: {}; {}",
            e,
            safe.chars().take(300).collect::<String>()
        )
    })?;
    if parsed.get("code").and_then(|v| v.as_i64()) == Some(0) {
        if let Some(download_url) = parsed
            .get("data")
            .and_then(|d| d.get("download_url"))
            .and_then(|v| v.as_str())
        {
            return Ok(download_url.to_string());
        }
    }
    Err(format!(
        "RunningHub 标准上传被拒绝: {}; file={}, mime={}, size={}",
        parsed.get("msg").and_then(|v| v.as_str()).unwrap_or(&text),
        file_name,
        mime,
        size
    ))
}

#[tauri::command]
fn toggle_main_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// macOS：点击 Dock 图标恢复主窗口（issue #4）。
/// tao 0.16（Tauri 1.x）未实现 applicationShouldHandleReopen:hasVisibleWindows:，
/// 且常驻悬浮球窗口让系统默认的"无可见窗口才恢复"判断短路，导致主窗口
/// 最小化/关闭隐藏后点 Dock 图标无反应。这里给现有 app delegate 类补上
/// reopen 方法：取消最小化、显示并置前主窗口。
#[cfg(target_os = "macos")]
fn install_dock_reopen_handler(app_handle: tauri::AppHandle) {
    use cocoa::appkit::NSApp;
    use objc::runtime::{
        class_addMethod, class_getInstanceMethod, method_setImplementation,
        object_getClass, Imp, Object, Sel, BOOL, NO, YES,
    };
    use std::sync::OnceLock;

    static REOPEN_APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    let _ = REOPEN_APP.set(app_handle);

    extern "C" fn should_handle_reopen(
        _this: &Object,
        _cmd: Sel,
        _sender: id,
        _has_visible_windows: BOOL,
    ) -> BOOL {
        if let Some(handle) = REOPEN_APP.get() {
            if let Some(win) = handle.get_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
        YES
    }

    unsafe {
        let ns_app = NSApp();
        let delegate: id = msg_send![ns_app, delegate];
        if delegate.is_null() {
            return;
        }
        let cls = object_getClass(delegate) as *mut objc::runtime::Class;
        let imp: Imp = std::mem::transmute(
            should_handle_reopen as extern "C" fn(&Object, Sel, id, BOOL) -> BOOL,
        );
        // 先尝试新增；tao 若已带默认实现（按 hasVisibleWindows 短路），
        // class_addMethod 会失败，退而用 method_setImplementation 直接替换。
        let reopen_sel = sel!(applicationShouldHandleReopen:hasVisibleWindows:);
        let added = class_addMethod(cls, reopen_sel, imp, b"B@:@B\0".as_ptr() as *const i8);
        if added == NO {
            let method = class_getInstanceMethod(cls, reopen_sel) as *mut objc::runtime::Method;
            if !method.is_null() {
                method_setImplementation(method, imp);
            }
        }
    }
}

fn main() {
    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show", "显示鲲鹏"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", "退出"));

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .manage(browser::BrowserState::default())
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                if let Some(win) = app.get_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "show" => {
                    if let Some(win) = app.get_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .manage(mcp_stdio::McpStdioState::default())
        .manage(dsh::DshState::default())
        .manage(stream_proxy::StreamProxyState::default())
        .manage(lark::LarkState::default())
        .manage(tools::bash::BashProcessState::default())
        .manage(wechat::WechatState::default())
        .setup(|app| {
            // 部署内置资源（AGENT.md/skills/aigc-memory 种子），版本变更时覆盖
            commands::deploy_bundled_resources(&app.handle());

            // Windows：补 python3 shim（有 python 无 python3 时自愈）
            #[cfg(target_os = "windows")]
            std::thread::spawn(ensure_python3_shim);

            // macOS：接管 Dock 图标点击，恢复主窗口（issue #4）
            #[cfg(target_os = "macos")]
            install_dock_reopen_handler(app.handle());

            #[cfg(debug_assertions)]
            {
                let window = app.get_window("main").unwrap();
                window.open_devtools();
            }

            // Force float-ball window fully transparent on macOS
            #[cfg(target_os = "macos")]
            if let Some(float_win) = app.get_window("float-ball") {
                unsafe {
                    let ns_win = float_win.ns_window().unwrap() as id;
                    ns_win.setBackgroundColor_(NSColor::clearColor(nil));
                    ns_win.setOpaque_(NO);
                    ns_win.setHasShadow_(NO);

                    // Walk subviews to find WKWebView and disable background drawing
                    let content_view: id = ns_win.contentView();
                    set_transparent_recursive(content_view);
                }
            }

            Ok(())
        })
        .on_window_event(|event| {
            if event.window().label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event.event() {
                    let _ = event.window().hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_home_dir,
            write_text_file_private,
            get_temp_dir,
            get_file_size,
            get_file_metadata,
            prepare_image_for_vision,
            browser::browser_open,
            browser::browser_install,
            browser::browser_snapshot,
            browser::browser_action,
            browser::browser_evaluate,
            browser::browser_screenshot,
            browser::browser_close,
            tools::bash::shell_info,
            kimi::kimi_upload_video,
            open_path,
            scan_skills_dir,
            scan_dir_meta,
            ensure_workspace,
            save_file_dialog,
            project_archive::export_project_zip,
            project_archive::import_project_zip,
            runninghub_app_upload,
            runninghub_standard_upload,
            toggle_main_window,
            tools::bash::execute_command,
            tools::bash::read_command_output,
            tools::bash::kill_command,
            tools::file_ops::read_file,
            tools::file_ops::write_file,
            tools::file_ops::append_file,
            tools::file_ops::edit_file,
            tools::search::glob_search,
            tools::search::grep_search,
            tools::search::list_directory,
            mcp_stdio::mcp_stdio_spawn,
            mcp_stdio::mcp_stdio_send,
            mcp_stdio::mcp_stdio_kill,
            dsh::dsh_set_tools,
            dsh::dsh_tool_respond,
            dsh::dsh_start,
            dsh::dsh_send,
            dsh::dsh_stop,
            stream_proxy::stream_http_request,
            stream_proxy::abort_stream_request,
            wechat::wechat_get_qrcode,
            wechat::wechat_poll_qrcode,
            wechat::wechat_start_polling,
            wechat::wechat_stop_polling,
            wechat::wechat_send_message,
            wechat::wechat_send_file,
            wechat::wechat_send_typing,
            wechat::wechat_get_status,
            wechat::wechat_disconnect,
            wechat::wechat_restore_session,
            wechat::wechat_save_data,
            wechat::wechat_load_data,
            lark::lark_save_config,
            lark::lark_restore_config,
            lark::lark_start_server,
            lark::lark_stop_server,
            lark::lark_send_message,
            lark::lark_send_stream_card,
            lark::lark_update_stream_card,
            lark::lark_get_status,
            lark::lark_save_data,
            lark::lark_load_data,
            lark::lark_download_resource,
            lark::lark_upload_image,
            lark::lark_upload_file,
            lark::lark_send_image,
            lark::lark_send_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Tier 2.5: abort every active stream so we exit cleanly
                // instead of letting the runtime drop tokio tasks mid-read.
                let state = app.state::<stream_proxy::StreamProxyState>();
                let aborted = state.abort_all();
                if aborted > 0 {
                    eprintln!("[shutdown] aborted {} active stream(s)", aborted);
                }
                // Also kill any running bash command process groups so spawned
                // children (python gen scripts etc.) don't outlive the app.
                let bash_state = app.state::<tools::bash::BashProcessState>();
                let killed = bash_state.kill_all();
                if killed > 0 {
                    eprintln!("[shutdown] killed {} active bash command(s)", killed);
                }
                let dsh_state = app.state::<dsh::DshState>().inner().clone();
                tauri::async_runtime::block_on(async move {
                    let stopped = dsh_state.stop_all().await;
                    if stopped > 0 {
                        eprintln!("[shutdown] stopped {} Harness process(es)", stopped);
                    }
                });
            }
        });
}

#[cfg(target_os = "macos")]
unsafe fn set_transparent_recursive(view: id) {
    // Try _setDrawsBackground:NO on every subview — WKWebView responds to this
    let responds: bool =
        objc::msg_send![view, respondsToSelector: objc::sel!(_setDrawsBackground:)];
    if responds {
        let _: () = objc::msg_send![view, _setDrawsBackground: NO];
    }

    let subviews: id = objc::msg_send![view, subviews];
    let count: usize = objc::msg_send![subviews, count];
    for i in 0..count {
        let subview: id = objc::msg_send![subviews, objectAtIndex: i];
        set_transparent_recursive(subview);
    }
}

/// Windows 的 python.org 安装包通常只有 python.exe（无 python3.exe），而项目
/// 里大量路径（COS 上传、agent 技能脚本、shell 示例）按 POSIX 习惯调用
/// python3。首次启动时自愈：有 python 无 python3 就把 python.exe 复制为
/// ~/.kunpeng/bin/python3.exe 并加入用户 PATH（.NET 写入会同时广播
/// WM_SETTINGCHANGE）。没有 Python 则不动作（应用内会给出明确安装指引）。
#[cfg(target_os = "windows")]
fn ensure_python3_shim() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let run = |prog: &str, args: &[&str]| -> Option<std::process::Output> {
        std::process::Command::new(prog)
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()
    };
    let works = |prog: &str| {
        run(prog, &["--version"])
            .map(|o| o.status.success())
            .unwrap_or(false)
    };

    if works("python3") {
        return;
    }

    // 定位可用的 python.exe：PATH → py 启动器 → 常见安装目录
    let python_exe = if works("python") {
        run("where", &["python"]).and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .next()
                .map(|s| s.trim().to_string())
        })
    } else {
        None
    }
    .or_else(|| {
        run("py", &["-3", "-c", "import sys; print(sys.executable)"]).and_then(|o| {
            if o.status.success() {
                let p = String::from_utf8_lossy(&o.stdout).trim().to_string();
                (!p.is_empty() && std::path::Path::new(&p).is_file()).then_some(p)
            } else {
                None
            }
        })
    })
    .or_else(|| {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let mut candidates = vec![];
        for v in ["314", "313", "312", "311", "310"] {
            candidates.push(format!("C:\\Python{}\\python.exe", v));
            candidates.push(format!("{}\\Programs\\Python\\Python{}\\python.exe", local, v));
        }
        candidates
            .into_iter()
            .find(|p| std::path::Path::new(p).is_file())
    });

    let Some(python_exe) = python_exe else {
        eprintln!("[python3-shim] 未检测到 Python，跳过 shim（应用内会提示安装）");
        return;
    };

    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let bin_dir = home.join(".kunpeng").join("bin");
    if std::fs::create_dir_all(&bin_dir).is_err() {
        return;
    }
    let shim = bin_dir.join("python3.exe");
    if !shim.exists() && std::fs::copy(&python_exe, &shim).is_err() {
        eprintln!("[python3-shim] 复制 {} -> {:?} 失败", python_exe, shim);
        return;
    }
    eprintln!("[python3-shim] 已创建 {:?}（源 {}）", shim, python_exe);

    // 加入用户 PATH（幂等）：用 .NET 写入，自带 WM_SETTINGCHANGE 广播。
    let bin_str = bin_dir.to_string_lossy().to_string();
    let ps = format!(
        "$bin='{}'; $cur=[Environment]::GetEnvironmentVariable('Path','User'); \
         if (($cur -split ';') -notcontains $bin) {{ \
           [Environment]::SetEnvironmentVariable('Path', ($cur.TrimEnd(';') + ';' + $bin), 'User') }}",
        bin_str.replace('\'', "''")
    );
    let ok = run("powershell", &["-NoProfile", "-Command", &ps])
        .map(|o| o.status.success())
        .unwrap_or(false);
    eprintln!(
        "[python3-shim] 用户 PATH {}（{}）",
        if ok { "已包含 shim 目录" } else { "写入失败" },
        bin_str
    );
}
