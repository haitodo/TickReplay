use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use crate::error::AppError;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, Hash)]
pub struct SymbolItem {
    pub name: String,
    pub source_type: String, // "custom" | "broker" | "default"
    pub group_name: String,  // 例: "Custom", "OANDA-Japan MT5 Live", "Default"
}

const EA_SOURCE: &str = include_str!("../../MQL5/TickReplayControllerEA.mq5");
const IMPORTER_SOURCE: &str = include_str!("../../MQL5/TickReplayImporter.mq5");

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

// MT5データフォルダをスキャンし、EAおよびスクリプトファイルを自動配置する (起動時初期化用の同期処理)
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
                    let scripts_path = mql5_path.join("Scripts");
                    let files_path = mql5_path.join("Files");

                    let _ = fs::create_dir_all(&experts_path);
                    let _ = fs::create_dir_all(&scripts_path);
                    let _ = fs::create_dir_all(&files_path);

                    let ea_file = experts_path.join("TickReplayControllerEA.mq5");
                    if let Err(e) = fs::write(&ea_file, EA_SOURCE) {
                        eprintln!("EA配置失敗 {:?}: {}", ea_file, e);
                    }

                    let importer_file = scripts_path.join("TickReplayImporter.mq5");
                    if let Err(e) = fs::write(&importer_file, IMPORTER_SOURCE) {
                        eprintln!("Importer配置失敗 {:?}: {}", importer_file, e);
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

// 指定ターミナルから検出された既存のシンボル（標準＋カスタム）一覧を取得する
pub async fn get_existing_custom_symbols(terminal_path: &str) -> Result<Vec<String>, AppError> {
    let items = get_existing_symbols_with_info(terminal_path).await?;
    let mut names: Vec<String> = items.into_iter().map(|i| i.name).collect();
    names.dedup();
    Ok(names)
}

pub async fn get_existing_symbols_with_info(terminal_path: &str) -> Result<Vec<SymbolItem>, AppError> {
    validate_terminal_path(terminal_path)?;
    let path = PathBuf::from(terminal_path);
    tokio::task::spawn_blocking(move || {
        let mut symbol_items = std::collections::HashSet::new();

        fn is_valid_symbol_name(name: &str) -> bool {
            if name.is_empty() || name.len() > 64 {
                return false;
            }
            let lower = name.to_lowercase();
            let system_blacklist = [
                "cache", "logs", "chats", "mail", "users", "history", "ticks",
                "default", "custom", "bases", "mql5", "config", "profiles",
                "files", "charts", "indicators", "experts", "scripts", "images",
                "include", "libraries", "symbolsets", "news", "subscriptions",
                "symbols", "trades", "options", "books", "gvariables", "objects",
                "strategy", "alerts"
            ];
            if system_blacklist.contains(&lower.as_str()) || lower.starts_with("chart") {
                return false;
            }
            name.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '_' || c == '-' || c == '#' || c == '+' || c == '/' || c == '$' || c == '@')
        }

        fn scan_dir_items(
            parent_dir: &Path,
            source_type: &str,
            group_name: &str,
            items: &mut std::collections::HashSet<SymbolItem>
        ) {
            if let Ok(entries) = fs::read_dir(parent_dir) {
                for entry in entries.flatten() {
                    let cp = entry.path();
                    if cp.is_dir() {
                        if let Some(name) = cp.file_name().and_then(|n| n.to_str()) {
                            if is_valid_symbol_name(name) {
                                items.insert(SymbolItem {
                                    name: name.to_string(),
                                    source_type: source_type.to_string(),
                                    group_name: group_name.to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }

        let bases_dir = path.join("bases");
        if bases_dir.exists() {
            if let Ok(entries) = fs::read_dir(&bases_dir) {
                for entry in entries.flatten() {
                    let server_dir = entry.path();
                    if server_dir.is_dir() {
                        let server_name = server_dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        let lower_server = server_name.to_lowercase();
                        
                        if lower_server.is_empty() || lower_server == "cache" || lower_server == "logs" || lower_server.starts_with('.') {
                            continue;
                        }

                        if server_name.eq_ignore_ascii_case("Custom") {
                            scan_dir_items(&server_dir.join("history"), "custom", "Custom", &mut symbol_items);
                            scan_dir_items(&server_dir.join("ticks"), "custom", "Custom", &mut symbol_items);
                            
                            if let Ok(custom_entries) = fs::read_dir(&server_dir) {
                                for c_entry in custom_entries.flatten() {
                                    let cp = c_entry.path();
                                    if cp.is_dir() {
                                        if let Some(name) = cp.file_name().and_then(|n| n.to_str()) {
                                            if !name.eq_ignore_ascii_case("history") && !name.eq_ignore_ascii_case("ticks") {
                                                if is_valid_symbol_name(name) {
                                                    symbol_items.insert(SymbolItem {
                                                        name: name.to_string(),
                                                        source_type: "custom".to_string(),
                                                        group_name: "Custom".to_string(),
                                                    });
                                                }
                                                scan_dir_items(&cp, "custom", "Custom", &mut symbol_items);
                                                scan_dir_items(&cp.join("history"), "custom", "Custom", &mut symbol_items);
                                                scan_dir_items(&cp.join("ticks"), "custom", "Custom", &mut symbol_items);
                                            }
                                        }
                                    }
                                }
                            }
                        } else if server_name.eq_ignore_ascii_case("Default") {
                            scan_dir_items(&server_dir.join("history"), "default", "Default", &mut symbol_items);
                            scan_dir_items(&server_dir.join("History"), "default", "Default", &mut symbol_items);
                            scan_dir_items(&server_dir.join("ticks"), "default", "Default", &mut symbol_items);
                        } else {
                            scan_dir_items(&server_dir.join("history"), "broker", server_name, &mut symbol_items);
                            scan_dir_items(&server_dir.join("History"), "broker", server_name, &mut symbol_items);
                            scan_dir_items(&server_dir.join("ticks"), "broker", server_name, &mut symbol_items);
                        }
                    }
                }
            }
        }

        let charts_dir = path.join("MQL5").join("Profiles").join("Charts");
        if charts_dir.exists() {
            fn walk_charts(dir: &Path, items: &mut std::collections::HashSet<SymbolItem>) {
                if let Ok(entries) = fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let cp = entry.path();
                        if cp.is_dir() {
                            walk_charts(&cp, items);
                        } else if cp.is_file() && cp.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("chr")) == Some(true) {
                            if let Ok(content) = fs::read_to_string(&cp) {
                                for line in content.lines() {
                                    let trimmed = line.trim();
                                    if trimmed.to_lowercase().starts_with("symbol=") {
                                        let sym = trimmed[7..].trim();
                                        if is_valid_symbol_name(sym) {
                                            let is_custom = sym.to_uppercase().ends_with("_CUSTOM") || sym.to_uppercase().contains("REPLAY");
                                            items.insert(SymbolItem {
                                                name: sym.to_string(),
                                                source_type: if is_custom { "custom".to_string() } else { "broker".to_string() },
                                                group_name: if is_custom { "Custom".to_string() } else { "Charts".to_string() },
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            walk_charts(&charts_dir, &mut symbol_items);
        }

        let mut list: Vec<SymbolItem> = symbol_items.into_iter().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(list)
    })
    .await
    .map_err(|e| AppError::Mt5(format!("銘柄検出スレッドエラー: {}", e)))?
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct MaxBarsInfo {
    pub max_bars: u32,
    pub is_unlimited: bool,
    pub raw_value: String,
}

// MT5ターミナルの共通設定(config/common.ini)から「チャートの最大バー数」を取得
pub async fn get_terminal_max_bars(terminal_path: String) -> Result<MaxBarsInfo, AppError> {
    validate_terminal_path(&terminal_path)?;
    tokio::task::spawn_blocking(move || {
        let ini_path = Path::new(&terminal_path).join("config").join("common.ini");
        if !ini_path.exists() {
            return Ok(MaxBarsInfo {
                max_bars: 0,
                is_unlimited: false,
                raw_value: "Not Found".to_string(),
            });
        }

        let bytes = fs::read(&ini_path)?;
        let content = if bytes.starts_with(&[0xFF, 0xFE]) {
            // UTF-16LE
            let u16_vec: Vec<u16> = bytes[2..]
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect();
            String::from_utf16(&u16_vec).unwrap_or_default()
        } else if bytes.starts_with(&[0xFE, 0xFF]) {
            // UTF-16BE
            let u16_vec: Vec<u16> = bytes[2..]
                .chunks_exact(2)
                .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
                .collect();
            String::from_utf16(&u16_vec).unwrap_or_default()
        } else {
            String::from_utf8(bytes.clone()).unwrap_or_else(|_| {
                let u16_vec: Vec<u16> = bytes
                    .chunks_exact(2)
                    .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                    .collect();
                String::from_utf16(&u16_vec).unwrap_or_default()
            })
        };

        let mut in_charts_section = false;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                let section_name = &trimmed[1..trimmed.len() - 1];
                in_charts_section = section_name.eq_ignore_ascii_case("Charts");
                continue;
            }
            if in_charts_section && trimmed.starts_with("MaxBars=") {
                let val_str = trimmed["MaxBars=".len()..].trim();
                let lower = val_str.to_lowercase();
                if let Ok(val) = val_str.parse::<u32>() {
                    let is_unlimited = val >= 100_000_000 || val == 0 || val == 2147483647;
                    return Ok(MaxBarsInfo {
                        max_bars: val,
                        is_unlimited,
                        raw_value: val_str.to_string(),
                    });
                } else {
                    let is_unlimited = lower.contains("unlimited") || lower == "0";
                    return Ok(MaxBarsInfo {
                        max_bars: if is_unlimited { 100_000_000 } else { 0 },
                        is_unlimited,
                        raw_value: val_str.to_string(),
                    });
                }
            }
        }

        Ok(MaxBarsInfo {
            max_bars: 0,
            is_unlimited: false,
            raw_value: "Unknown".to_string(),
        })
    })
    .await
    .map_err(|e| AppError::Mt5(format!("MaxBars取得スレッドエラー: {}", e)))?
}

