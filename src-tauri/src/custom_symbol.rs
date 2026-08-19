use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::path::{Path};
use serde::{Deserialize, Serialize};
use chrono::NaiveDateTime;
use crate::error::AppError;

/// MQL5 の MqlTick 構造体と同等のメモリレイアウト (パック60バイト)
#[repr(C, packed)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
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
    pub category: String,
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

        if !self.custom_symbols.iter().any(|s| s == symbol) {
            self.custom_symbols.push(symbol.to_string());
        }
    }
}

pub const KNOWN_PAIRS: &[&str] = &[
    "USDJPY", "EURUSD", "GBPJPY", "EURJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD",
    "EURGBP", "EURCHF", "EURAUD", "EURCAD", "EURNZD", "GBPAUD", "GBPCAD", "GBPCHF",
    "GBPNZD", "AUDJPY", "CHFJPY", "CADJPY", "NZDJPY", "AUDCAD", "AUDCHF", "AUDNZD",
    "CADCHF", "NZDCAD", "NZDCHF", "XAUUSD", "GOLD", "XAGUSD", "SILVER", "BTCUSD",
    "ETHUSD", "US30", "US500", "USTEC", "JP225", "DE30", "DE40", "UK100", "WTI", "BRENT"
];

/// ファイルパスおよび親ディレクトリ群から (ペア名, カテゴリ/サフィックス, 年月/識別ラベル) を抽出する
pub fn analyze_zip_path(path: &Path, root_dir: &Path) -> Option<(String, String, String)> {
    let file_stem = path.file_stem().and_then(|s| s.to_str())?;
    let upper_stem = file_stem.to_uppercase();

    // 1. 通貨ペア（Pair Name）の検出
    let mut pair_opt: Option<String> = None;
    let mut best_len = 0;

    // (a) ファイル名から既知の通貨ペアを検索（最長一致）
    for &kp in KNOWN_PAIRS {
        if upper_stem.contains(kp) && kp.len() > best_len {
            pair_opt = Some(kp.to_string());
            best_len = kp.len();
        }
    }

    // (b) ファイル名にない場合、親ディレクトリから検索
    if pair_opt.is_none() {
        let mut curr = path.parent();
        while let Some(dir) = curr {
            if let Some(dname) = dir.file_name().and_then(|s| s.to_str()) {
                let d_upper = dname.to_uppercase();
                for &kp in KNOWN_PAIRS {
                    if d_upper.contains(kp) && kp.len() > best_len {
                        pair_opt = Some(kp.to_string());
                        best_len = kp.len();
                    }
                }
                if pair_opt.is_some() {
                    break;
                }
            }
            if dir == root_dir || dir.parent().is_none() {
                break;
            }
            curr = dir.parent();
        }
    }

    let pair = pair_opt.unwrap_or_else(|| {
        let first = file_stem.split(&['_', '-'][..]).next().unwrap_or(file_stem);
        first.to_uppercase()
    });

    // 2. 年月・ラベルおよび カテゴリ/サフィックスの検出
    let mut category_opt: Option<String> = None;
    let mut year_month_opt: Option<String> = None;

    // (a) YYYY-MM / YYYY_MM パターンの検索 (例: 2016-09, 2025_01)
    if let Some((year, month)) = find_year_month(file_stem) {
        category_opt = Some(year.clone());
        year_month_opt = Some(format!("{}-{}", year, month));
    }

    // (b) ファイル名に4桁西暦
    if category_opt.is_none() {
        if let Some(year) = find_year_4digits(file_stem) {
            category_opt = Some(year.clone());
            year_month_opt = Some(year);
        }
    }

    // (c) 親ディレクトリ階層に4桁西暦 (例: D:\TickData\2016\...)
    if category_opt.is_none() {
        let mut curr = path.parent();
        while let Some(dir) = curr {
            if let Some(dname) = dir.file_name().and_then(|s| s.to_str()) {
                if let Some(year) = find_year_4digits(dname) {
                    category_opt = Some(year);
                    year_month_opt = Some(file_stem.to_string());
                    break;
                }
            }
            if dir == root_dir || dir.parent().is_none() {
                break;
            }
            curr = dir.parent();
        }
    }

    // (d) ファイル名からサフィックス抽出 (例: ticks_EURJPY-test -> test, USDJPY_demo -> demo)
    if category_opt.is_none() {
        let clean_stem = if upper_stem.starts_with("TICKS_") {
            &file_stem[6..]
        } else {
            file_stem
        };

        let parts: Vec<&str> = clean_stem.split(&['_', '-'][..]).filter(|s| !s.is_empty()).collect();
        if parts.len() > 1 {
            let remaining: Vec<&str> = parts
                .into_iter()
                .filter(|&p| !p.eq_ignore_ascii_case(&pair) && !p.eq_ignore_ascii_case("ticks"))
                .collect();
            if !remaining.is_empty() {
                let tag = remaining.join("_");
                category_opt = Some(tag.clone());
                year_month_opt = Some(tag);
            }
        }
    }

    // (e) 親ディレクトリ名からサフィックス抽出 (例: D:\TickData\test\ticks_EURJPY.zip -> test)
    if category_opt.is_none() {
        if let Some(parent) = path.parent() {
            if parent != root_dir {
                if let Some(dname) = parent.file_name().and_then(|s| s.to_str()) {
                    if !dname.eq_ignore_ascii_case(&pair) && !dname.eq_ignore_ascii_case("ticks") {
                        category_opt = Some(dname.to_string());
                        year_month_opt = Some(file_stem.to_string());
                    }
                }
            }
        }
    }

    let category = category_opt.unwrap_or_else(|| "Custom".to_string());
    let year_month = year_month_opt.unwrap_or_else(|| file_stem.to_string());

    Some((pair, category, year_month))
}

fn find_year_month(s: &str) -> Option<(String, String)> {
    let bytes = s.as_bytes();
    if bytes.len() < 7 {
        return None;
    }
    for i in 0..=(bytes.len() - 7) {
        if bytes[i..i+4].iter().all(|b| b.is_ascii_digit()) {
            let sep = bytes[i+4];
            if (sep == b'-' || sep == b'_') && bytes[i+5..i+7].iter().all(|b| b.is_ascii_digit()) {
                let year = s[i..i+4].to_string();
                let month = s[i+5..i+7].to_string();
                return Some((year, month));
            }
        }
    }
    None
}

fn find_year_4digits(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    if bytes.len() < 4 {
        return None;
    }
    for i in 0..=(bytes.len() - 4) {
        if bytes[i..i+4].iter().all(|b| b.is_ascii_digit()) {
            let val = s[i..i+4].parse::<i32>().unwrap_or(0);
            if (1970..=2099).contains(&val) {
                let left_ok = i == 0 || !bytes[i-1].is_ascii_digit();
                let right_ok = i + 4 == bytes.len() || !bytes[i+4].is_ascii_digit();
                if left_ok && right_ok {
                    return Some(s[i..i+4].to_string());
                }
            }
        }
    }
    None
}

/// 選択されたルートディレクトリから ticks_*.zip 等を再帰検索し、カテゴリ・通貨ペアごとにグループ化する
pub fn scan_directory_for_ticks(
    root_dir: &Path,
    config_dir: &Path,
    existing_mt5_symbols: &[String],
) -> Result<Vec<ScannedPairGroup>, AppError> {
    let manifest = ImportManifest::load_from_dir(config_dir);
    let mut final_map: HashMap<(String, String), Vec<ScannedZipFile>> = HashMap::new();
    walk_dir_collect(root_dir, root_dir, &mut final_map, &manifest);

    let mut result = Vec::new();
    for ((category, pair), mut files) in final_map {
        files.sort_by(|a, b| a.year_month.cmp(&b.year_month));
        let suggested_symbol_name = format!("{}_{}", pair, category);
        let already_exists_in_mt5 = existing_mt5_symbols
            .iter()
            .any(|s| s.eq_ignore_ascii_case(&suggested_symbol_name));

        let group_path = if category.is_empty() || category.eq_ignore_ascii_case("custom") {
            "Custom".to_string()
        } else {
            category.clone()
        };

        result.push(ScannedPairGroup {
            category,
            pair_name: pair,
            suggested_symbol_name,
            group_path,
            files,
            already_exists_in_mt5,
        });
    }

    // ソート: カテゴリ順（年やタグ） -> 通貨ペア順
    result.sort_by(|a, b| {
        let cat_cmp = a.category.cmp(&b.category);
        if cat_cmp != std::cmp::Ordering::Equal {
            cat_cmp
        } else {
            a.pair_name.cmp(&b.pair_name)
        }
    });

    Ok(result)
}

fn walk_dir_collect(
    dir: &Path,
    root: &Path,
    map: &mut HashMap<(String, String), Vec<ScannedZipFile>>,
    manifest: &ImportManifest,
) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk_dir_collect(&path, root, map, manifest);
            } else if path.is_file() && path.extension().and_then(|s| s.to_str()).map(|e| e.eq_ignore_ascii_case("zip")) == Some(true) {
                if let Some((pair, category, year_month)) = analyze_zip_path(&path, root) {
                    let suggested_symbol = format!("{}_{}", pair, category);
                    let already = manifest.is_imported(&suggested_symbol, &year_month);
                    map.entry((category, pair)).or_default().push(ScannedZipFile {
                        year_month,
                        file_path: path.to_string_lossy().to_string(),
                        already_imported: already,
                    });
                }
            }
        }
    }
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

    // CSVまたはTXTエントリを優先的に探す
    let mut csv_index = 0;
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name().to_lowercase();
            if name.ends_with(".csv") || name.ends_with(".txt") || name.ends_with(".dat") {
                csv_index = i;
                break;
            }
        }
    }

    let mut csv_file = archive.by_index(csv_index)
        .map_err(|e| AppError::Config(format!("ZIP内のエントリ読込失敗: {}", e)))?;

    let mut buffer = Vec::new();
    std::io::Read::read_to_end(&mut csv_file, &mut buffer)?;

    // 概算ティック容量をあらかじめ予約 (無用な再メモリ拡張を排除)
    let mut ticks: Vec<MqlTick> = Vec::with_capacity(buffer.len() / 35 + 100);

    for line_bytes in buffer.split(|&b| b == b'\n') {
        let trimmed = trim_ascii_bytes(line_bytes);
        if trimmed.is_empty() || trimmed[0] == b'#' || trimmed[0] == b'D' || trimmed[0] == b'd' {
            continue;
        }

        // CSVフィールド分割 (区切り文字: カンマまたはタブ)
        let mut fields = [ &[][..]; 4 ];
        let mut field_idx = 0;
        let mut start = 0;
        for (i, &b) in trimmed.iter().enumerate() {
            if b == b',' || b == b'\t' {
                if field_idx < 4 {
                    fields[field_idx] = &trimmed[start..i];
                    field_idx += 1;
                }
                start = i + 1;
            }
        }
        if field_idx < 4 && start < trimmed.len() {
            fields[field_idx] = &trimmed[start..];
            field_idx += 1;
        }

        if field_idx < 4 {
            continue;
        }

        let date_bytes = trim_ascii_bytes(fields[0]);
        let time_bytes = trim_ascii_bytes(fields[1]);
        let bid_bytes  = trim_ascii_bytes(fields[2]);
        let ask_bytes  = trim_ascii_bytes(fields[3]);

        let Ok(date_str) = std::str::from_utf8(date_bytes) else { continue; };
        let Ok(time_str) = std::str::from_utf8(time_bytes) else { continue; };
        let Ok(bid_str)  = std::str::from_utf8(bid_bytes) else { continue; };
        let Ok(ask_str)  = std::str::from_utf8(ask_bytes) else { continue; };

        let Ok(bid) = bid_str.parse::<f64>() else { continue; };
        let Ok(ask) = ask_str.parse::<f64>() else { continue; };

        let time_msc = match fast_parse_datetime_msc(date_str, time_str) {
            Some(msc) => msc,
            None => {
                let dt_full_str = format!("{} {}", date_str.replace('.', "-"), time_str);
                match parse_datetime_msc(&dt_full_str) {
                    Ok(msc) => msc,
                    Err(_) => continue,
                }
            }
        };
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
    let byte_slice: &[u8] = bytemuck::cast_slice(&ticks);

    fs::write(output_bin_path, byte_slice)?;

    Ok(tick_count)
}

#[inline]
fn trim_ascii_bytes(mut b: &[u8]) -> &[u8] {
    while let Some((&first, rest)) = b.split_first() {
        if first == b' ' || first == b'\r' || first == b'\t' || first == b'\n' {
            b = rest;
        } else {
            break;
        }
    }
    while let Some((&last, rest)) = b.split_last() {
        if last == b' ' || last == b'\r' || last == b'\t' || last == b'\n' {
            b = rest;
        } else {
            break;
        }
    }
    b
}

#[inline]
fn parse_digits(b: &[u8]) -> Option<i64> {
    let mut val: i64 = 0;
    if b.is_empty() { return None; }
    for &c in b {
        if c >= b'0' && c <= b'9' {
            val = val * 10 + (c - b'0') as i64;
        } else {
            return None;
        }
    }
    Some(val)
}

#[inline]
fn fast_parse_datetime_msc(date_str: &str, time_str: &str) -> Option<i64> {
    let d_bytes = date_str.as_bytes();
    let t_bytes = time_str.as_bytes();

    if d_bytes.len() < 10 || t_bytes.len() < 5 {
        return None;
    }

    let year = parse_digits(&d_bytes[0..4])? as i32;
    let month = parse_digits(&d_bytes[5..7])? as u32;
    let day = parse_digits(&d_bytes[8..10])? as u32;

    let hour = parse_digits(&t_bytes[0..2])? as u32;
    let min = parse_digits(&t_bytes[3..5])? as u32;

    let (sec, millis) = if t_bytes.len() >= 8 && t_bytes[5] == b':' {
        let sec = parse_digits(&t_bytes[6..8])? as u32;
        let millis = if t_bytes.len() > 9 && t_bytes[8] == b'.' {
            let sub = &t_bytes[9..];
            if sub.len() == 1 {
                parse_digits(&sub[..1])? * 100
            } else if sub.len() == 2 {
                parse_digits(&sub[..2])? * 10
            } else if sub.len() >= 3 {
                parse_digits(&sub[..3])?
            } else {
                0
            }
        } else {
            0
        };
        (sec, millis)
    } else {
        (0, 0)
    };

    let naive_date = chrono::NaiveDate::from_ymd_opt(year, month, day)?;
    let naive_dt = naive_date.and_hms_opt(hour, min, sec)?;
    let secs = naive_dt.and_utc().timestamp();
    Some(secs * 1000 + millis)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_mql_tick_size_and_alignment() {
        assert_eq!(std::mem::size_of::<MqlTick>(), 60);
    }

    #[test]
    fn test_analyze_zip_path_various_patterns() {
        let root = PathBuf::from("D:\\TickData");

        // パターン1: 年別・通貨ペア別 (OANDA標準形式)
        let p1 = PathBuf::from("D:\\TickData\\2016\\EURJPY\\ticks_EURJPY-oj5k_2016-09.zip");
        let res1 = analyze_zip_path(&p1, &root);
        assert_eq!(res1, Some(("EURJPY".to_string(), "2016".to_string(), "2016-09".to_string())));

        // パターン2: 年なし・通貨ペア別フォルダ・独自タグ
        let p2 = PathBuf::from("D:\\TickData\\EURJPY\\ticks_EURJPY-test.zip");
        let res2 = analyze_zip_path(&p2, &root);
        assert_eq!(res2, Some(("EURJPY".to_string(), "test".to_string(), "test".to_string())));

        // パターン3: タグフォルダ配下
        let p3 = PathBuf::from("D:\\TickData\\test\\ticks_EURJPY-test.zip");
        let res3 = analyze_zip_path(&p3, &root);
        assert_eq!(res3, Some(("EURJPY".to_string(), "test".to_string(), "test".to_string())));

        // パターン4: ルート直下
        let p4 = PathBuf::from("D:\\TickData\\USDJPY_demo.zip");
        let res4 = analyze_zip_path(&p4, &root);
        assert_eq!(res4, Some(("USDJPY".to_string(), "demo".to_string(), "demo".to_string())));

        // パターン5: 年フォルダ配下・ファイル名に年なし
        let p5 = PathBuf::from("D:\\TickData\\2017\\GBPJPY\\ticks_GBPJPY.zip");
        let res5 = analyze_zip_path(&p5, &root);
        assert_eq!(res5, Some(("GBPJPY".to_string(), "2017".to_string(), "ticks_GBPJPY".to_string())));
    }

    #[test]
    fn test_parse_datetime_msc() {
        let msc = parse_datetime_msc("2025-01-01 12:30:45.123").unwrap();
        assert_eq!(msc % 1000, 123);
        let fast_msc = fast_parse_datetime_msc("2025-01-01", "12:30:45.123").unwrap();
        assert_eq!(msc, fast_msc);

        let fast_msc2 = fast_parse_datetime_msc("2025.01.01", "12:30:45.123").unwrap();
        assert_eq!(msc, fast_msc2);
    }
}


