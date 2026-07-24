use std::sync::Arc;
use tauri::{AppHandle, State, Manager};
use crate::error::AppError;
use crate::state::ReplayState;

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
