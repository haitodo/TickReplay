use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path};
use serde::{Deserialize, Serialize};
use chrono::NaiveDateTime;
use crate::error::AppError;

/// MQL5 の MqlTick 構造体と同等のメモリレイアウト (パック60バイト)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy)]
pub struct MqlTick {
    pub time: i64,        // 8 bytes: Unixタイムスタンプ (秒)
    pub bid: f64,         // 8 bytes: Bid価格
    pub ask: f64,         // 8 bytes: Ask価格
    pub last: f64,        // 8 bytes: 取引価格 (0.0)
    pub volume: u64,      // 8 bytes: 出来高 (0)
    pub time_msc: i64,    // 8 bytes: Unixタイムスタンプ (ミリ秒)
    pub flags: u32,       // 4 bytes: フラグ (TICK_FLAG_BID = 2 | TICK_FLAG_ASK = 4 => 6)
    pub volume_real: f64, // 8 bytes: リアル出来高 (0.0)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScannedZipFile {
    pub year_month: String,
    pub file_path: String,
    pub already_imported: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScannedPairGroup {
    pub pair_name: String,
    pub suggested_symbol_name: String,
    pub group_path: String,
    pub files: Vec<ScannedZipFile>,
    pub already_exists_in_mt5: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ImportManifest {
    pub imported_months: HashMap<String, HashSet<String>>,
    pub custom_symbols: Vec<String>,
}

impl ImportManifest {
    pub fn load_from_dir(config_dir: &Path) -> Self {
        let manifest_file = config_dir.join("import_manifest.json");
        if manifest_file.exists() {
            if let Ok(content) = fs::read_to_string(&manifest_file) {
                if let Ok(manifest) = serde_json::from_str::<ImportManifest>(&content) {
                    return manifest;
                }
            }
        }
        Self::default()
    }

    pub fn save_to_dir(&self, config_dir: &Path) -> Result<(), AppError> {
        if !config_dir.exists() {
            fs::create_dir_all(config_dir)?;
        }
        let manifest_file = config_dir.join("import_manifest.json");
        let content = serde_json::to_string_pretty(self)?;
        fs::write(manifest_file, content)?;
        Ok(())
    }

    pub fn is_imported(&self, symbol: &str, year_month: &str) -> bool {
        self.imported_months
            .get(symbol)
            .map(|months| months.contains(year_month))
            .unwrap_or(false)
    }

    pub fn mark_imported(&mut self, symbol: &str, year_month: &str) {
        self.imported_months
            .entry(symbol.to_string())
            .or_insert_with(HashSet::new)
            .insert(year_month.to_string());

        if !self.custom_symbols.contains(&symbol.to_string()) {
            self.custom_symbols.push(symbol.to_string());
        }
    }
}

/// 選択されたルートディレクトリから ticks_*.zip を検索し、通貨ペアごとにグループ化する
pub fn scan_directory_for_ticks(
    root_dir: &Path,
    config_dir: &Path,
    existing_mt5_symbols: &[String],
) -> Result<Vec<ScannedPairGroup>, AppError> {
    let manifest = ImportManifest::load_from_dir(config_dir);
    let mut pairs_map: HashMap<String, Vec<ScannedZipFile>> = HashMap::new();

    fn walk_dir(dir: &Path, map: &mut HashMap<String, Vec<ScannedZipFile>>, manifest: &ImportManifest) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk_dir(&path, map, manifest);
                } else if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("zip") {
                    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    // 例: ticks_EURJPY-oj5k_2025-01.zip
                    if file_name.starts_with("ticks_") {
                        if let Some((pair, year_month)) = parse_zip_filename(file_name) {
                            let suggested_symbol = format!("{}_Custom", pair);
                            let already = manifest.is_imported(&suggested_symbol, &year_month);
                            map.entry(pair).or_default().push(ScannedZipFile {
                                year_month,
                                file_path: path.to_string_lossy().to_string(),
                                already_imported: already,
                            });
                        }
                    }
                }
            }
        }
    }

    walk_dir(root_dir, &mut pairs_map, &manifest);

    let mut result = Vec::new();
    for (pair, mut files) in pairs_map {
        files.sort_by(|a, b| a.year_month.cmp(&b.year_month));
        let suggested_symbol_name = format!("{}_Custom", pair);
        let already_exists_in_mt5 = existing_mt5_symbols
            .iter()
            .any(|s| s.eq_ignore_ascii_case(&suggested_symbol_name));

        result.push(ScannedPairGroup {
            pair_name: pair,
            suggested_symbol_name,
            group_path: "Custom".to_string(),
            files,
            already_exists_in_mt5,
        });
    }

    result.sort_by(|a, b| a.pair_name.cmp(&b.pair_name));
    Ok(result)
}

/// ticks_EURJPY-oj5k_2025-01.zip から ("EURJPY", "2025-01") を抽出
fn parse_zip_filename(file_name: &str) -> Option<(String, String)> {
    let name_without_ext = file_name.strip_suffix(".zip")?;
    let parts: Vec<&str> = name_without_ext.split('_').collect();
    if parts.len() < 3 {
        return None;
    }

    let pair_part = parts[1];
    let pair_name = pair_part.split('-').next()?.to_uppercase();
    let year_month = parts[2].to_string();

    Some((pair_name, year_month))
}

/// 1ヶ月分の ZIP から CSV を解凍・パースし、.bin ファイルとして出力する
pub fn convert_zip_to_mql_bin(
    zip_path: &Path,
    output_bin_path: &Path,
) -> Result<usize, AppError> {
    let file = File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Config(format!("ZIPアーカイブの開閉失敗: {}", e)))?;

    if archive.len() == 0 {
        return Err(AppError::Config("空のZIPファイルです".to_string()));
    }

    let mut csv_file = archive.by_index(0)
        .map_err(|e| AppError::Config(format!("ZIP内のエントリ読込失敗: {}", e)))?;

    let reader = BufReader::new(&mut csv_file);
    let mut ticks: Vec<MqlTick> = Vec::with_capacity(1_000_000);

    for line_res in reader.lines() {
        let line = match line_res {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("DATE") {
            continue;
        }

        let parts: Vec<&str> = trimmed.split(|c| c == '\t' || c == ',').collect();
        if parts.len() < 4 {
            continue;
        }

        let date_str = parts[0].trim();
        let time_str = parts[1].trim();
        let bid_str = parts[2].trim();
        let ask_str = parts[3].trim();

        let bid: f64 = match bid_str.parse() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let ask: f64 = match ask_str.parse() {
            Ok(v) => v,
            Err(_) => continue,
        };

        let date_clean = date_str.replace('.', "-");
        let dt_full_str = format!("{} {}", date_clean, time_str);

        let time_msc = parse_datetime_msc(&dt_full_str)?;
        let time_sec = time_msc / 1000;

        ticks.push(MqlTick {
            time: time_sec,
            bid,
            ask,
            last: 0.0,
            volume: 0,
            time_msc,
            flags: 6,
            volume_real: 0.0,
        });
    }

    if ticks.is_empty() {
        return Err(AppError::Config("有効なティックデータが見つかりませんでした".to_string()));
    }

    // 昇順ソート
    ticks.sort_by_key(|t| t.time_msc);

    if let Some(parent) = output_bin_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let tick_count = ticks.len();
    let byte_slice: &[u8] = unsafe {
        std::slice::from_raw_parts(
            ticks.as_ptr() as *const u8,
            ticks.len() * std::mem::size_of::<MqlTick>(),
        )
    };

    fs::write(output_bin_path, byte_slice)?;

    Ok(tick_count)
}

fn parse_datetime_msc(dt_str: &str) -> Result<i64, AppError> {
    let parts: Vec<&str> = dt_str.split('.').collect();
    let main_dt_str = parts[0];
    let millis: i64 = if parts.len() > 1 {
        let mut m_str = parts[1].to_string();
        while m_str.len() < 3 {
            m_str.push('0');
        }
        m_str.truncate(3);
        m_str.parse().unwrap_or(0)
    } else {
        0
    };

    let naive_dt = NaiveDateTime::parse_from_str(main_dt_str, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(main_dt_str, "%Y-%m-%d %H:%M"))
        .map_err(|e| AppError::Config(format!("日時パース失敗 '{}': {}", dt_str, e)))?;

    let secs = naive_dt.and_utc().timestamp();
    Ok(secs * 1000 + millis)
}
