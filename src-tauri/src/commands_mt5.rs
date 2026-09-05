use std::sync::Arc;
use tauri::{AppHandle, State, Manager};
use crate::error::AppError;
use crate::state::ReplayState;

#[tauri::command]
pub async fn get_mt5_terminals(
    app_handle: AppHandle,
) -> Result<Vec<crate::mt5::Mt5TerminalInfo>, AppError> {
    let terminal_names = if let Ok(config_dir) = app_handle.path().app_config_dir() {
        let config_file = config_dir.join("settings.json");
        if config_file.exists() {
            if let Ok(json_str) = tokio::fs::read_to_string(&config_file).await {
                serde_json::from_str::<crate::state::ReplaySettings>(&json_str)
                    .ok()
                    .and_then(|s| s.terminal_names)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    crate::mt5::get_mt5_terminals(terminal_names).await
}

#[tauri::command]
pub async fn save_terminal_name(
    app_handle: AppHandle,
    terminal_path: String,
    custom_name: String,
) -> Result<(), AppError> {
    let config_dir = app_handle.path().app_config_dir()?;
    if !config_dir.exists() {
        tokio::fs::create_dir_all(&config_dir).await?;
    }
    let config_file = config_dir.join("settings.json");
    let settings = if config_file.exists() {
        let json_str = tokio::fs::read_to_string(&config_file).await?;
        serde_json::from_str::<crate::state::ReplaySettings>(&json_str).ok()
    } else {
        None
    };

    let id = std::path::Path::new(&terminal_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&terminal_path)
        .to_string();

    let mut s = settings.unwrap_or_else(|| crate::state::ReplaySettings {
        selected_terminal: terminal_path.clone(),
        auto_scroll_sync: true,
        ..Default::default()
    });

    let mut map = s.terminal_names.clone().unwrap_or_default();
    if custom_name.trim().is_empty() {
        map.remove(&id);
        map.remove(&terminal_path);
    } else {
        map.insert(id.clone(), custom_name.trim().to_string());
        map.insert(terminal_path.clone(), custom_name.trim().to_string());
    }
    s.terminal_names = Some(map);

    let json_str = serde_json::to_string_pretty(&s)?;
    tokio::fs::write(&config_file, json_str).await?;

    Ok(())
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
pub async fn get_terminal_max_bars(terminal_path: String) -> Result<crate::mt5::MaxBarsInfo, AppError> {
    crate::mt5::get_terminal_max_bars(terminal_path).await
}

#[tauri::command]
pub async fn select_profile(terminal_path: String, profile_name: String) -> Result<(), AppError> {
    crate::mt5::select_profile(terminal_path, profile_name).await
}

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
