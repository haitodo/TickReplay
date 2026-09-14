use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::path::Path;
use serde::{Deserialize, Serialize};
use chrono::{Datelike, NaiveDateTime, Timelike};
use arrow::array::{Float64Array, Int64Array};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parquet::arrow::ProjectionMask;
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
    #[serde(default)]
    pub file_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScannedPairGroup {
    pub category: String,
    pub broker: String,
    pub year: String,
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

    // 0. Hiveパーティション（key=value）形式の探索
    let mut hive_broker: Option<String> = None;
    let mut hive_symbol: Option<String> = None;
    let mut hive_year: Option<String> = None;
    let mut hive_month: Option<String> = None;

    let mut curr = path.parent();
    while let Some(dir) = curr {
        if let Some(dname) = dir.file_name().and_then(|s| s.to_str()) {
            let lower = dname.to_lowercase();
            if lower.starts_with("broker=") && hive_broker.is_none() {
                let val = dname[7..].trim();
                if !val.is_empty() {
                    hive_broker = Some(val.to_string());
                }
            } else if lower.starts_with("symbol=") && hive_symbol.is_none() {
                let val = dname[7..].trim();
                if !val.is_empty() {
                    hive_symbol = Some(val.to_uppercase());
                }
            } else if lower.starts_with("year=") && hive_year.is_none() {
                let val = dname[5..].trim();
                if !val.is_empty() {
                    hive_year = Some(val.to_string());
                }
            } else if lower.starts_with("month=") && hive_month.is_none() {
                let val = dname[6..].trim();
                if let Ok(m) = val.parse::<u32>() {
                    hive_month = Some(format!("{:02}", m));
                }
            }
        }
        if dir == root_dir || dir.parent().is_none() {
            break;
        }
        curr = dir.parent();
    }

    // 1. 通貨ペア（Pair Name）の検出
    let pair = if let Some(hs) = hive_symbol {
        hs
    } else {
        let mut pair_opt: Option<String> = None;
        let mut best_len = 0;

        for &kp in KNOWN_PAIRS {
            if upper_stem.contains(kp) && kp.len() > best_len {
                pair_opt = Some(kp.to_string());
                best_len = kp.len();
            }
        }

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

        pair_opt.unwrap_or_else(|| {
            let first = file_stem.split(&['_', '-'][..]).next().unwrap_or(file_stem);
            first.to_uppercase()
        })
    };

    // 2. 年月・年の検出 (サフィックスは一切見ず、YYYY-MM または 4桁西暦のみ抽出)
    let (year, year_month) = if let (Some(y), Some(m)) = (&hive_year, &hive_month) {
        (y.clone(), format!("{}-{}", y, m))
    } else {
        let mut year_month_opt: Option<String> = None;
        let mut year_opt: Option<String> = hive_year.clone();

        if let Some((year, month)) = find_year_month(file_stem) {
            year_opt = Some(year.clone());
            year_month_opt = Some(format!("{}-{}", year, month));
        } else if let Some(year) = find_year_4digits(file_stem) {
            if year_opt.is_none() {
                year_opt = Some(year.clone());
            }
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

        let final_year = year_opt.unwrap_or_default();
        let final_ym = year_month_opt.unwrap_or_else(|| file_stem.to_string());
        (final_year, final_ym)
    };

    // 3. ブローカー名の検出
    let broker = if let Some(hb) = hive_broker {
        if hb.eq_ignore_ascii_case("oanda") {
            "OANDA".to_string()
        } else if hb.eq_ignore_ascii_case("ducascopy") || hb.eq_ignore_ascii_case("dukascopy") {
            "Ducascopy".to_string()
        } else {
            hb
        }
    } else {
        let mut broker_opt: Option<String> = None;
        let mut curr = path.parent();
        let mut depth = 0;
        while let Some(dir) = curr {
            depth += 1;
            if root_dir.as_os_str().is_empty() && depth > 2 {
                break;
            }
            if let Some(dname) = dir.file_name().and_then(|s| s.to_str()) {
                let trimmed = dname.trim();
                let upper = trimmed.to_uppercase();

                let is_pair = KNOWN_PAIRS.iter().any(|&kp| kp == upper) || upper == pair;
                let is_year = find_year_4digits(trimmed).map(|y| y == trimmed).unwrap_or(false);
                let is_system_dir = upper == "TICK"
                    || upper == "TICKDATA"
                    || upper == "TICKS"
                    || upper == "DATA"
                    || upper == "IMPORTS"
                    || upper == "MQL5"
                    || upper == "FILES"
                    || upper == "TEMP"
                    || upper == "TMP"
                    || upper == "APPDATA"
                    || upper == "LOCAL"
                    || upper == "USERS"
                    || upper == "SRC_ZIPS"
                    || upper == "OUT_PARQUETS"
                    || upper.contains("TEST");

                if !is_pair && !is_year && !is_system_dir && !trimmed.is_empty() && !upper.starts_with("BROKER=") && !upper.starts_with("SYMBOL=") && !upper.starts_with("YEAR=") && !upper.starts_with("MONTH=") {
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
                let is_system_dir = upper == "TICK"
                    || upper == "TICKDATA"
                    || upper == "TICKS"
                    || upper == "DATA"
                    || upper == "IMPORTS"
                    || upper == "MQL5"
                    || upper == "FILES"
                    || upper == "TEMP"
                    || upper == "TMP"
                    || upper == "APPDATA"
                    || upper == "LOCAL"
                    || upper == "USERS"
                    || upper == "SRC_ZIPS"
                    || upper == "OUT_PARQUETS"
                    || upper.contains("TEST");

                if !is_pair && !is_year && !is_system_dir && !trimmed.is_empty() && !upper.starts_with("BROKER=") && !upper.starts_with("SYMBOL=") && !upper.starts_with("YEAR=") && !upper.starts_with("MONTH=") {
                    broker_opt = Some(trimmed.to_string());
                }
            }
        }

        broker_opt.unwrap_or_else(|| "Custom".to_string())
    };

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
    let mut manifest = ImportManifest::load_from_dir(config_dir);

    // MT5のシンボルリストが取得できている場合、MT5側で削除されたシンボルをマニフェストからクリーンアップ
    if !existing_mt5_symbols.is_empty() {
        let mut manifest_changed = false;
        manifest.imported_months.retain(|sym, _| {
            let exists = existing_mt5_symbols.iter().any(|s| s.eq_ignore_ascii_case(sym));
            if !exists {
                manifest_changed = true;
            }
            exists
        });
        let old_len = manifest.custom_symbols.len();
        manifest.custom_symbols.retain(|sym| {
            existing_mt5_symbols.iter().any(|s| s.eq_ignore_ascii_case(sym))
        });
        if manifest.custom_symbols.len() != old_len {
            manifest_changed = true;
        }
        if manifest_changed {
            let _ = manifest.save_to_dir(config_dir);
        }
    }

    // Key: (broker, pair, year, suggested_symbol_name, group_path)
    let mut final_map: HashMap<(String, String, String, String, String), Vec<ScannedZipFile>> = HashMap::new();
    walk_dir_collect(root_dir, root_dir, &mut final_map, &manifest);

    let mut result = Vec::new();
    for ((broker, pair, year, suggested_symbol_name, group_path), mut files) in final_map {
        files.sort_by(|a, b| a.year_month.cmp(&b.year_month));
        let already_exists_in_mt5 = existing_mt5_symbols
            .iter()
            .any(|s| s.eq_ignore_ascii_case(&suggested_symbol_name));

        // MT5にシンボルが存在しない場合は、マニフェストに関わらず未インポート扱いにする
        if !already_exists_in_mt5 && !existing_mt5_symbols.is_empty() {
            for f in &mut files {
                f.already_imported = false;
            }
        }

        let category = if !broker.eq_ignore_ascii_case("custom") {
            broker.clone()
        } else if !year.is_empty() {
            year.clone()
        } else {
            "Custom".to_string()
        };

        result.push(ScannedPairGroup {
            category,
            broker,
            year,
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

/// Drenhis 側の設定または標準パスからティックデータのデフォルトディレクトリを取得する
pub fn get_default_tick_dir() -> std::path::PathBuf {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let conf_path = std::path::PathBuf::from(&local_app_data)
            .join("com.drenhis.app")
            .join("tick_export_config.json");
        if conf_path.exists() {
            if let Ok(content) = fs::read_to_string(&conf_path) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(dir) = val.get("output_dir").and_then(|v| v.as_str()) {
                        let p = std::path::PathBuf::from(dir);
                        let tick_p = p.join("tick");
                        if tick_p.exists() {
                            return tick_p;
                        } else if p.exists() {
                            return p;
                        }
                    }
                }
            }
        }
    }
    let drehis_tick = std::path::PathBuf::from(r"D:\Drehis\tick");
    if drehis_tick.exists() {
        return drehis_tick;
    }
    let drehis = std::path::PathBuf::from(r"D:\Drehis");
    if drehis.exists() {
        return drehis;
    }
    let tick_data = std::path::PathBuf::from(r"D:\TickData");
    if tick_data.exists() {
        return tick_data;
    }
    std::path::PathBuf::from(r"D:\Drehis\tick")
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
            } else if path.is_file() {
                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
                let is_parquet = ext.eq_ignore_ascii_case("parquet");
                let is_zip = ext.eq_ignore_ascii_case("zip");

                if is_parquet || is_zip {
                    let file_type = if is_parquet { "parquet".to_string() } else { "zip".to_string() };
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
                            file_type,
                        });
                    }
                }
            }
        }
    }
}

/// 1ヶ月分の Parquet (Drenhis tick出力) からデータを読み込み、疑似DMMパイプラインを適用して .bin ファイルとして出力する
pub fn convert_parquet_to_mql_bin(
    parquet_path: &Path,
    output_bin_path: &Path,
) -> Result<usize, AppError> {
    let file = File::open(parquet_path)?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file)
        .map_err(|e| AppError::Config(format!("Parquetオープン失敗 '{}': {}", parquet_path.display(), e)))?;

    let parsed_info = analyze_zip_path(parquet_path, Path::new(""));
    let pair = parsed_info.as_ref().map(|p| p.pair.as_str()).unwrap_or("USDJPY");
    let ym = parsed_info.as_ref().map(|p| p.year_month.as_str()).unwrap_or("2026-08");

    let mut pseudo_dmm = crate::pseudo_dmm::PseudoDmmEngine::new(pair, ym);

    // カラムプロジェクション: mt5_ms, utc_ms, bid, ask のみ抽出
    let file_schema = builder.schema();
    let wanted_cols = ["mt5_ms", "utc_ms", "bid", "ask"];
    let mut root_indices = Vec::new();
    for (idx, field) in file_schema.fields().iter().enumerate() {
        if wanted_cols.iter().any(|&c| c.eq_ignore_ascii_case(field.name())) {
            root_indices.push(idx);
        }
    }

    let builder = if !root_indices.is_empty() {
        let mask = ProjectionMask::roots(
            builder.parquet_schema(),
            root_indices,
        );
        builder.with_projection(mask)
    } else {
        builder
    };

    let mut reader = builder.build()
        .map_err(|e| AppError::Config(format!("Parquetリーダー生成エラー: {}", e)))?;

    let mut ticks: Vec<MqlTick> = Vec::new();

    while let Some(Ok(batch)) = reader.next() {
        let schema = batch.schema();
        let mt5_ms_idx = schema.index_of("mt5_ms").ok();
        let utc_ms_idx = schema.index_of("utc_ms").ok();
        let bid_idx = schema.index_of("bid").ok();
        let ask_idx = schema.index_of("ask").ok();

        let (Some(b_idx), Some(a_idx)) = (bid_idx, ask_idx) else {
            continue;
        };

        let bid_col = batch.column(b_idx).as_any().downcast_ref::<Float64Array>();
        let ask_col = batch.column(a_idx).as_any().downcast_ref::<Float64Array>();
        let mt5_col = mt5_ms_idx.and_then(|i| batch.column(i).as_any().downcast_ref::<Int64Array>());
        let utc_col = utc_ms_idx.and_then(|i| batch.column(i).as_any().downcast_ref::<Int64Array>());

        let (Some(b_arr), Some(a_arr)) = (bid_col, ask_col) else {
            continue;
        };

        for row in 0..batch.num_rows() {
            let bid = b_arr.value(row);
            let ask = a_arr.value(row);

            let time_msc = if let Some(m_arr) = mt5_col {
                m_arr.value(row)
            } else if let Some(u_arr) = utc_col {
                let utc_ms = u_arr.value(row);
                let utc_sec = utc_ms / 1000;
                let dt = chrono::DateTime::from_timestamp(utc_sec, 0)
                    .map(|d| d.naive_utc())
                    .unwrap_or_default();
                let is_dst = crate::pseudo_dmm::PseudoDmmEngine::is_us_dst(dt.year(), dt.month(), dt.day(), dt.hour());
                let offset = if is_dst { 3 * 3600 * 1000 } else { 2 * 3600 * 1000 };
                utc_ms + offset
            } else {
                continue;
            };

            let time_sec = time_msc / 1000;

            if let Some((dmm_bid, dmm_ask, _)) = pseudo_dmm.process_tick(time_msc, bid, ask) {
                ticks.push(MqlTick {
                    time: time_sec,
                    bid: dmm_bid,
                    ask: dmm_ask,
                    last: 0.0,
                    volume: 0,
                    time_msc,
                    flags: 6,
                    volume_real: 0.0,
                });
            }
        }
    }

    if ticks.is_empty() {
        return Err(AppError::Config("有効なティックデータが見つかりませんでした".to_string()));
    }

    ticks.sort_by_key(|t| t.time_msc);

    if let Some(parent) = output_bin_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let tick_count = ticks.len();
    let byte_slice: &[u8] = bytemuck::cast_slice(&ticks);
    fs::write(output_bin_path, byte_slice)?;

    Ok(tick_count)
}

/// 1ヶ月分の ZIP(CSV) または Parquet からデータを読み込み、.bin ファイルとして出力する
pub fn convert_zip_to_mql_bin(
    input_path: &Path,
    output_bin_path: &Path,
) -> Result<usize, AppError> {
    let is_parquet = input_path.extension().and_then(|s| s.to_str()).map(|e| e.eq_ignore_ascii_case("parquet")) == Some(true);
    if is_parquet {
        return convert_parquet_to_mql_bin(input_path, output_bin_path);
    }
    let file = File::open(input_path)?;
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

    let parsed_info = analyze_zip_path(input_path, Path::new(""));
    let pair = parsed_info.as_ref().map(|p| p.pair.as_str()).unwrap_or("USDJPY");
    let ym = parsed_info.as_ref().map(|p| p.year_month.as_str()).unwrap_or("2026-08");

    let mut pseudo_dmm = crate::pseudo_dmm::PseudoDmmEngine::new(pair, ym);

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

        // 疑似DMM 4層レート生成パイプラインの適用
        if let Some((dmm_bid, dmm_ask, _)) = pseudo_dmm.process_tick(time_msc, bid, ask) {
            ticks.push(MqlTick {
                time: time_sec,
                bid: dmm_bid,
                ask: dmm_ask,
                last: 0.0,
                volume: 0,
                time_msc,
                flags: 6,
                volume_real: 0.0,
            });
        }
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

        // パターン4: Hiveパーティション形式 (broker=oanda, symbol=eurjpy, year=2016, month=09)
        let p4 = PathBuf::from("D:\\TickData\\broker=oanda\\symbol=eurjpy\\year=2016\\month=09\\ticks_EURJPY-oj5k_2016-09.zip");
        let res4 = analyze_zip_path(&p4, &root).unwrap();
        assert_eq!(res4.pair, "EURJPY");
        assert_eq!(res4.broker, "OANDA");
        assert_eq!(res4.year, "2016");
        assert_eq!(res4.year_month, "2016-09");
        assert_eq!(res4.suggested_symbol_name, "EURJPY_OANDA_2016");
        assert_eq!(res4.group_path, "Custom/OANDA");
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

    #[test]
    fn test_manifest_cleanup_when_symbol_deleted_in_mt5() {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("tick_test_{}", timestamp));
        let _ = fs::create_dir_all(&temp_dir);

        let mut manifest = ImportManifest::default();
        manifest.mark_imported("USDJPY_OANDA_2025", "2025-01");
        manifest.mark_imported("EURUSD_OANDA_2025", "2025-01");
        let _ = manifest.save_to_dir(&temp_dir);

        // MT5には EURUSD_OANDA_2025 のみ存在（USDJPY_OANDA_2025 は削除済み）
        let existing_symbols = vec!["EURUSD_OANDA_2025".to_string(), "USDJPY".to_string()];

        let root_dir = temp_dir.join("ticks");
        let _ = fs::create_dir_all(&root_dir);

        let result = scan_directory_for_ticks(&root_dir, &temp_dir, &existing_symbols).unwrap();
        assert_eq!(result.len(), 0);

        // クリーンアップ後のマニフェストを再確認
        let loaded = ImportManifest::load_from_dir(&temp_dir);
        assert!(!loaded.is_imported("USDJPY_OANDA_2025", "2025-01"));
        assert!(loaded.is_imported("EURUSD_OANDA_2025", "2025-01"));
        assert!(!loaded.custom_symbols.contains(&"USDJPY_OANDA_2025".to_string()));
        assert!(loaded.custom_symbols.contains(&"EURUSD_OANDA_2025".to_string()));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_convert_parquet_to_mql_bin() {
        use arrow::datatypes::{DataType, Field, Schema};
        use arrow::record_batch::RecordBatch;
        use parquet::arrow::ArrowWriter;
        use parquet::file::properties::WriterProperties;
        use std::sync::Arc;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("parquet_bin_test_{}", timestamp));
        let _ = fs::create_dir_all(&temp_dir);

        let schema = Arc::new(Schema::new(vec![
            Field::new("utc_ms", DataType::Int64, false),
            Field::new("mt5_ms", DataType::Int64, false),
            Field::new("bid", DataType::Float64, false),
            Field::new("ask", DataType::Float64, false),
        ]));

        let utc_arr = Arc::new(Int64Array::from(vec![1722470400000, 1722470401000]));
        let mt5_arr = Arc::new(Int64Array::from(vec![1722481200000, 1722481201000]));
        let bid_arr = Arc::new(Float64Array::from(vec![150.100, 150.105]));
        let ask_arr = Arc::new(Float64Array::from(vec![150.108, 150.112]));

        let batch = RecordBatch::try_new(schema.clone(), vec![utc_arr, mt5_arr, bid_arr, ask_arr]).unwrap();
        let parquet_path = temp_dir.join("data.parquet");
        let file = File::create(&parquet_path).unwrap();
        let props = WriterProperties::builder()
            .set_compression(parquet::basic::Compression::ZSTD(parquet::basic::ZstdLevel::default()))
            .build();
        let mut writer = ArrowWriter::try_new(file, schema.clone(), Some(props)).unwrap();
        writer.write(&batch).unwrap();
        writer.close().unwrap();

        let bin_path = temp_dir.join("output.bin");
        let count = convert_parquet_to_mql_bin(&parquet_path, &bin_path).unwrap();
        assert!(count > 0);
        assert!(bin_path.exists());

        let bin_bytes = fs::read(&bin_path).unwrap();
        assert_eq!(bin_bytes.len(), count * std::mem::size_of::<MqlTick>());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_get_default_tick_dir() {
        let dir = get_default_tick_dir();
        assert!(!dir.to_string_lossy().is_empty());
    }
}


