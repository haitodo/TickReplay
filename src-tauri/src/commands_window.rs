use tauri::{AppHandle, Manager, Emitter};
use crate::error::AppError;

pub fn is_position_valid_on_monitors(
    app_handle: &AppHandle,
    pos_x: i32,
    pos_y: i32,
    win_w_phys: u32,
    win_h_phys: u32,
) -> bool {
    let monitors = match app_handle.available_monitors() {
        Ok(m) if !m.is_empty() => m,
        _ => return false,
    };

    let win_left = pos_x;
    let win_top = pos_y;
    let win_right = pos_x + win_w_phys as i32;
    let win_bottom = pos_y + win_h_phys as i32;

    for monitor in monitors {
        let mon_pos = monitor.position();
        let mon_size = monitor.size();
        let mon_left = mon_pos.x;
        let mon_top = mon_pos.y;
        let mon_right = mon_pos.x + mon_size.width as i32;
        let mon_bottom = mon_pos.y + mon_size.height as i32;

        let overlap_left = win_left.max(mon_left);
        let overlap_right = win_right.min(mon_right);
        let overlap_top = win_top.max(mon_top);
        let overlap_bottom = win_bottom.min(mon_bottom);

        let overlap_w = overlap_right - overlap_left;
        let overlap_h = overlap_bottom - overlap_top;

        if overlap_w >= 50 && overlap_h >= 30 && win_top >= mon_top && win_top < mon_bottom - 30 {
            return true;
        }
    }

    false
}

#[tauri::command]
pub fn set_always_on_top(always: bool, window: tauri::Window) -> Result<(), AppError> {
    window.set_always_on_top(always)?;
    Ok(())
}

#[tauri::command]
pub fn set_remote_mode(is_remote: bool, always_on_top: bool, window: tauri::Window) -> Result<(), AppError> {
    if is_remote {
        window.set_decorations(false)?;
        window.set_resizable(false)?;
        window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 950.0,
            height: 48.0,
        }))?;
        window.set_always_on_top(true)?;

        if let Ok(Some(monitor)) = window.current_monitor() {
            let scale_factor = monitor.scale_factor();
            let monitor_size = monitor.size();
            let monitor_pos = monitor.position();

            let width = 950.0;
            let height = 48.0;
            let physical_width = width * scale_factor;
            let physical_height = height * scale_factor;

            let x = monitor_pos.x + ((monitor_size.width as f64 - physical_width) / 2.0) as i32;
            let y = monitor_pos.y + (monitor_size.height as f64 - physical_height - (40.0 * scale_factor)) as i32;

            window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))?;
        }
    } else {
        window.set_decorations(true)?;
        window.set_resizable(true)?;
        window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 520.0,
            height: 600.0,
        }))?;

        let app_handle = window.app_handle();
        let settings = tauri::async_runtime::block_on(crate::commands_settings::load_settings(app_handle.clone())).ok().flatten();
        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let main_phys_w = (520.0 * scale_factor) as u32;
        let main_phys_h = (600.0 * scale_factor) as u32;

        let mut positioned = false;
        if let Some(ref s) = settings {
            if let (Some(x), Some(y)) = (s.main_window_x, s.main_window_y) {
                if is_position_valid_on_monitors(app_handle, x, y, main_phys_w, main_phys_h) {
                    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
                    positioned = true;
                }
            }
        }
        if !positioned {
            window.center()?;
        }
        window.set_always_on_top(always_on_top)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_speed_order_window(app_handle: AppHandle) -> Result<(), AppError> {
    let target_inner_w = 320.0;
    let target_inner_h = 438.0;
    let settings = crate::commands_settings::load_settings(app_handle.clone()).await.ok().flatten();

    if let Some(window) = app_handle.get_webview_window("speed_order") {
        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let (dec_w, dec_h) = match (window.outer_size(), window.inner_size()) {
            (Ok(outer), Ok(inner)) => {
                let dw = (outer.width.saturating_sub(inner.width)) as f64 / scale_factor;
                let dh = (outer.height.saturating_sub(inner.height)) as f64 / scale_factor;
                if dw >= 0.0 && dw <= 50.0 && dh >= 0.0 && dh <= 100.0 {
                    (dw, dh)
                } else {
                    (16.0, 39.0)
                }
            }
            _ => (16.0, 39.0),
        };

        let outer_w = target_inner_w + dec_w;
        let outer_h = target_inner_h + dec_h;
        let speed_phys_w = (outer_w * scale_factor) as u32;
        let speed_phys_h = (outer_h * scale_factor) as u32;

        let mut positioned = false;
        if let Some(ref s) = settings {
            if let (Some(x), Some(y)) = (s.speed_order_window_x, s.speed_order_window_y) {
                if is_position_valid_on_monitors(&app_handle, x, y, speed_phys_w, speed_phys_h) {
                    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
                    positioned = true;
                }
            }
        }

        if !positioned {
            if let Some(main_win) = app_handle.get_webview_window("main") {
                if let (Ok(main_pos), Ok(main_size)) = (main_win.outer_position(), main_win.outer_size()) {
                    let main_scale = main_win.scale_factor().unwrap_or(1.0);
                    let speed_w_phys = (outer_w * main_scale) as i32;
                    let speed_h_phys = (outer_h * main_scale) as i32;

                    let target_x = main_pos.x + (main_size.width as i32 - speed_w_phys) / 2;
                    let target_y = main_pos.y + (main_size.height as i32 - speed_h_phys) / 2;

                    if is_position_valid_on_monitors(&app_handle, target_x, target_y, speed_phys_w, speed_phys_h) {
                        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                            x: target_x,
                            y: target_y,
                        }));
                        positioned = true;
                    }
                }
            }
            if !positioned {
                let _ = window.center();
            }
        }

        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: outer_w,
            height: outer_h,
        }));

        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
        window.set_always_on_top(true)?;
    } else {
        let mut win_builder = tauri::webview::WebviewWindowBuilder::new(
            &app_handle,
            "speed_order",
            tauri::WebviewUrl::App("index.html?window=speed_order".into()),
        )
        .title("Speed Order")
        .inner_size(target_inner_w, target_inner_h)
        .resizable(false)
        .always_on_top(true)
        .visible(false);

        if let Some(main_win) = app_handle.get_webview_window("main") {
            win_builder = win_builder.parent(&main_win)?;
        }

        let window = win_builder.build()?;

        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let (dec_w, dec_h) = match (window.outer_size(), window.inner_size()) {
            (Ok(outer), Ok(inner)) => {
                let dw = (outer.width.saturating_sub(inner.width)) as f64 / scale_factor;
                let dh = (outer.height.saturating_sub(inner.height)) as f64 / scale_factor;
                if dw >= 0.0 && dw <= 50.0 && dh >= 0.0 && dh <= 100.0 {
                    (dw, dh)
                } else {
                    (16.0, 39.0)
                }
            }
            _ => (16.0, 39.0),
        };

        let outer_w = target_inner_w + dec_w;
        let outer_h = target_inner_h + dec_h;
        let speed_phys_w = (outer_w * scale_factor) as u32;
        let speed_phys_h = (outer_h * scale_factor) as u32;

        let mut positioned = false;
        if let Some(ref s) = settings {
            if let (Some(x), Some(y)) = (s.speed_order_window_x, s.speed_order_window_y) {
                if is_position_valid_on_monitors(&app_handle, x, y, speed_phys_w, speed_phys_h) {
                    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
                    positioned = true;
                }
            }
        }

        if !positioned {
            if let Some(main_win) = app_handle.get_webview_window("main") {
                if let (Ok(main_pos), Ok(main_size)) = (main_win.outer_position(), main_win.outer_size()) {
                    let main_scale = main_win.scale_factor().unwrap_or(1.0);
                    let speed_w_phys = (outer_w * main_scale) as i32;
                    let speed_h_phys = (outer_h * main_scale) as i32;

                    let target_x = main_pos.x + (main_size.width as i32 - speed_w_phys) / 2;
                    let target_y = main_pos.y + (main_size.height as i32 - speed_h_phys) / 2;

                    if is_position_valid_on_monitors(&app_handle, target_x, target_y, speed_phys_w, speed_phys_h) {
                        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                            x: target_x,
                            y: target_y,
                        }));
                        positioned = true;
                    }
                }
            }
            if !positioned {
                let _ = window.center();
            }
        }

        window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: outer_w,
            height: outer_h,
        }))?;

        window.show()?;
        let _ = window.emit("window-visible", true);
    }
    Ok(())
}


#[tauri::command]
pub async fn open_tracely_app() -> Result<(), AppError> {
    // 1. 開発環境の実行バイナリ探索
    let candidates = [
        std::path::PathBuf::from("../Tracely/src-tauri/target/release/tracely.exe"),
        std::path::PathBuf::from("D:/dev/Tracely/src-tauri/target/release/tracely.exe"),
        std::path::PathBuf::from("../Tracely/src-tauri/target/debug/tracely.exe"),
        std::path::PathBuf::from("D:/dev/Tracely/src-tauri/target/debug/tracely.exe"),
    ];

    for candidate in &candidates {
        if candidate.is_file() {
            let _ = std::process::Command::new(candidate).spawn();
            return Ok(());
        }
    }

    // 2. インストール先パス探索
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let installed = std::path::PathBuf::from(local_app_data)
            .join("Programs")
            .join("Tracely")
            .join("Tracely.exe");
        if installed.is_file() {
            let _ = std::process::Command::new(installed).spawn();
            return Ok(());
        }
    }

    // 3. 開発フォールバック: Tracelyプロジェクトディレクトリが存在すれば起動
    let dev_dir = std::path::PathBuf::from("D:/dev/Tracely");
    if dev_dir.is_dir() {
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", "powershell", "-NoExit", "-Command", "cd D:\\dev\\Tracely; npm run tauri dev"])
            .spawn();
        return Ok(());
    }

    Err(AppError::Other("Tracely アプリケーションが見つかりませんでした。".to_string()))
}

#[tauri::command]
pub async fn open_trade_analysis_window() -> Result<(), AppError> {
    open_tracely_app().await
}
