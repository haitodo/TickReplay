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

use std::sync::Arc;
use tauri::{Manager, Emitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 起動時の初期化処理（MT5データフォルダへのEAファイルの自動配置）
    mt5::setup_mt5_environment();

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let state = Arc::new(state::ReplayState::new(tx));
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
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "speed_order" {
                        // 完全に破棄せず非表示にすることで、次回起動を瞬時に行う
                        api.prevent_close();
                        let _ = window.hide();
                        let _ = window.emit("window-visible", false);
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    if window.label() == "main" {
                        // メインウィンドウが終了した際、スピード発注画面および分析画面も自動で閉じる
                        if let Some(speed_order) = window.app_handle().get_webview_window("speed_order") {
                            let _ = speed_order.close();
                        }
                        if let Some(trade_analysis) = window.app_handle().get_webview_window("trade_analysis") {
                            let _ = trade_analysis.close();
                        }
                    }
                }
                _ => {}
            }
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let state = app.state::<Arc<state::ReplayState>>();
            let state_inner = state.inner().clone();
            
            // Named Pipe のコマンド送信タスクを起動
            tauri::async_runtime::spawn(ipc::run_command_pipe_server(rx, state_inner.clone()));
            
            // Named Pipe のステータス受信タスクを起動
            tauri::async_runtime::spawn(ipc::run_status_pipe_server(app_handle.clone(), state_inner));
            
            // 高DPIや異なる拡大率（150%など）のディスプレイ環境下で初回起動した際、
            // ウィンドウサイズが適切にスケーリングされない不具合を回避するため、
            // 非表示状態のウィンドウに対して明示的に論理サイズ (LogicalSize) を設定し、
            // 画面中央に配置したのち表示（show）する。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 600.0,
                    height: 660.0,
                }));
                let _ = window.center();
                let _ = window.show();

                // スピード発注画面を初期起動時にあらかじめ非表示（visible: false）で作成しておく（起動速度高速化のためキャッシュ化）
                let mut speed_order_builder = tauri::webview::WebviewWindowBuilder::new(
                    &app_handle,
                    "speed_order",
                    tauri::WebviewUrl::App("index.html?window=speed_order".into()),
                )
                .title("Speed Order")
                .inner_size(320.0, 438.0)
                .resizable(false)
                .always_on_top(true)
                .visible(false);

                speed_order_builder = speed_order_builder.parent(&window)?;
                let _ = speed_order_builder.build()?;
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::send_command,
            commands::get_mt5_terminals,
            commands::select_terminal,
            commands::get_profiles,
            commands::get_terminal_max_bars,
            commands::select_profile,
            commands::set_shortcuts_active,
            commands::set_always_on_top,
            commands::set_remote_mode,
            commands::get_last_status,
            commands::open_speed_order_window,
            commands::open_trade_analysis_window,
            commands::read_trade_ticks,
            commands::save_settings,
            commands::load_settings,
            commands::sync_presets,
            commands::read_replay_news,
            commands::save_session,
            commands::get_saved_sessions,
            commands::delete_session,
            commands::clear_all_sessions,
            commands::scan_custom_symbol_files,
            commands::import_custom_symbol_chunk,
            commands::get_available_symbols,
            commands::select_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
