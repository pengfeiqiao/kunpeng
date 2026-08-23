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

fn mime_of_path(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
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
async fn runninghub_app_upload(api_key: String, file_path: String) -> Result<String, String> {
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
        .post("https://www.runninghub.cn/task/openapi/upload")
        .header("Host", "www.runninghub.cn")
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
            browser::browser_open,
            browser::browser_install,
            browser::browser_snapshot,
            browser::browser_action,
            browser::browser_screenshot,
            browser::browser_close,
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
