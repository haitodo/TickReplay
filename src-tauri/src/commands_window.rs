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

pub fn apply_window_position_and_logical_size(
    app_handle: &AppHandle,
    window: &tauri::WebviewWindow,
    saved_x: Option<i32>,
    saved_y: Option<i32>,
    logical_w: f64,
    logical_h: f64,
) {
    let mut positioned = false;
    if let (Some(x), Some(y)) = (saved_x, saved_y) {
        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let phys_w = (logical_w * scale_factor) as u32;
        let phys_h = (logical_h * scale_factor) as u32;
        if is_position_valid_on_monitors(app_handle, x, y, phys_w, phys_h) {
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            positioned = true;
        }
    }
    if !positioned {
        let _ = window.center();
    }

    // 重要: 対象モニターの物理座標へ配置後、明示的に論理サイズを再適用することで
    // マルチモニター環境（4K 150% と 2K 100%など）でのDPI不整合によるウィンドウ縮小・歪みを防止する
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: logical_w,
        height: logical_h,
    }));
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
            width: 760.0,
            height: 600.0,
        }))?;

        let app_handle = window.app_handle();
        let settings = tauri::async_runtime::block_on(crate::commands_settings::load_settings(app_handle.clone())).ok().flatten();
        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let main_phys_w = (760.0 * scale_factor) as u32;
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
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 760.0,
            height: 600.0,
        }));
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
                if (0.0..=50.0).contains(&dw) && (0.0..=100.0).contains(&dh) {
                    (dw, dh)
                } else {
                    (16.0, 39.0)
                }
            }
            _ => (16.0, 39.0),
        };

        let outer_w = target_inner_w + dec_w;
        let outer_h = target_inner_h + dec_h;

        apply_window_position_and_logical_size(
            &app_handle,
            &window,
            settings.as_ref().and_then(|s| s.speed_order_window_x),
            settings.as_ref().and_then(|s| s.speed_order_window_y),
            outer_w,
            outer_h,
        );

        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
        window.set_always_on_top(true)?;
    } else {
        let win_builder = tauri::webview::WebviewWindowBuilder::new(
            &app_handle,
            "speed_order",
            tauri::WebviewUrl::App("index.html?window=speed_order".into()),
        )
        .title("Speed Order")
        .inner_size(target_inner_w, target_inner_h)
        .resizable(false)
        .always_on_top(true)
        .visible(false);

        let window = win_builder.build()?;

        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let (dec_w, dec_h) = match (window.outer_size(), window.inner_size()) {
            (Ok(outer), Ok(inner)) => {
                let dw = (outer.width.saturating_sub(inner.width)) as f64 / scale_factor;
                let dh = (outer.height.saturating_sub(inner.height)) as f64 / scale_factor;
                if (0.0..=50.0).contains(&dw) && (0.0..=100.0).contains(&dh) {
                    (dw, dh)
                } else {
                    (16.0, 39.0)
                }
            }
            _ => (16.0, 39.0),
        };

        let outer_w = target_inner_w + dec_w;
        let outer_h = target_inner_h + dec_h;

        apply_window_position_and_logical_size(
            &app_handle,
            &window,
            settings.as_ref().and_then(|s| s.speed_order_window_x),
            settings.as_ref().and_then(|s| s.speed_order_window_y),
            outer_w,
            outer_h,
        );

        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_positions_window(app_handle: AppHandle) -> Result<(), AppError> {
    let target_inner_w = 760.0;
    let target_inner_h = 520.0;
    let settings = crate::commands_settings::load_settings(app_handle.clone()).await.ok().flatten();

    if let Some(window) = app_handle.get_webview_window("positions") {
        apply_window_position_and_logical_size(
            &app_handle,
            &window,
            settings.as_ref().and_then(|s| s.positions_window_x),
            settings.as_ref().and_then(|s| s.positions_window_y),
            target_inner_w,
            target_inner_h,
        );

        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
        window.set_always_on_top(true)?;
    } else {
        let win_builder = tauri::webview::WebviewWindowBuilder::new(
            &app_handle,
            "positions",
            tauri::WebviewUrl::App("index.html?window=positions".into()),
        )
        .title("口座・ポジション管理")
        .inner_size(target_inner_w, target_inner_h)
        .min_inner_size(560.0, 380.0)
        .resizable(true)
        .always_on_top(true)
        .visible(false);

        let window = win_builder.build()?;
        apply_window_position_and_logical_size(
            &app_handle,
            &window,
            settings.as_ref().and_then(|s| s.positions_window_x),
            settings.as_ref().and_then(|s| s.positions_window_y),
            target_inner_w,
            target_inner_h,
        );
        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_main_window_mode(mode: String, window: tauri::Window) -> Result<(), AppError> {
    let (target_w, target_h) = if mode == "replay" {
        (430.0, 325.0)
    } else {
        (760.0, 600.0)
    };

    window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: target_w,
        height: target_h,
    }))?;

    let app_handle = window.app_handle();
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let phys_w = (target_w * scale_factor) as u32;
    let phys_h = (target_h * scale_factor) as u32;

    if let Ok(pos) = window.outer_position() {
        if !is_position_valid_on_monitors(app_handle, pos.x, pos.y, phys_w, phys_h) {
            let _ = window.center();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn open_controller_window(app_handle: AppHandle) -> Result<(), AppError> {
    let target_inner_w = 430.0;
    let target_inner_h = 325.0;
    let settings = crate::commands_settings::load_settings(app_handle.clone()).await.ok().flatten();

    if let Some(window) = app_handle.get_webview_window("controller") {
        apply_window_position_and_logical_size(
            &app_handle,
            &window,
            settings.as_ref().and_then(|s| s.controller_window_x),
            settings.as_ref().and_then(|s| s.controller_window_y),
            target_inner_w,
            target_inner_h,
        );

        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
        window.set_always_on_top(true)?;
    } else {
        let win_builder = tauri::webview::WebviewWindowBuilder::new(
            &app_handle,
            "controller",
            tauri::WebviewUrl::App("index.html?window=controller".into()),
        )
        .title("リプレイ操作コントローラー - TickReplay")
        .inner_size(target_inner_w, target_inner_h)
        .resizable(false)
        .always_on_top(true)
        .visible(false);

        let window = win_builder.build()?;
        apply_window_position_and_logical_size(
            &app_handle,
            &window,
            settings.as_ref().and_then(|s| s.controller_window_x),
            settings.as_ref().and_then(|s| s.controller_window_y),
            target_inner_w,
            target_inner_h,
        );
        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
    }

    // モニター1のメイン設定ウィンドウを非表示にする
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let _ = main_win.hide();
    }

    Ok(())
}

#[tauri::command]
pub async fn show_setup_window(app_handle: AppHandle) -> Result<(), AppError> {
    // コントローラーウィンドウを非表示にする
    if let Some(controller_win) = app_handle.get_webview_window("controller") {
        let _ = controller_win.hide();
    }

    // モニター1のメイン設定ウィンドウを表示・フォーカス
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let _ = main_win.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 760.0,
            height: 600.0,
        }));
        let _ = main_win.show();
        let _ = main_win.set_focus();
    }

    Ok(())
}

#[tauri::command]
pub async fn open_settings_window(app_handle: AppHandle) -> Result<(), AppError> {
    let target_inner_w = 640.0;
    let target_inner_h = 540.0;
    let settings = crate::commands_settings::load_settings(app_handle.clone()).await.ok().flatten();

    if let Some(window) = app_handle.get_webview_window("settings") {
        apply_window_position_and_logical_size(
            &app_handle,
            &window,
            settings.as_ref().and_then(|s| s.settings_window_x),
            settings.as_ref().and_then(|s| s.settings_window_y),
            target_inner_w,
            target_inner_h,
        );

        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
        window.set_always_on_top(true)?;
    } else {
        let win_builder = tauri::webview::WebviewWindowBuilder::new(
            &app_handle,
            "settings",
            tauri::WebviewUrl::App("index.html?window=settings".into()),
        )
        .title("環境設定 - TickReplay")
        .inner_size(target_inner_w, target_inner_h)
        .min_inner_size(560.0, 460.0)
        .resizable(true)
        .always_on_top(true)
        .visible(false);

        let window = win_builder.build()?;
        apply_window_position_and_logical_size(
            &app_handle,
            &window,
            settings.as_ref().and_then(|s| s.settings_window_x),
            settings.as_ref().and_then(|s| s.settings_window_y),
            target_inner_w,
            target_inner_h,
        );
        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn close_settings_window(app_handle: AppHandle) -> Result<(), AppError> {
    if let Some(window) = app_handle.get_webview_window("settings") {
        let _ = window.hide();
        let _ = window.emit("window-visible", false);
    }
    Ok(())
}

#[tauri::command]
pub async fn open_symbol_selector_window(app_handle: AppHandle) -> Result<(), AppError> {
    let target_inner_w = 840.0;
    let target_inner_h = 580.0;

    if let Some(window) = app_handle.get_webview_window("symbol_selector") {
        apply_window_position_and_logical_size(
            &app_handle,
            &window,
            None,
            None,
            target_inner_w,
            target_inner_h,
        );
        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
        window.set_always_on_top(true)?;
    } else {
        let win_builder = tauri::webview::WebviewWindowBuilder::new(
            &app_handle,
            "symbol_selector",
            tauri::WebviewUrl::App("index.html?window=symbol_selector".into()),
        )
        .title("シンボル選択セレクター - TickReplay")
        .inner_size(target_inner_w, target_inner_h)
        .min_inner_size(700.0, 450.0)
        .resizable(true)
        .always_on_top(true)
        .visible(false);

        let window = win_builder.build()?;
        apply_window_position_and_logical_size(
            &app_handle,
            &window,
            None,
            None,
            target_inner_w,
            target_inner_h,
        );
        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn close_symbol_selector_window(app_handle: AppHandle) -> Result<(), AppError> {
    if let Some(window) = app_handle.get_webview_window("symbol_selector") {
        let _ = window.hide();
        let _ = window.emit("window-visible", false);
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_window(app_handle: AppHandle, label: String) -> Result<(), AppError> {
    if let Some(window) = app_handle.get_webview_window(&label) {
        let _ = window.hide();
        let _ = window.emit("window-visible", false);
    }
    Ok(())
}

#[tauri::command]
pub async fn open_tracely_app() -> Result<(), AppError> {
    let mut candidates = Vec::new();

    // 1. インストール先パス探索 (Tauri NSIS per-user / per-machine)
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let base = std::path::PathBuf::from(&local_app_data);
        // Tauri NSIS のデフォルトインストール先 (%LOCALAPPDATA%\Tracely\tracely.exe)
        candidates.push(base.join("Tracely").join("tracely.exe"));
        candidates.push(base.join("Tracely").join("Tracely.exe"));
        candidates.push(base.join("Programs").join("Tracely").join("tracely.exe"));
        candidates.push(base.join("Programs").join("Tracely").join("Tracely.exe"));
    }
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        let base = std::path::PathBuf::from(&program_files);
        candidates.push(base.join("Tracely").join("tracely.exe"));
        candidates.push(base.join("Tracely").join("Tracely.exe"));
    }
    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        let base = std::path::PathBuf::from(&program_files_x86);
        candidates.push(base.join("Tracely").join("tracely.exe"));
        candidates.push(base.join("Tracely").join("Tracely.exe"));
    }

    // 2. ビルド済み release / debug バイナリ探索 (CARGO_TARGET_DIR またはローカル target)
    if let Ok(cargo_target_dir) = std::env::var("CARGO_TARGET_DIR") {
        let target_base = std::path::PathBuf::from(&cargo_target_dir);
        candidates.push(target_base.join("release").join("tracely.exe"));
        candidates.push(target_base.join("release").join("Tracely.exe"));
        candidates.push(target_base.join("debug").join("tracely.exe"));
        candidates.push(target_base.join("debug").join("Tracely.exe"));
    }
    candidates.push(std::path::PathBuf::from("D:/dev/Tracely/src-tauri/target/release/tracely.exe"));
    candidates.push(std::path::PathBuf::from("../Tracely/src-tauri/target/release/tracely.exe"));
    candidates.push(std::path::PathBuf::from("D:/dev/Tracely/src-tauri/target/release/Tracely.exe"));
    candidates.push(std::path::PathBuf::from("../Tracely/src-tauri/target/release/Tracely.exe"));
    candidates.push(std::path::PathBuf::from("D:/dev/Tracely/src-tauri/target/debug/tracely.exe"));
    candidates.push(std::path::PathBuf::from("../Tracely/src-tauri/target/debug/tracely.exe"));
    candidates.push(std::path::PathBuf::from("D:/dev/Tracely/src-tauri/target/debug/Tracely.exe"));
    candidates.push(std::path::PathBuf::from("../Tracely/src-tauri/target/debug/Tracely.exe"));

    for candidate in &candidates {
        if candidate.is_file() {
            let _ = std::process::Command::new(candidate).spawn();
            return Ok(());
        }
    }

    // 3. 開発フォールバック: バイナリが存在しない場合のみ開発サーバーを起動
    let dev_dir = std::path::PathBuf::from("D:/dev/Tracely");
    if dev_dir.is_dir() {
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", "powershell", "-NoExit", "-Command", "cd D:\\dev\\Tracely; pnpm run tauri dev"])
            .spawn();
        return Ok(());
    }

    Err(AppError::Other("Tracely アプリケーションが見つかりませんでした。".to_string()))
}

#[tauri::command]
pub async fn open_trade_analysis_window() -> Result<(), AppError> {
    open_tracely_app().await
}

#[tauri::command]
pub fn exit_app(app_handle: AppHandle) {
    if let Some(state) = app_handle.try_state::<std::sync::Arc<crate::state::ReplayState>>() {
        let _ = crate::commands_replay::dispatch_replay_command(&state, "{\"command\":\"TERMINATE\"}", Some(&app_handle));
    }
    // MT5 描画パイプへの TERMINATE パケット送信フラッシュを確実に完了させる
    std::thread::sleep(std::time::Duration::from_millis(80));
    app_handle.exit(0);
}
