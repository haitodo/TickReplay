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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedZipInfo {
    pub pair: String,
    pub broker: String,
    pub year: String,
    pub year_month: String,
    pub suggested_symbol_name: String,
    pub group_path: String,
}

/// ファイルパスおよび親ディレクトリ群から (ペア名, ブローカー, 年, 年月) を抽出し、
/// サフィックス（-oj5k 等）を完全無視・破棄してクリーンなシンボル情報を作成する
pub fn analyze_zip_path(path: &Path, root_dir: &Path) -> Option<ParsedZipInfo> {
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

    // 2. 年月・年の検出 (サフィックスは一切見ず、YYYY-MM または 4桁西暦のみ抽出)
    let mut year_month_opt: Option<String> = None;
    let mut year_opt: Option<String> = None;

    if let Some((year, month)) = find_year_month(file_stem) {
        year_opt = Some(year.clone());
        year_month_opt = Some(format!("{}-{}", year, month));
    } else if let Some(year) = find_year_4digits(file_stem) {
        year_opt = Some(year.clone());
        year_month_opt = Some(year);
    }

    // 親ディレクトリ階層から年を検索
    if year_opt.is_none() {
        let mut curr = path.parent();
        while let Some(dir) = curr {
            if let Some(dname) = dir.file_name().and_then(|s| s.to_str()) {
                if let Some(year) = find_year_4digits(dname) {
                    year_opt = Some(year.clone());
                    if year_month_opt.is_none() {
                        year_month_opt = Some(year);
                    }
                    break;
                }
            }
            if dir == root_dir || dir.parent().is_none() {
                break;
            }
            curr = dir.parent();
        }
    }

    let year = year_opt.unwrap_or_default();
    let year_month = year_month_opt.unwrap_or_else(|| file_stem.to_string());

    // 3. ブローカー名の検出（親ディレクトリのみから抽出し、ファイル名サフィックスは完全無視）
    let mut broker_opt: Option<String> = None;
    let mut curr = path.parent();
    while let Some(dir) = curr {
        if let Some(dname) = dir.file_name().and_then(|s| s.to_str()) {
            let trimmed = dname.trim();
            let upper = trimmed.to_uppercase();

            let is_pair = KNOWN_PAIRS.iter().any(|&kp| kp == upper) || upper == pair;
            let is_year = find_year_4digits(trimmed).map(|y| y == trimmed).unwrap_or(false);
            let is_system_dir = upper == "TICKDATA" || upper == "TICKS" || upper == "DATA" || upper == "IMPORTS" || upper == "MQL5" || upper == "FILES";

            if !is_pair && !is_year && !is_system_dir && !trimmed.is_empty() {
                broker_opt = Some(trimmed.to_string());
                break;
            }
        }
        if dir == root_dir || dir.parent().is_none() {
            break;
        }
        curr = dir.parent();
    }

    // ルートフォルダ名もチェック
    if broker_opt.is_none() {
        if let Some(rname) = root_dir.file_name().and_then(|s| s.to_str()) {
            let trimmed = rname.trim();
            let upper = trimmed.to_uppercase();
            let is_pair = KNOWN_PAIRS.iter().any(|&kp| kp == upper) || upper == pair;
            let is_year = find_year_4digits(trimmed).map(|y| y == trimmed).unwrap_or(false);
            let is_system_dir = upper == "TICKDATA" || upper == "TICKS" || upper == "DATA" || upper == "IMPORTS" || upper == "MQL5" || upper == "FILES";

            if !is_pair && !is_year && !is_system_dir && !trimmed.is_empty() {
                broker_opt = Some(trimmed.to_string());
            }
        }
    }

    let broker = broker_opt.unwrap_or_else(|| "Custom".to_string());

    // 4. 推奨シンボル名とグループパスの決定
    let (suggested_symbol_name, group_path) = if broker.eq_ignore_ascii_case("custom") {
        if !year.is_empty() {
            (format!("{}_{}", pair, year), "Custom".to_string())
        } else {
            (format!("{}_Custom", pair), "Custom".to_string())
        }
    } else {
        let broker_upper = broker.to_uppercase();
        if !year.is_empty() {
            (format!("{}_{}_{}", pair, broker_upper, year), format!("Custom/{}", broker))
        } else {
            (format!("{}_{}", pair, broker_upper), format!("Custom/{}", broker))
        }
    };

    Some(ParsedZipInfo {
        pair,
        broker,
        year,
        year_month,
        suggested_symbol_name,
        group_path,
    })
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

/// 選択されたルートディレクトリから ticks_*.zip 等を再帰検索し、ブローカー・通貨ペア・年ごとにグループ化する
pub fn scan_directory_for_ticks(
    root_dir: &Path,
    config_dir: &Path,
    existing_mt5_symbols: &[String],
) -> Result<Vec<ScannedPairGroup>, AppError> {
    let manifest = ImportManifest::load_from_dir(config_dir);
    // Key: (broker, pair, year, suggested_symbol_name, group_path)
    let mut final_map: HashMap<(String, String, String, String, String), Vec<ScannedZipFile>> = HashMap::new();
    walk_dir_collect(root_dir, root_dir, &mut final_map, &manifest);

    let mut result = Vec::new();
    for ((broker, pair, year, suggested_symbol_name, group_path), mut files) in final_map {
        files.sort_by(|a, b| a.year_month.cmp(&b.year_month));
        let already_exists_in_mt5 = existing_mt5_symbols
            .iter()
            .any(|s| s.eq_ignore_ascii_case(&suggested_symbol_name));

        let category = if !broker.eq_ignore_ascii_case("custom") {
            broker.clone()
        } else if !year.is_empty() {
            year.clone()
        } else {
            "Custom".to_string()
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

    // ソート: ブローカー順 -> 通貨ペア順 -> 年降順
    result.sort_by(|a, b| {
        let cat_cmp = a.category.cmp(&b.category);
        if cat_cmp != std::cmp::Ordering::Equal {
            cat_cmp
        } else {
            let pair_cmp = a.pair_name.cmp(&b.pair_name);
            if pair_cmp != std::cmp::Ordering::Equal {
                pair_cmp
            } else {
                b.suggested_symbol_name.cmp(&a.suggested_symbol_name)
            }
        }
    });

    Ok(result)
}

fn walk_dir_collect(
    dir: &Path,
    root: &Path,
    map: &mut HashMap<(String, String, String, String, String), Vec<ScannedZipFile>>,
    manifest: &ImportManifest,
) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk_dir_collect(&path, root, map, manifest);
            } else if path.is_file() && path.extension().and_then(|s| s.to_str()).map(|e| e.eq_ignore_ascii_case("zip")) == Some(true) {
                if let Some(parsed) = analyze_zip_path(&path, root) {
                    let already = manifest.is_imported(&parsed.suggested_symbol_name, &parsed.year_month);
                    let key = (
                        parsed.broker,
                        parsed.pair,
                        parsed.year,
                        parsed.suggested_symbol_name,
                        parsed.group_path,
                    );
                    map.entry(key).or_default().push(ScannedZipFile {
                        year_month: parsed.year_month,
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

        // パターン1: OANDA (サフィックス -oj5k は完全無視)
        let p1 = PathBuf::from("D:\\TickData\\OANDA\\2016\\USDJPY\\ticks_USDJPY-oj5k_2016-09.zip");
        let res1 = analyze_zip_path(&p1, &root).unwrap();
        assert_eq!(res1.pair, "USDJPY");
        assert_eq!(res1.broker, "OANDA");
        assert_eq!(res1.year, "2016");
        assert_eq!(res1.year_month, "2016-09");
        assert_eq!(res1.suggested_symbol_name, "USDJPY_OANDA_2016");
        assert_eq!(res1.group_path, "Custom/OANDA");

        // パターン2: Ducascopy
        let p2 = PathBuf::from("D:\\TickData\\Ducascopy\\2016\\USDJPY\\ticks_USDJPY_2016-09.zip");
        let res2 = analyze_zip_path(&p2, &root).unwrap();
        assert_eq!(res2.pair, "USDJPY");
        assert_eq!(res2.broker, "Ducascopy");
        assert_eq!(res2.year, "2016");
        assert_eq!(res2.year_month, "2016-09");
        assert_eq!(res2.suggested_symbol_name, "USDJPY_DUCASCOPY_2016");
        assert_eq!(res2.group_path, "Custom/Ducascopy");

        // パターン3: ブローカーフォルダなし (Customフォールバック)
        let p3 = PathBuf::from("D:\\TickData\\2016\\EURJPY\\ticks_EURJPY_2016-09.zip");
        let res3 = analyze_zip_path(&p3, &root).unwrap();
        assert_eq!(res3.pair, "EURJPY");
        assert_eq!(res3.broker, "Custom");
        assert_eq!(res3.year, "2016");
        assert_eq!(res3.suggested_symbol_name, "EURJPY_2016");
        assert_eq!(res3.group_path, "Custom");
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


