use std::fs;
use std::path::{Path, PathBuf};
use crate::error::AppError;

const EA_SOURCE: &str = include_str!("../../MQL5/TickReplayControllerEA.mq5");

// 指定されたパスがMT5の端末データディレクトリ配下であるかを検証する
pub fn validate_terminal_path(terminal_path: &str) -> Result<(), AppError> {
    let base_path = std::env::var("APPDATA")
        .map(PathBuf::from)
        .map(|p| p.join("MetaQuotes").join("Terminal"))
        .map_err(|_| AppError::Config("APPDATA環境変数の取得に失敗しました".to_string()))?;

    if !base_path.exists() {
        return Err(AppError::Config("MT5データフォルダが存在しません".to_string()));
    }

    let target = Path::new(terminal_path);
    if !target.exists() {
        return Err(AppError::Config("指定されたMT5パスが存在しません".to_string()));
    }

    let canonical_base = base_path.canonicalize()
        .map_err(|e| AppError::Config(format!("MT5データフォルダの参照に失敗しました: {}", e)))?;
    let canonical_target = target.canonicalize()
        .map_err(|e| AppError::Config(format!("指定されたMT5パスの参照に失敗しました: {}", e)))?;

    if canonical_target.starts_with(&canonical_base) {
        Ok(())
    } else {
        Err(AppError::Config("不正なMT5パスが指定されました".to_string()))
    }
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct Mt5TerminalInfo {
    pub name: String,
    pub path: String,
}

// MT5データフォルダをスキャンし、EAファイルを自動配置する (起動時初期化用の同期処理)
pub fn setup_mt5_environment() {
    let base_path = if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("MetaQuotes").join("Terminal")
    } else {
        return;
    };

    if !base_path.exists() {
        return;
    }

    if let Ok(entries) = fs::read_dir(base_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let mql5_path = path.join("MQL5");
                if mql5_path.exists() {
                    let experts_path = mql5_path.join("Experts");
                    let files_path = mql5_path.join("Files");

                    let _ = fs::create_dir_all(&experts_path);
                    let _ = fs::create_dir_all(&files_path);

                    let ea_file = experts_path.join("TickReplayControllerEA.mq5");
                    if let Err(e) = fs::write(&ea_file, EA_SOURCE) {
                        eprintln!("EA配置失敗 {:?}: {}", ea_file, e);
                    } else {
                        println!("EA配置成功 {:?}", ea_file);
                    }
                }
            }
        }
    }
}

// インストール済みのMT5端末を検出する (非同期I/O)
pub async fn get_mt5_terminals() -> Result<Vec<Mt5TerminalInfo>, AppError> {
    tokio::task::spawn_blocking(|| {
        let base_path = std::env::var("APPDATA")
            .map(PathBuf::from)
            .map(|p| p.join("MetaQuotes").join("Terminal"))
            .map_err(|_| AppError::Config("APPDATA環境変数の取得に失敗しました".to_string()))?;

        if !base_path.exists() {
            return Ok(Vec::new());
        }

        let mut terminals = Vec::new();
        let entries = fs::read_dir(base_path)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let mql5_path = path.join("MQL5");
                if mql5_path.exists() {
                    let name = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string();
                    terminals.push(Mt5TerminalInfo {
                        name,
                        path: path.to_string_lossy().to_string(),
                    });
                }
            }
        }
        Ok(terminals)
    })
    .await
    .map_err(|e| AppError::Mt5(format!("MT5検出スレッドエラー: {}", e)))?
}

// 指定ターミナルのチャートプロファイル一覧を取得する (非同期I/O)
pub async fn get_profiles(terminal_path: String) -> Result<Vec<String>, AppError> {
    validate_terminal_path(&terminal_path)?;
    tokio::task::spawn_blocking(move || {
        let charts_path = Path::new(&terminal_path).join("MQL5").join("Profiles").join("Charts");
        if !charts_path.exists() {
            return Ok(Vec::new());
        }

        let mut profiles = Vec::new();
        let entries = fs::read_dir(charts_path)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    profiles.push(name.to_string());
                }
            }
        }
        Ok(profiles)
    })
    .await
    .map_err(|e| AppError::Mt5(format!("プロファイル検出スレッドエラー: {}", e)))?
}

// チャートプロファイルをコピーして適用する (非同期I/O)
pub async fn select_profile(terminal_path: String, profile_name: String) -> Result<(), AppError> {
    validate_terminal_path(&terminal_path)?;
    let profile_name_clean = Path::new(&profile_name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::InvalidProfile("無効なプロファイル名です".to_string()))?
        .to_string();

    tokio::task::spawn_blocking(move || {
        let path = Path::new(&terminal_path);
        let src_dir = path.join("MQL5").join("Profiles").join("Charts").join(&profile_name_clean);
        let dest_dir = path.join("MQL5").join("Files").join(&profile_name_clean);

        if !src_dir.exists() {
            return Err(AppError::InvalidProfile(format!("プロファイルフォルダが存在しません: {:?}", src_dir)));
        }

        fs::create_dir_all(&dest_dir)?;

        let entries = fs::read_dir(src_dir)?;
        for entry in entries.flatten() {
            let file_path = entry.path();
            if file_path.is_file() {
                if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("chr") {
                        if let Some(name) = file_path.file_name() {
                            let dest_file = dest_dir.join(name);
                            fs::copy(&file_path, &dest_file)?;
                        }
                    }
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Mt5(format!("プロファイル複製スレッドエラー: {}", e)))?
}
