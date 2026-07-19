use std::sync::Arc;
use tauri::{AppHandle, State, Manager, Emitter};
use crate::error::AppError;
use crate::state::{ReplayState, ReplaySettings};

#[tauri::command]
pub async fn send_command(
    command_json: String,
    app_handle: AppHandle,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    // フロントエンドからの直接制御時のローカル状態キャッシング
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&command_json) {
        if let Some(command) = val.get("command").and_then(|c| c.as_str()) {
            if command == "CONTROL" {
                let mut p = state.playback.lock().unwrap();
                if let Some(playing) = val.get("is_playing").and_then(|p| p.as_bool()) {
                    p.is_playing = playing;
                }
                if let Some(mode) = val.get("speed_mode").and_then(|m| m.as_str()) {
                    p.speed_mode = mode.to_string();
                }
                if let Some(mult) = val.get("multiplier").and_then(|m| m.as_f64()) {
                    p.multiplier = mult;
                }
                if let Some(step) = val.get("tick_step").and_then(|t| t.as_i64()) {
                    p.tick_step = step as i32;
                }
            } else if command == "TERMINATE" {
                // TERMINATEコマンド受信時、スピード発注ウィンドウが存在すれば閉じる
                if let Some(speed_order) = app_handle.get_webview_window("speed_order") {
                    let _ = speed_order.close();
                }
            }
        }
    }

    state.command_tx.send(command_json).map_err(|e| AppError::Config(e.to_string()))
}

#[tauri::command]
pub async fn get_mt5_terminals() -> Result<Vec<crate::mt5::Mt5TerminalInfo>, AppError> {
    crate::mt5::get_mt5_terminals().await
}

#[tauri::command]
pub async fn select_terminal(
    terminal_path: String,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    crate::mt5::validate_terminal_path(&terminal_path)?;
    let files_path = std::path::Path::new(&terminal_path).join("MQL5").join("Files");
    if !files_path.exists() {
        tokio::fs::create_dir_all(&files_path).await?;
    }
    
    {
        let mut guard = state.files_path.lock().unwrap();
        *guard = Some(files_path.clone());
    }
    
    println!("MT5 Filesパスを設定: {:?}", files_path);
    Ok(())
}

#[tauri::command]
pub async fn get_profiles(terminal_path: String) -> Result<Vec<String>, AppError> {
    crate::mt5::get_profiles(terminal_path).await
}

#[tauri::command]
pub async fn select_profile(terminal_path: String, profile_name: String) -> Result<(), AppError> {
    crate::mt5::select_profile(terminal_path, profile_name).await
}

#[tauri::command]
pub async fn set_shortcuts_active(
    active: bool,
    hotkeys: std::collections::HashMap<String, String>,
    app_handle: AppHandle,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let shortcut_manager = app_handle.global_shortcut();

    // 1. すでに登録されている現在のショートカットキーをすべて解除する
    {
        let current_hotkeys = {
            let s = state.settings.read().unwrap();
            s.hotkeys.clone()
        };
        for key in current_hotkeys.values() {
            if key.trim().is_empty() {
                continue;
            }
            if let Ok(shortcut) = key.parse::<Shortcut>() {
                let _ = shortcut_manager.unregister(shortcut);
            }
        }
    }

    // 2. 新しいホットキーマップを状態に保存する
    {
        let mut s = state.settings.write().unwrap();
        s.hotkeys = hotkeys.clone();
    }

    // 3. アクティブな場合にのみ、新しく指定されたショートカットキーを登録する
    if active {
        for key in hotkeys.values() {
            if key.trim().is_empty() {
                continue;
            }
            if let Ok(shortcut) = key.parse::<Shortcut>() {
                let _ = shortcut_manager.unregister(shortcut.clone()); // 重複登録エラーの防止
                if let Err(e) = shortcut_manager.register(shortcut) {
                    eprintln!("Failed to register global shortcut {}: {}", key, e);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_always_on_top(always: bool, window: tauri::Window) -> Result<(), AppError> {
    window.set_always_on_top(always)?;
    Ok(())
}

#[tauri::command]
pub fn set_remote_mode(is_remote: bool, always_on_top: bool, window: tauri::Window) -> Result<(), AppError> {
    if is_remote {
        // リモコンモード：枠線を非表示、サイズ変更を無効、最前面に設定し、サイズを設定
        window.set_decorations(false)?;
        window.set_resizable(false)?;
        window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 950.0,
            height: 48.0,
        }))?;
        window.set_always_on_top(true)?;

        // 画面下部中央（タスクバーの上）に吸着配置する
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
        // 通常モード：枠線を表示、サイズ変更を有効、元のサイズに戻し、画面中央に配置
        window.set_decorations(true)?;
        window.set_resizable(true)?;
        window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 740.0,
            height: 660.0,
        }))?;
        window.center()?;
        // 最前面表示設定を復元する
        window.set_always_on_top(always_on_top)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_speed_order_window(app_handle: AppHandle) -> Result<(), AppError> {
    if let Some(window) = app_handle.get_webview_window("speed_order") {
        // メイン画面（親ウィンドウ）の中央に表示位置を設定する
        if let Some(main_win) = app_handle.get_webview_window("main") {
            if let (Ok(main_pos), Ok(main_size)) = (main_win.outer_position(), main_win.outer_size()) {
                let scale_factor = main_win.scale_factor().unwrap_or(1.0);
                let speed_w_phys = (320.0 * scale_factor) as i32;
                let speed_h_phys = (480.0 * scale_factor) as i32;

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

        // 高DPI環境等でのサイズ再適用
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 320.0,
            height: 480.0,
        }));

        window.show()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
        window.set_always_on_top(true)?;
    } else {
        // 万が一、ウィンドウが存在しない場合は、新規に作成する
        let mut win_builder = tauri::webview::WebviewWindowBuilder::new(
            &app_handle,
            "speed_order",
            tauri::WebviewUrl::App("index.html?window=speed_order".into()),
        )
        .title("Speed Order")
        .inner_size(320.0, 480.0)
        .resizable(false)
        .always_on_top(true)
        .visible(false);

        if let Some(main_win) = app_handle.get_webview_window("main") {
            win_builder = win_builder.parent(&main_win)?;
        }

        let window = win_builder.build()?;

        if let Some(main_win) = app_handle.get_webview_window("main") {
            if let (Ok(main_pos), Ok(main_size)) = (main_win.outer_position(), main_win.outer_size()) {
                let scale_factor = main_win.scale_factor().unwrap_or(1.0);
                let speed_w_phys = (320.0 * scale_factor) as i32;
                let speed_h_phys = (480.0 * scale_factor) as i32;

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
            width: 320.0,
            height: 480.0,
        }))?;

        window.show()?;
        let _ = window.emit("window-visible", true);
    }
    Ok(())
}

#[tauri::command]
pub async fn open_trade_analysis_window(app_handle: AppHandle) -> Result<(), AppError> {
    if let Some(window) = app_handle.get_webview_window("trade_analysis") {
        if let Some(main_win) = app_handle.get_webview_window("main") {
            if let (Ok(main_pos), Ok(main_size)) = (main_win.outer_position(), main_win.outer_size()) {
                let scale_factor = main_win.scale_factor().unwrap_or(1.0);
                let w_phys = (1200.0 * scale_factor) as i32;
                let h_phys = (800.0 * scale_factor) as i32;

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
            width: 1200.0,
            height: 800.0,
        }));

        window.show()?;
        window.maximize()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;
    } else {
        let mut win_builder = tauri::webview::WebviewWindowBuilder::new(
            &app_handle,
            "trade_analysis",
            tauri::WebviewUrl::App("index.html?window=trade_analysis".into()),
        )
        .title("Trade Analysis")
        .inner_size(1200.0, 800.0)
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
                let w_phys = (1200.0 * scale_factor) as i32;
                let h_phys = (800.0 * scale_factor) as i32;

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
        window.maximize()?;
        let _ = window.emit("window-visible", true);
        window.set_focus()?;

        #[cfg(debug_assertions)]
        window.open_devtools();
    }
    Ok(())
}

#[tauri::command]
pub async fn read_trade_ticks(app_handle: AppHandle, ticket: i32) -> Result<String, AppError> {
    let state = app_handle.state::<Arc<ReplayState>>();
    let files_path = {
        let path_guard = state.files_path.lock().unwrap();
        path_guard.clone()
    };

    let Some(files_path) = files_path else {
        return Err(AppError::Config("MT5 Files path not configured".to_string()));
    };
    
    let ticks_file = files_path.join(format!("trade_ticks_{}.json", ticket));
    if !ticks_file.exists() {
        return Ok("[]".to_string());
    }
    
    let bytes = tokio::fs::read(&ticks_file).await?;
    let content = String::from_utf8_lossy(&bytes).into_owned();
    
    // 読み取り完了後にファイルを自動削除
    let _ = tokio::fs::remove_file(ticks_file).await;
    
    Ok(content)
}

#[tauri::command]
pub async fn get_last_status(state: State<'_, Arc<ReplayState>>) -> Result<String, AppError> {
    let last = state.last_status.lock().unwrap();
    Ok(last.clone())
}

/// リプレイ設定を指定された設定ファイル（settings.json）に保存します。
#[tauri::command]
pub async fn save_settings(
    app_handle: AppHandle,
    settings: ReplaySettings,
) -> Result<(), AppError> {
    let config_dir = app_handle.path().app_config_dir()?;
    if !config_dir.exists() {
        tokio::fs::create_dir_all(&config_dir).await?;
    }
    let config_file = config_dir.join("settings.json");
    let json_str = serde_json::to_string_pretty(&settings)?;
    tokio::fs::write(config_file, json_str).await?;
    Ok(())
}

/// 保存されているリプレイ設定を読み込みます。設定ファイルが存在しない場合は None を返します。
#[tauri::command]
pub async fn load_settings(
    app_handle: AppHandle,
) -> Result<Option<ReplaySettings>, AppError> {
    let config_dir = app_handle.path().app_config_dir()?;
    let config_file = config_dir.join("settings.json");
    if !config_file.exists() {
        return Ok(None);
    }
    let json_str = tokio::fs::read_to_string(config_file).await?;
    let settings = serde_json::from_str::<ReplaySettings>(&json_str)?;
    Ok(Some(settings))
}

/// エクスポートされた経済指標データを読み込みます。
#[tauri::command]
pub async fn read_replay_news(
    state: State<'_, Arc<ReplayState>>,
) -> Result<String, AppError> {
    crate::ipc::read_replay_news(&state).await
}

#[tauri::command]
pub async fn sync_presets(
    time_presets: Vec<f64>,
    tick_presets: Vec<i32>,
    state: State<'_, Arc<ReplayState>>,
) -> Result<(), AppError> {
    {
        let mut s = state.settings.write().unwrap();
        s.time_presets = time_presets;
        s.time_presets.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        s.tick_presets = tick_presets;
        s.tick_presets.sort();
    }
    Ok(())
}

fn validate_session_id(session_id: &str) -> Result<(), AppError> {
    if session_id.is_empty() || !session_id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::Config("無効なセッションIDです".to_string()));
    }
    Ok(())
}

/// セッションを指定されたファイル（sessions/{session_id}.json）に保存します。
#[tauri::command]
pub async fn save_session(
    app_handle: AppHandle,
    session_id: String,
    session_data: serde_json::Value,
) -> Result<(), AppError> {
    validate_session_id(&session_id)?;
    let config_dir = app_handle.path().app_config_dir()?;
    let sessions_dir = config_dir.join("sessions");
    if !sessions_dir.exists() {
        tokio::fs::create_dir_all(&sessions_dir).await?;
    }
    let session_file = sessions_dir.join(format!("{}.json", session_id));
    let json_str = serde_json::to_string_pretty(&session_data)?;
    tokio::fs::write(session_file, json_str).await?;
    Ok(())
}

/// 保存されているセッション一覧を読み込みます。
#[tauri::command]
pub async fn get_saved_sessions(
    app_handle: AppHandle,
) -> Result<Vec<serde_json::Value>, AppError> {
    let config_dir = app_handle.path().app_config_dir()?;
    let sessions_dir = config_dir.join("sessions");
    if !sessions_dir.exists() {
        return Ok(vec![]);
    }
    
    let mut sessions = Vec::new();
    let mut dir_entries = tokio::fs::read_dir(sessions_dir).await?;
    while let Some(entry) = dir_entries.next_entry().await? {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(json_str) = tokio::fs::read_to_string(&path).await {
                if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    sessions.push(json_val);
                }
            }
        }
    }
    
    // 保存された日時 (saved_at) の降順にソートします
    sessions.sort_by(|a, b| {
        let a_time = a.get("saved_at").and_then(|v| v.as_str()).unwrap_or("");
        let b_time = b.get("saved_at").and_then(|v| v.as_str()).unwrap_or("");
        b_time.cmp(a_time)
    });
    
    Ok(sessions)
}

/// 指定されたセッションを削除します。
#[tauri::command]
pub async fn delete_session(
    app_handle: AppHandle,
    session_id: String,
) -> Result<(), AppError> {
    validate_session_id(&session_id)?;
    let config_dir = app_handle.path().app_config_dir()?;
    let session_file = config_dir.join("sessions").join(format!("{}.json", session_id));
    if session_file.exists() {
        tokio::fs::remove_file(session_file).await?;
    }
    Ok(())
}

/// 保存されているすべてのセッションファイルを削除します。
#[tauri::command]
pub async fn clear_all_sessions(app_handle: AppHandle) -> Result<(), AppError> {
    let config_dir = app_handle.path().app_config_dir()?;
    let sessions_dir = config_dir.join("sessions");
    if sessions_dir.exists() {
        let mut dir_entries = tokio::fs::read_dir(sessions_dir).await?;
        while let Some(entry) = dir_entries.next_entry().await? {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                tokio::fs::remove_file(path).await?;
            }
        }
    }
    Ok(())
}

/// 指定されたディレクトリ内の OANDA ZIP ファイルを走査します。
#[tauri::command]
pub async fn scan_custom_symbol_files(
    root_dir: String,
    terminal_path: String,
    app_handle: AppHandle,
) -> Result<Vec<crate::custom_symbol::ScannedPairGroup>, AppError> {
    let config_dir = app_handle.path().app_config_dir()?;
    let root = std::path::PathBuf::from(&root_dir);
    if !root.exists() {
        return Err(AppError::Config("指定されたフォルダが存在しません".to_string()));
    }
    
    let existing_symbols = if !terminal_path.is_empty() {
        crate::mt5::get_existing_custom_symbols(&terminal_path).await.unwrap_or_default()
    } else {
        Vec::new()
    };

    tokio::task::spawn_blocking(move || {
        crate::custom_symbol::scan_directory_for_ticks(&root, &config_dir, &existing_symbols)
    })
    .await
    .map_err(|e| AppError::Config(format!("フォルダスキャンエラー: {}", e)))?
}

/// 1ヶ月分のZIPファイルをパースし、MT5 Files ディレクトリに .bin ファイルとして書き出します。
#[tauri::command]
pub async fn import_custom_symbol_chunk(
    symbol_name: String,
    group_path: String,
    base_symbol: String,
    zip_path: String,
    year_month: String,
    terminal_path: String,
    state: State<'_, Arc<ReplayState>>,
    app_handle: AppHandle,
) -> Result<usize, AppError> {
    if terminal_path.is_empty() {
        return Err(AppError::Config("MT5ターミナルが選択されていません".to_string()));
    }
    crate::mt5::validate_terminal_path(&terminal_path)?;

    let zip_p = std::path::PathBuf::from(&zip_path);
    if !zip_p.exists() {
        return Err(AppError::Config(format!("ZIPファイルが存在しません: {}", zip_path)));
    }

    let files_dir = std::path::Path::new(&terminal_path).join("MQL5").join("Files");
    let relative_bin = format!("TickReplay/Imports/{}_{}.bin", symbol_name, year_month);
    let output_bin = files_dir.join(&relative_bin);

    // 1. ZIPから.binへ高速パース＆書き出し
    let tick_count = tokio::task::spawn_blocking(move || {
        crate::custom_symbol::convert_zip_to_mql_bin(&zip_p, &output_bin)
    })
    .await
    .map_err(|e| AppError::Config(format!("データ変換スレッドエラー: {}", e)))??;

    // 2. EAが接続中の場合は IPC で即時インポートコマンドを送信
    let cmd = serde_json::json!({
        "command": "IMPORT_TICKS",
        "symbol": symbol_name,
        "group": if group_path.is_empty() { "Custom" } else { &group_path },
        "base_symbol": if base_symbol.is_empty() { &symbol_name } else { &base_symbol },
        "bin_file": relative_bin,
        "year_month": year_month,
    }).to_string();

    let _ = state.command_tx.send(cmd);

    // 3. マニフェストに記録
    let config_dir = app_handle.path().app_config_dir()?;
    let mut manifest = crate::custom_symbol::ImportManifest::load_from_dir(&config_dir);
    manifest.mark_imported(&symbol_name, &year_month);
    manifest.save_to_dir(&config_dir)?;

    Ok(tick_count)
}

/// 使用可能なシンボル一覧（詳細情報付き）を取得します。
#[tauri::command]
pub async fn get_available_symbols(
    terminal_path: String,
    app_handle: AppHandle,
) -> Result<Vec<crate::mt5::SymbolItem>, AppError> {
    let mut items_set = std::collections::HashSet::new();

    if !terminal_path.is_empty() {
        if let Ok(mt5_items) = crate::mt5::get_existing_symbols_with_info(&terminal_path).await {
            for item in mt5_items {
                items_set.insert(item);
            }
        }
    } else {
        if let Ok(config_dir) = app_handle.path().app_config_dir() {
            let manifest = crate::custom_symbol::ImportManifest::load_from_dir(&config_dir);
            for cs in manifest.custom_symbols {
                items_set.insert(crate::mt5::SymbolItem {
                    name: cs,
                    source_type: "custom".to_string(),
                    group_name: "Custom".to_string(),
                });
            }
        }
    }

    // ターミナルやカスタムシンボルから何も検出されなかった場合のみフォールバック初期値を補完
    if items_set.is_empty() {
        let defaults = vec![
            "USDJPY", "EURUSD", "GBPJPY", "EURJPY", "AUDUSD", "USDCAD",
            "USDCHF", "NZDUSD", "EURGBP", "GBPAUD", "AUDJPY", "CHFJPY",
            "CADJPY", "NZDJPY", "EURAUD", "GOLD", "XAUUSD"
        ];
        for d in defaults {
            items_set.insert(crate::mt5::SymbolItem {
                name: d.to_string(),
                source_type: "default".to_string(),
                group_name: "Default".to_string(),
            });
        }
    }

    let mut result: Vec<crate::mt5::SymbolItem> = items_set.into_iter().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

/// ネイティブの OS フォルダ選択ダイアログを開き、選択されたフォルダパスを返します。
#[tauri::command]
pub async fn select_folder() -> Result<Option<String>, AppError> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("OANDA ZIP データ保存先フォルダを選択")
        .pick_folder()
        .await;

    Ok(folder.map(|f| f.path().to_string_lossy().to_string()))
}

