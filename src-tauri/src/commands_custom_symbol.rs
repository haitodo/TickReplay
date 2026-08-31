use std::sync::Arc;
use tauri::{AppHandle, State, Manager};
use crate::error::AppError;
use crate::state::ReplayState;

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

pub fn validate_import_symbol_and_ym(symbol_name: &str, year_month: &str) -> Result<(), AppError> {
    if symbol_name.is_empty()
        || !symbol_name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '.' || c == '-')
        || symbol_name.contains("..")
    {
        return Err(AppError::Config(format!("不正なシンボル名です: {}", symbol_name)));
    }

    let ym_parts: Vec<&str> = year_month.split('-').collect();
    if ym_parts.len() != 2
        || ym_parts[0].len() != 4
        || ym_parts[1].len() != 2
        || ym_parts[0].parse::<i32>().is_err()
        || ym_parts[1].parse::<u32>().map(|m| !(1..=12).contains(&m)).unwrap_or(true)
    {
        return Err(AppError::Config(format!("不正な年月フォーマットです (YYYY-MM): {}", year_month)));
    }

    Ok(())
}

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
    validate_import_symbol_and_ym(&symbol_name, &year_month)?;

    {
        let last_status = state.last_status.lock().unwrap();
        if last_status.is_empty() {
            return Err(AppError::Config(
                "MetaTrader 5 (EA) が接続されていません。MT5を起動し、EAをセットアップした状態でインポートを行ってください。".to_string()
            ));
        }
    }

    let zip_p = std::path::PathBuf::from(&zip_path);
    if !zip_p.exists() {
        return Err(AppError::Config(format!("ZIPファイルが存在しません: {}", zip_path)));
    }

    let files_dir = std::path::Path::new(&terminal_path).join("MQL5").join("Files");
    let relative_bin = format!("TickReplay/Imports/{}_{}.bin", symbol_name, year_month);
    let output_bin = files_dir.join(&relative_bin);

    let tick_count = tokio::task::spawn_blocking(move || {
        crate::custom_symbol::convert_zip_to_mql_bin(&zip_p, &output_bin)
    })
    .await
    .map_err(|e| AppError::Config(format!("データ変換スレッドエラー: {}", e)))??;

    let cmd = serde_json::json!({
        "command": "IMPORT_TICKS",
        "symbol": symbol_name,
        "group": if group_path.is_empty() { "Custom" } else { &group_path },
        "base_symbol": if base_symbol.is_empty() { &symbol_name } else { &base_symbol },
        "bin_file": relative_bin,
        "year_month": year_month,
    }).to_string();

    state.command_tx.send(cmd).map_err(|_| {
        AppError::Config("EAへのインポートコマンド送信に失敗しました（IPCチャネルが切断されています）".to_string())
    })?;

    let config_dir = app_handle.path().app_config_dir()?;
    let mut manifest = crate::custom_symbol::ImportManifest::load_from_dir(&config_dir);
    manifest.mark_imported(&symbol_name, &year_month);
    manifest.save_to_dir(&config_dir)?;

    Ok(tick_count)
}

#[tauri::command]
pub async fn select_folder() -> Result<Option<String>, AppError> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("OANDA ZIP データ保存先フォルダを選択")
        .pick_folder()
        .await;

    Ok(folder.map(|f| f.path().to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_import_symbol_and_ym() {
        assert!(validate_import_symbol_and_ym("USDJPY_DMM", "2026-08").is_ok());
        assert!(validate_import_symbol_and_ym("EURUSD.raw", "2024-01").is_ok());
        assert!(validate_import_symbol_and_ym("", "2026-08").is_err());
        assert!(validate_import_symbol_and_ym("../evil_symbol", "2026-08").is_err());
        assert!(validate_import_symbol_and_ym("USDJPY", "2026-13").is_err());
        assert!(validate_import_symbol_and_ym("USDJPY", "2026-00").is_err());
        assert!(validate_import_symbol_and_ym("USDJPY", "invalid-ym").is_err());
    }
}
