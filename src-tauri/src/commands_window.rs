use tauri::{AppHandle, Manager, Emitter};
use crate::error::AppError;

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
        window.center()?;
        window.set_always_on_top(always_on_top)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_speed_order_window(app_handle: AppHandle) -> Result<(), AppError> {
    let target_inner_w = 320.0;
    let target_inner_h = 438.0;

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

        if let Some(main_win) = app_handle.get_webview_window("main") {
            if let (Ok(main_pos), Ok(main_size)) = (main_win.outer_position(), main_win.outer_size()) {
                let main_scale = main_win.scale_factor().unwrap_or(1.0);
                let speed_w_phys = (outer_w * main_scale) as i32;
                let speed_h_phys = (outer_h * main_scale) as i32;

                let target_x = main_pos.x + (main_size.width as i32 - speed_w_phys) / 2;
                let target_y = main_pos.y + (main_size.height as i32 - speed_h_phys) / 2;

                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: target_x,
                    y: target_y,
                }));
            } else {
                let _ = window.center();
            }
        } else {
            let _ = window.center();
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

        if let Some(main_win) = app_handle.get_webview_window("main") {
            if let (Ok(main_pos), Ok(main_size)) = (main_win.outer_position(), main_win.outer_size()) {
                let main_scale = main_win.scale_factor().unwrap_or(1.0);
                let speed_w_phys = (outer_w * main_scale) as i32;
                let speed_h_phys = (outer_h * main_scale) as i32;

                let target_x = main_pos.x + (main_size.width as i32 - speed_w_phys) / 2;
                let target_y = main_pos.y + (main_size.height as i32 - speed_h_phys) / 2;

                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: target_x,
                    y: target_y,
                }));
            } else {
                let _ = window.center();
            }
        } else {
            let _ = window.center();
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
pub async fn open_trade_analysis_window(app_handle: AppHandle) -> Result<(), AppError> {
    let target_w = 520.0;
    let target_h = 600.0;

    if let Some(window) = app_handle.get_webview_window("trade_analysis") {
        if let Some(main_win) = app_handle.get_webview_window("main") {
            if let (Ok(main_pos), Ok(main_size)) = (main_win.outer_position(), main_win.outer_size()) {
                let scale_factor = main_win.scale_factor().unwrap_or(1.0);
                let w_phys = (target_w * scale_factor) as i32;
                let h_phys = (target_h * scale_factor) as i32;

                let target_x = main_pos.x + (main_size.width as i32 - w_phys) / 2;
                let target_y = main_pos.y + (main_size.height as i32 - h_phys) / 2;

                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: target_x,
                    y: target_y,
                }));
            } else {
                let _ = window.center();
            }
        } else {
            let _ = window.center();
        }

        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: target_w,
            height: target_h,
        }));

        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
    } else {
        let mut win_builder = tauri::webview::WebviewWindowBuilder::new(
            &app_handle,
            "trade_analysis",
            tauri::WebviewUrl::App("index.html?window=trade_analysis".into()),
        )
        .title("Trade Analysis")
        .inner_size(target_w, target_h)
        .resizable(true)
        .always_on_top(false)
        .maximized(false)
        .visible(false);

        if let Some(main_win) = app_handle.get_webview_window("main") {
            win_builder = win_builder.parent(&main_win)?;
        }

        let window = win_builder.build()?;

        if let Some(main_win) = app_handle.get_webview_window("main") {
            if let (Ok(main_pos), Ok(main_size)) = (main_win.outer_position(), main_win.outer_size()) {
                let scale_factor = main_win.scale_factor().unwrap_or(1.0);
                let w_phys = (target_w * scale_factor) as i32;
                let h_phys = (target_h * scale_factor) as i32;

                let target_x = main_pos.x + (main_size.width as i32 - w_phys) / 2;
                let target_y = main_pos.y + (main_size.height as i32 - h_phys) / 2;

                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: target_x,
                    y: target_y,
                }));
            } else {
                let _ = window.center();
            }
        } else {
            let _ = window.center();
        }

        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;

        #[cfg(debug_assertions)]
        window.open_devtools();
    }
    Ok(())
}
