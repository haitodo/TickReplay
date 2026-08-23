// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod error;
pub mod state;
pub mod mt5;
pub mod ipc;
pub mod shortcut;
pub mod custom_symbol;
pub mod commands_replay;
pub mod commands_mt5;
pub mod commands_custom_symbol;
pub mod commands_settings;
pub mod commands_window;
pub mod commands;
pub mod sync_server;

use std::sync::Arc;
use tauri::{Manager, Emitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 起動時の初期化処理（MT5データフォルダへのEAファイルの自動配置）
    mt5::setup_mt5_environment();

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let (sync_srv, sync_tx) = sync_server::SyncServer::new();
    let state = Arc::new(state::ReplayState::new(tx, sync_tx));
    let state_clone = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, _event| {
                    // ショートカットキー押下イベントのハンドル
                    let state = app.state::<Arc<state::ReplayState>>();
                    let shortcut_str = shortcut.to_string().to_lowercase();
                    let state_inner = state.inner().clone();
                    
                    let app_handle = app.clone();
                    // 非同期でショートカットアクションを実行
                    tauri::async_runtime::spawn(async move {
                        shortcut::handle_shortcut_trigger(app_handle, &shortcut_str, &state_inner).await;
                    });
                })
                .build(),
        )
        .manage(state_clone)
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::Moved(pos) => {
                    let label = window.label().to_string();
                    let app_handle = window.app_handle().clone();
                    let x = pos.x;
                    let y = pos.y;

                    let is_standard_main = if label == "main" {
                        window.outer_size().map(|s| s.height > 100).unwrap_or(true)
                    } else {
                        true
                    };

                    if is_standard_main {
                        tauri::async_runtime::spawn(async move {
                            let _ = commands_settings::save_window_position_to_disk(&app_handle, &label, x, y).await;
                        });
                    }
                }
                tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    let label = window.label();
                    let (w, h) = match label {
                        "controller" => (Some(430.0), Some(325.0)),
                        "positions" => (Some(760.0), Some(520.0)),
                        "settings" => (Some(640.0), Some(540.0)),
                        _ => (None, None),
                    };
                    if let (Some(target_w), Some(target_h)) = (w, h) {
                        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                            width: target_w,
                            height: target_h,
                        }));
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "speed_order" || window.label() == "positions" || window.label() == "settings" || window.label() == "controller" || window.label() == "symbol_selector" {
                        // 完全に破棄せず非表示にすることで、次回起動を瞬時に行う（チラつき防止）
                        api.prevent_close();
                        let _ = window.hide();
                        let _ = window.emit("window-visible", false);
                        if window.label() == "controller" {
                            if let Some(main_win) = window.app_handle().get_webview_window("main") {
                                let _ = main_win.show();
                                let _ = main_win.set_focus();
                            }
                        }
                    } else if window.label() == "main" {
                        // メインウィンドウが閉じられた場合はアプリ全体をクリーンに終了
                        if let Some(state) = window.app_handle().try_state::<Arc<state::ReplayState>>() {
                            let _ = state.command_tx.send("{\"command\":\"TERMINATE\"}".to_string());
                        }
                        window.app_handle().exit(0);
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    if window.label() == "main" {
                        if let Some(state) = window.app_handle().try_state::<Arc<state::ReplayState>>() {
                            let _ = state.command_tx.send("{\"command\":\"TERMINATE\"}".to_string());
                        }
                        window.app_handle().exit(0);
                    }
                }
                _ => {}
            }
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let state = app.state::<Arc<state::ReplayState>>();
            let state_inner = state.inner().clone();
            
            // 単一の全二重 Named Pipe サーバー（Rust ⇔ EA）を起動
            tauri::async_runtime::spawn(ipc::run_ipc_pipe_server(rx, app_handle.clone(), state_inner.clone()));
            
            // Drenhis/Tracely等の外部ツール連携用 WebSocket 同期サーバーを起動
            tauri::async_runtime::spawn(sync_srv.run(state_inner, sync_server::DEFAULT_SYNC_PORT));
            
            // 高DPIや異なる拡大率（150%など）のディスプレイ環境下で初回起動した際、
            // ウィンドウサイズが適切にスケーリングされない不具合を回避するため、
            // 非表示状態のウィンドウに対して明示的に論理サイズ (LogicalSize) を設定し、
            // 前回保存位置（有効時）または画面中央に配置したのち表示（show）する。
            if let Some(window) = app.get_webview_window("main") {
                let settings = tauri::async_runtime::block_on(commands_settings::load_settings(app_handle.clone())).ok().flatten();
                let scale_factor = window.scale_factor().unwrap_or(1.0);
                let main_phys_w = (760.0 * scale_factor) as u32;
                let main_phys_h = (600.0 * scale_factor) as u32;

                let mut positioned = false;
                if let Some(ref s) = settings {
                    if let (Some(x), Some(y)) = (s.main_window_x, s.main_window_y) {
                        if commands_window::is_position_valid_on_monitors(&app_handle, x, y, main_phys_w, main_phys_h) {
                            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
                            positioned = true;
                        }
                    }
                }

                if !positioned {
                    let _ = window.center();
                }

                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 760.0,
                    height: 600.0,
                }));

                let _ = window.show();

                // リプレイ操作コントローラー画面を初期起動時にあらかじめ非表示で作成（キャッシュ化）
                let controller_builder = tauri::webview::WebviewWindowBuilder::new(
                    &app_handle,
                    "controller",
                    tauri::WebviewUrl::App("index.html?window=controller".into()),
                )
                .title("リプレイ操作コントローラー - TickReplay")
                .inner_size(430.0, 325.0)
                .resizable(false)
                .always_on_top(true)
                .visible(false);

                let _ = controller_builder.build()?;

                // スピード発注画面を初期起動時にあらかじめ非表示（visible: false）で作成しておく（起動速度高速化のためキャッシュ化）
                let speed_order_builder = tauri::webview::WebviewWindowBuilder::new(
                    &app_handle,
                    "speed_order",
                    tauri::WebviewUrl::App("index.html?window=speed_order".into()),
                )
                .title("Speed Order")
                .inner_size(320.0, 438.0)
                .resizable(false)
                .always_on_top(true)
                .visible(false);

                let _ = speed_order_builder.build()?;

                // 口座・ポジション管理画面を初期起動時にあらかじめ非表示で作成しておく（起動速度高速化・チラつき防止）
                let positions_builder = tauri::webview::WebviewWindowBuilder::new(
                    &app_handle,
                    "positions",
                    tauri::WebviewUrl::App("index.html?window=positions".into()),
                )
                .title("口座・ポジション管理")
                .inner_size(760.0, 520.0)
                .min_inner_size(560.0, 380.0)
                .resizable(true)
                .always_on_top(true)
                .visible(false);

                let _ = positions_builder.build()?;

                // 環境設定画面を初期起動時にあらかじめ非表示で作成しておく（起動速度高速化・チラつき防止）
                let settings_builder = tauri::webview::WebviewWindowBuilder::new(
                    &app_handle,
                    "settings",
                    tauri::WebviewUrl::App("index.html?window=settings".into()),
                )
                .title("環境設定 - TickReplay")
                .inner_size(640.0, 540.0)
                .min_inner_size(560.0, 460.0)
                .resizable(true)
                .always_on_top(true)
                .visible(false);

                let _ = settings_builder.build()?;

                // シンボル選択セレクター画面を初期起動時にあらかじめ非表示で作成しておく
                let symbol_selector_builder = tauri::webview::WebviewWindowBuilder::new(
                    &app_handle,
                    "symbol_selector",
                    tauri::WebviewUrl::App("index.html?window=symbol_selector".into()),
                )
                .title("シンボル選択セレクター - TickReplay")
                .inner_size(840.0, 580.0)
                .min_inner_size(700.0, 450.0)
                .resizable(true)
                .always_on_top(true)
                .visible(false);

                let _ = symbol_selector_builder.build()?;
            }
            
            Ok(())
        })

        .invoke_handler(tauri::generate_handler![
            commands::send_command,
            commands::get_mt5_terminals,
            commands::save_terminal_name,
            commands::select_terminal,
            commands::get_profiles,
            commands::get_terminal_max_bars,
            commands::select_profile,
            commands::set_shortcuts_active,
            commands::set_always_on_top,
            commands::set_remote_mode,
            commands::set_main_window_mode,
            commands::get_last_status,
            commands::open_controller_window,
            commands::show_setup_window,
            commands::open_speed_order_window,
            commands::open_positions_window,
            commands::open_settings_window,
            commands::close_settings_window,
            commands::open_symbol_selector_window,
            commands::close_symbol_selector_window,
            commands::hide_window,
            commands::open_tracely_app,
            commands::open_trade_analysis_window,
            commands::read_trade_ticks,
            commands::save_settings,
            commands::load_settings,
            commands::sync_presets,
            commands::save_session,
            commands::get_saved_sessions,
            commands::delete_session,
            commands::clear_all_sessions,
            commands::scan_custom_symbol_files,
            commands::import_custom_symbol_chunk,
            commands::get_available_symbols,
            commands::select_folder,
            commands::exit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
