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
const INDICATOR_SOURCE: &str = include_str!("../../MQL5/Indicators/TickReplayRoleMarker.mq5");

const MQH_CONFIG: &str = include_str!("../../MQL5/Include/TickReplay/Config.mqh");
const MQH_WIN32PIPE: &str = include_str!("../../MQL5/Include/TickReplay/Win32Pipe.mqh");
const MQH_JSONHELPER: &str = include_str!("../../MQL5/Include/TickReplay/JsonHelper.mqh");
const MQH_SESSION: &str = include_str!("../../MQL5/Include/TickReplay/SessionManager.mqh");
const MQH_TICKBUFFER: &str = include_str!("../../MQL5/Include/TickReplay/TickBuffer.mqh");
const MQH_SYMBOL: &str = include_str!("../../MQL5/Include/TickReplay/SymbolManager.mqh");
const MQH_CHART: &str = include_str!("../../MQL5/Include/TickReplay/ChartManager.mqh");
const MQH_VIRTUALTRADER: &str = include_str!("../../MQL5/Include/TickReplay/VirtualTrader.mqh");
const MQH_REPLAYENGINE: &str = include_str!("../../MQL5/Include/TickReplay/ReplayEngine.mqh");

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

// origin.txt のエンコーディング（UTF-16LE / UTF-8）を考慮して文字列を読み取る
pub fn read_file_string_lossy(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        // UTF-16LE with BOM
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        let s = String::from_utf16_lossy(&u16s);
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    } else if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        // UTF-16BE with BOM
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        let s = String::from_utf16_lossy(&u16s);
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    } else if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        // UTF-8 with BOM
        let s = String::from_utf8_lossy(&bytes[3..]);
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    } else {
        // UTF-16LE BOMなし（byte 1 != 0, byte 2 == 0）の判定
        if bytes.len() >= 4 && bytes[1] == 0 && bytes[3] == 0 {
            let u16s: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect();
            let s = String::from_utf16_lossy(&u16s);
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        } else {
            let s = String::from_utf8_lossy(&bytes);
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct Mt5TerminalInfo {
    pub id: String,
    pub name: String,
    pub default_name: String,
    pub path: String,
    pub origin_path: Option<String>,
    pub custom_name: Option<String>,
}

// ファイルが存在し、中身が完全に一致している場合はスキップし、差分がある場合や未存在の場合のみ書き込む
fn write_if_different(path: &Path, content: &str) -> std::io::Result<bool> {
    if path.is_file() {
        if let Ok(existing_bytes) = fs::read(path) {
            if existing_bytes == content.as_bytes() {
                return Ok(false); // 同一内容のためスキップ
            }
        }
    }
    fs::write(path, content)?;
    Ok(true) // 書き込み完了
}

// MT5データフォルダをスキャンし、EAおよびスクリプトファイル・Includeファイルを自動配置する (起動時初期化用の同期処理)
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
                    let indicators_path = mql5_path.join("Indicators");
                    let files_path = mql5_path.join("Files");
                    let include_path = mql5_path.join("Include").join("TickReplay");

                    let _ = fs::create_dir_all(&experts_path);
                    let _ = fs::create_dir_all(&scripts_path);
                    let _ = fs::create_dir_all(&indicators_path);
                    let _ = fs::create_dir_all(&files_path);
                    let _ = fs::create_dir_all(&include_path);

                    let ea_file = experts_path.join("TickReplayControllerEA.mq5");
                    if let Err(e) = write_if_different(&ea_file, EA_SOURCE) {
                        eprintln!("EA配置失敗 {:?}: {}", ea_file, e);
                    }

                    let importer_file = scripts_path.join("TickReplayImporter.mq5");
                    if let Err(e) = write_if_different(&importer_file, IMPORTER_SOURCE) {
                        eprintln!("Importer配置失敗 {:?}: {}", importer_file, e);
                    }

                    let indicator_file = indicators_path.join("TickReplayRoleMarker.mq5");
                    if let Err(e) = write_if_different(&indicator_file, INDICATOR_SOURCE) {
                        eprintln!("Indicator配置失敗 {:?}: {}", indicator_file, e);
                    }

                    let mqh_files = [
                        ("Config.mqh", MQH_CONFIG),
                        ("Win32Pipe.mqh", MQH_WIN32PIPE),
                        ("JsonHelper.mqh", MQH_JSONHELPER),
                        ("SessionManager.mqh", MQH_SESSION),
                        ("TickBuffer.mqh", MQH_TICKBUFFER),
                        ("SymbolManager.mqh", MQH_SYMBOL),
                        ("ChartManager.mqh", MQH_CHART),
                        ("VirtualTrader.mqh", MQH_VIRTUALTRADER),
                        ("ReplayEngine.mqh", MQH_REPLAYENGINE),
                    ];

                    for (fname, content) in mqh_files {
                        let target_path = include_path.join(fname);
                        if let Err(e) = write_if_different(&target_path, content) {
                            eprintln!("Header配置失敗 {:?}: {}", target_path, e);
                        }
                    }
                }
            }
        }
    }
}

// インストール済みのMT5端末を検出する (非同期I/O)
pub async fn get_mt5_terminals(
    terminal_names: Option<std::collections::HashMap<String, String>>,
) -> Result<Vec<Mt5TerminalInfo>, AppError> {
    tokio::task::spawn_blocking(move || {
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
                    let id = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string();

                    // origin.txt からインストール元フォルダ名を取得
                    let origin_file = path.join("origin.txt");
                    let origin_path = read_file_string_lossy(&origin_file);
                    let default_name = if let Some(ref orig) = origin_path {
                        let clean = orig.trim_end_matches(['\\', '/']);
                        Path::new(clean)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| id.clone())
                    } else {
                        id.clone()
                    };

                    let path_str = path.to_string_lossy().to_string();
                    let custom_name = terminal_names.as_ref().and_then(|map| {
                        map.get(&id)
                            .or_else(|| map.get(&path_str))
                            .filter(|s| !s.trim().is_empty())
                            .cloned()
                    });

                    let name = custom_name.clone().unwrap_or_else(|| default_name.clone());

                    terminals.push(Mt5TerminalInfo {
                        id,
                        name,
                        default_name,
                        path: path_str,
                        origin_path,
                        custom_name,
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

        // コピー先ディレクトリを作成
        fs::create_dir_all(&dest_dir)?;

        // コピー先の古い .chr ファイルを全削除して同期ズレ（ゴーストチャート）を防ぐ
        if let Ok(entries) = fs::read_dir(&dest_dir) {
            for entry in entries.flatten() {
                let file_path = entry.path();
                if file_path.is_file() {
                    if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
                        if ext.eq_ignore_ascii_case("chr") {
                            let _ = fs::remove_file(file_path);
                        }
                    }
                }
            }
        }

        let mut copied_count = 0;
        let entries = fs::read_dir(&src_dir)?;
        for entry in entries.flatten() {
            let file_path = entry.path();
            if file_path.is_file() {
                if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("chr") {
                        if let Some(name) = file_path.file_name() {
                            let dest_file = dest_dir.join(name);
                            fs::copy(&file_path, &dest_file)?;
                            copied_count += 1;
                        }
                    }
                }
            }
        }
        println!("[Info] プロファイル '{}' の .chr ファイル {} 件をコピーしました: {:?}", profile_name_clean, copied_count, dest_dir);
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

pub fn is_valid_symbol_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    let system_blacklist = [
        "cache", "logs", "chats", "mail", "users", "history", "ticks",
        "default", "custom", "bases", "mql5", "config", "profiles",
        "files", "charts", "indicators", "experts", "scripts", "images",
        "include", "libraries", "symbolsets", "news", "subscriptions",
        "symbols", "trades", "options", "books", "gvariables", "objects",
        "strategy", "alerts", "replay"
    ];
    if system_blacklist.iter().any(|&b| b.eq_ignore_ascii_case(name)) || (name.len() >= 5 && name[..5].eq_ignore_ascii_case("chart")) {
        return false;
    }
    let name_lower = name.to_ascii_lowercase();
    if name_lower == "replay" || name_lower.ends_with("_replay") || name_lower.ends_with(".replay") {
        return false;
    }
    name.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '_' || c == '-' || c == '#' || c == '+' || c == '/' || c == '$' || c == '@')
}

pub async fn get_existing_symbols_with_info(terminal_path: &str) -> Result<Vec<SymbolItem>, AppError> {
    validate_terminal_path(terminal_path)?;
    let path = PathBuf::from(terminal_path);
    tokio::task::spawn_blocking(move || {
        let mut symbol_items = std::collections::HashSet::new();

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
                        
                        if server_name.is_empty() || server_name.eq_ignore_ascii_case("cache") || server_name.eq_ignore_ascii_case("logs") || server_name.starts_with('.') {
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
                                    if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("symbol=") {
                                        let sym = trimmed[7..].trim();
                                        if is_valid_symbol_name(sym) {
                                            let is_custom = sym.len() >= 7 && sym[sym.len() - 7..].eq_ignore_ascii_case("_custom");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_if_different() {
        let temp_dir = std::env::temp_dir().join(format!(
            "test_tr_diff_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::create_dir_all(&temp_dir);
        let test_file = temp_dir.join("test_write.txt");

        // 1. 初回書き込み（ファイル未存在） -> 書き込み実行 (true)
        let res1 = write_if_different(&test_file, "hello world").unwrap();
        assert!(res1);
        assert_eq!(fs::read_to_string(&test_file).unwrap(), "hello world");

        // 2. 同一内容での書き込み -> スキップ (false)
        let res2 = write_if_different(&test_file, "hello world").unwrap();
        assert!(!res2);

        // 3. 異なる内容での書き込み -> 更新実行 (true)
        let res3 = write_if_different(&test_file, "hello updated").unwrap();
        assert!(res3);
        assert_eq!(fs::read_to_string(&test_file).unwrap(), "hello updated");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_is_valid_symbol_name() {
        // 有効なシンボル名
        assert!(is_valid_symbol_name("USDJPY"));
        assert!(is_valid_symbol_name("EURUSD"));
        assert!(is_valid_symbol_name("USDJPY_2024"));
        assert!(is_valid_symbol_name("EURUSD.raw"));
        assert!(is_valid_symbol_name("GBPJPY_Custom"));

        // ブラックリスト（フォルダ名やシステム名）
        assert!(!is_valid_symbol_name(""));
        assert!(!is_valid_symbol_name("history"));
        assert!(!is_valid_symbol_name("ticks"));
        assert!(!is_valid_symbol_name("Custom"));
        assert!(!is_valid_symbol_name("Default"));
        assert!(!is_valid_symbol_name("charts"));

        // リプレイ用シンボル・グループの除外
        assert!(!is_valid_symbol_name("Replay"));
        assert!(!is_valid_symbol_name("replay"));
        assert!(!is_valid_symbol_name("REPLAY"));
        assert!(!is_valid_symbol_name("USDJPY_Replay"));
        assert!(!is_valid_symbol_name("USDJPY_replay"));
        assert!(!is_valid_symbol_name("EURUSD.replay"));
    }
}

