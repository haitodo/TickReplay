use std::collections::HashMap;
use std::fs::File;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use chrono::{Datelike, Timelike, Weekday};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use arrow::array::{StringArray, Int64Array};

/// 指標プロファイル定義（辞書からロード）
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IndicatorProfile {
    pub currency: String,
    pub event_name: String,
    pub importance: String,
    pub tier: u8,
    pub dmm_advance_seconds: i64,
    pub dmm_base_pre_spread: f64,
    pub dmm_base_peak_spread: f64,
    pub dmm_recovery_seconds: i64,
}

/// メモリ内で高速参照するための経済指標イベント
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EconomicEvent {
    pub event_id: i64,
    pub utc_ms: i64,
    pub mt5_ms: i64,
    pub currency: String,
    pub event_name: String,
    pub importance: String,
    pub tier: u8,
    pub advance_ms: i64,
    pub base_pre_spread: f64,
    pub base_peak_spread: f64,
    pub recovery_ms: i64,
}

/// DMM クォーティング特性 (実測統計から導出)
pub mod dmm_characteristics {
    /// DMMの最小価格変動ステップ (0.1pip = 0.001)
    pub const PRICE_STEP: f64 = 0.001;

    /// デッドバンド閾値: この範囲内の微小変動は直前のクォート価格を維持
    pub const DEADBAND_THRESHOLD: f64 = 0.0005;

    /// EMA 平滑化係数 (α): OANDA高周波ノイズを抑制
    pub const EMA_ALPHA: f64 = 0.15;

    /// 時間帯別の目標ティック/秒 (JST 00〜23時 / 2026年9月最新DMM実測統計準拠)
    pub const TPS_BY_JST_HOUR: [f64; 24] = [
        5.10, 4.83, 4.55, 4.81, // 00-03 (オセアニア・深夜)
        4.63, 3.40, 2.93, 2.79, // 04-07 (早朝閑散・ロールオーバー帯)
        4.05, 4.63, 4.54, 3.92, // 08-11 (東京セッション・仲値)
        3.53, 3.64, 3.96, 5.01, // 12-15 (東京午後〜欧州プレ)
        4.91, 5.17, 4.40, 4.46, // 16-19 (ロンドン市場コア)
        4.82, 5.80, 5.78, 5.51, // 20-23 (NYオープン・米指標・最大ピーク)
    ];
}

/// 疑似DMMレート生成エンジン（4層パイプライン）
pub struct PseudoDmmEngine {
    pub symbol: String,
    pub year: i32,
    pub month: u32,
    pub events: Vec<EconomicEvent>,
    // Layer 4: クォート間引き用ステート
    last_emitted_msc: i64,
    last_emitted_mid: f64,
    last_emitted_spread: f64,
    // Layer 3: 直近10秒間のプライスボラティリティ追跡 (mt5_ms, mid)
    recent_ticks: Vec<(i64, f64)>,
    // DMM クォーティング特性再現用ステート
    ema_mid: f64,
    last_quantized_mid: f64,
}

impl PseudoDmmEngine {
    /// 新しいエンジンインスタンスを生成
    pub fn new(symbol: &str, year_month: &str) -> Self {
        Self::new_with_custom_dir(symbol, year_month, None)
    }

    /// 経済指標フォルダーを明示指定して新しいエンジンインスタンスを生成
    pub fn new_with_custom_dir(symbol: &str, year_month: &str, custom_dir: Option<&str>) -> Self {
        let parts: Vec<&str> = year_month.split('-').collect();
        let year: i32 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(2026);
        let month: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(8);

        let profiles = Self::load_profile_matrix();
        let events = Self::load_events_for_month(symbol, year, month, &profiles, custom_dir);

        Self {
            symbol: symbol.to_uppercase(),
            year,
            month,
            events,
            last_emitted_msc: 0,
            last_emitted_mid: 0.0,
            last_emitted_spread: 0.002,
            recent_ticks: Vec::with_capacity(500),
            ema_mid: 0.0,
            last_quantized_mid: 0.0,
        }
    }

    /// プロファイル辞書をロード（見つからない場合は埋め込みJSONまたは主要指標のデフォルトをフォールバック）
    pub fn load_profile_matrix() -> HashMap<String, IndicatorProfile> {
        let possible_paths = [
            PathBuf::from("analysis/scripts/indicator_profile_matrix.json"),
            PathBuf::from("../analysis/scripts/indicator_profile_matrix.json"),
            PathBuf::from("../../analysis/scripts/indicator_profile_matrix.json"),
            PathBuf::from("data/analysis/indicator_profile_matrix.json"),
            PathBuf::from("../data/analysis/indicator_profile_matrix.json"),
            PathBuf::from(r"D:\dev\TickReplay\analysis\scripts\indicator_profile_matrix.json"),
            PathBuf::from(r"D:\dev\TickReplay\data\analysis\indicator_profile_matrix.json"),
            PathBuf::from(r"D:\dev\Drenhis\analysis\scripts\indicator_profile_matrix.json"),
            PathBuf::from(r"D:\dev\Drenhis\analysis\indicator_profile_matrix.json"),
        ];

        for p in &possible_paths {
            if p.exists() {
                if let Ok(content) = std::fs::read_to_string(p) {
                    if let Ok(map) = serde_json::from_str::<HashMap<String, IndicatorProfile>>(&content) {
                        return map;
                    }
                }
            }
        }

        // ビルトイン埋め込みJSONからのロード（リリースビルド・ポータブル実行用）
        const EMBEDDED_PROFILE_MATRIX_JSON: &str = include_str!("../../analysis/scripts/indicator_profile_matrix.json");
        if let Ok(map) = serde_json::from_str::<HashMap<String, IndicatorProfile>>(EMBEDDED_PROFILE_MATRIX_JSON) {
            return map;
        }

        // デフォルトフォールバック (2026年9月実測データ: 雇用統計/CPI収束時間約120秒準拠)
        let mut map = HashMap::new();
        map.insert("USD:非農業部門雇用者数".to_string(), IndicatorProfile {
            currency: "USD".to_string(),
            event_name: "非農業部門雇用者数".to_string(),
            importance: "high".to_string(),
            tier: 1,
            dmm_advance_seconds: 35,
            dmm_base_pre_spread: 0.039,
            dmm_base_peak_spread: 0.156,
            dmm_recovery_seconds: 120,
        });
        map.insert("USD:CPI".to_string(), IndicatorProfile {
            currency: "USD".to_string(),
            event_name: "CPI".to_string(),
            importance: "high".to_string(),
            tier: 1,
            dmm_advance_seconds: 35,
            dmm_base_pre_spread: 0.039,
            dmm_base_peak_spread: 0.156,
            dmm_recovery_seconds: 120,
        });
        map.insert("USD:Fed金利決定".to_string(), IndicatorProfile {
            currency: "USD".to_string(),
            event_name: "Fed金利決定".to_string(),
            importance: "high".to_string(),
            tier: 1,
            dmm_advance_seconds: 35,
            dmm_base_pre_spread: 0.039,
            dmm_base_peak_spread: 0.156,
            dmm_recovery_seconds: 120,
        });
        map
    }

    /// Drenhis 側の設定または標準パスから経済指標データのデフォルトディレクトリを取得する
    pub fn get_drenhis_export_dir() -> PathBuf {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let conf_path = PathBuf::from(local_app_data)
                .join("com.drenhis.app")
                .join("economic_export_config.json");
            if conf_path.exists() {
                if let Ok(content) = std::fs::read_to_string(conf_path) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(dir) = val.get("export_dir").and_then(|v| v.as_str()) {
                            let p = PathBuf::from(dir);
                            let econ_p = p.join("economic");
                            if econ_p.exists() {
                                return econ_p;
                            } else if p.exists() {
                                return p;
                            }
                        }
                    }
                }
            }
        }
        // 設定がない場合のローカル既知パス優先チェック
        let drehis_econ = PathBuf::from(r"D:\Drehis\economic");
        if drehis_econ.exists() {
            return drehis_econ;
        }
        let drehis = PathBuf::from(r"D:\Drehis");
        if drehis.exists() {
            return drehis;
        }
        PathBuf::from(r"D:\Drehis\economic")
    }

    /// 当月の経済指標イベントを Parquet から読み込む
    pub fn load_events_for_month(
        symbol: &str,
        year: i32,
        month: u32,
        profiles: &HashMap<String, IndicatorProfile>,
        custom_dir: Option<&str>,
    ) -> Vec<EconomicEvent> {
        let sym_lower = symbol.to_lowercase();
        let month_str = format!("{:02}", month);

        // 1. 指定パス または Drenhis設定パスを直接取得
        let base_dir = match custom_dir {
            Some(dir) => PathBuf::from(dir),
            None => Self::get_drenhis_export_dir(),
        };

        let sym_folder = format!("symbol={}", sym_lower);
        let possible_parquet_paths = [
            base_dir.join("economic").join(&sym_folder).join(format!("year={}", year)).join(format!("month={}", month_str)).join("events.parquet"),
            base_dir.join("economic").join(&sym_folder).join(format!("year={}", year)).join(format!("month={}", month_str)).join("data.parquet"),
            base_dir.join(&sym_folder).join(format!("year={}", year)).join(format!("month={}", month_str)).join("events.parquet"),
            base_dir.join(&sym_folder).join(format!("year={}", year)).join(format!("month={}", month_str)).join("data.parquet"),
            // プロジェクト相対フォールバック
            PathBuf::from(format!("data/economic/{}/year={}/month={}/events.parquet", sym_folder, year, month_str)),
            PathBuf::from(format!("../data/economic/{}/year={}/month={}/events.parquet", sym_folder, year, month_str)),
        ];

        for path in &possible_parquet_paths {
            if path.exists() {
                if let Ok(file) = File::open(path) {
                    if let Ok(builder) = ParquetRecordBatchReaderBuilder::try_new(file) {
                        let file_schema = builder.schema();
                        let wanted_cols = ["event_id", "utc_ms", "mt5_ms", "currency", "event_name", "importance"];
                        let mut root_indices = Vec::new();
                        for (idx, field) in file_schema.fields().iter().enumerate() {
                            if wanted_cols.iter().any(|&c| c.eq_ignore_ascii_case(field.name())) {
                                root_indices.push(idx);
                            }
                        }

                        let builder = if !root_indices.is_empty() {
                            let mask = parquet::arrow::ProjectionMask::roots(
                                builder.parquet_schema(),
                                root_indices,
                            );
                            builder.with_projection(mask)
                        } else {
                            builder
                        };

                        if let Ok(mut reader) = builder.build() {
                            let mut events = Vec::new();
                            while let Some(Ok(batch)) = reader.next() {
                                let schema = batch.schema();
                                let event_id_idx = schema.index_of("event_id").ok();
                                let utc_ms_idx = schema.index_of("utc_ms").ok();
                                let mt5_ms_idx = schema.index_of("mt5_ms").ok();
                                let ccy_idx = schema.index_of("currency").ok();
                                let name_idx = schema.index_of("event_name").ok();
                                let imp_idx = schema.index_of("importance").ok();

                                if let (Some(u_idx), Some(c_idx), Some(n_idx)) = (utc_ms_idx, ccy_idx, name_idx) {
                                    let utc_col = batch.column(u_idx).as_any().downcast_ref::<Int64Array>();
                                    let mt5_col = mt5_ms_idx.and_then(|i| batch.column(i).as_any().downcast_ref::<Int64Array>());
                                    let ccy_col = batch.column(c_idx).as_any().downcast_ref::<StringArray>();
                                    let name_col = batch.column(n_idx).as_any().downcast_ref::<StringArray>();
                                    let id_col = event_id_idx.and_then(|i| batch.column(i).as_any().downcast_ref::<Int64Array>());
                                    let imp_col = imp_idx.and_then(|i| batch.column(i).as_any().downcast_ref::<StringArray>());

                                    if let (Some(u_arr), Some(c_arr), Some(n_arr)) = (utc_col, ccy_col, name_col) {
                                        for row in 0..batch.num_rows() {
                                            let utc_ms = u_arr.value(row);
                                            let mt5_ms = if let Some(m_arr) = mt5_col {
                                                m_arr.value(row)
                                            } else {
                                                let utc_sec = utc_ms / 1000;
                                                let dt = chrono::DateTime::from_timestamp(utc_sec, 0)
                                                    .map(|d| d.naive_utc())
                                                    .unwrap_or_default();
                                                let is_dst = Self::is_us_dst(dt.year(), dt.month(), dt.day(), dt.hour());
                                                let offset = if is_dst { 3 * 3600 * 1000 } else { 2 * 3600 * 1000 };
                                                utc_ms + offset
                                            };
                                            let ccy = c_arr.value(row).to_string();
                                            let name = n_arr.value(row).to_string();
                                            let event_id = id_col.map(|arr| arr.value(row)).unwrap_or(0);
                                            let imp = imp_col.map(|arr| arr.value(row).to_string()).unwrap_or_else(|| "none".to_string());

                                            let profile_key = format!("{}:{}", ccy, name);
                                            let (tier, adv_s, pre_s, peak_s, mut rec_s) = if let Some(p) = profiles.get(&profile_key) {
                                                (p.tier, p.dmm_advance_seconds, p.dmm_base_pre_spread, p.dmm_base_peak_spread, p.dmm_recovery_seconds)
                                            } else {
                                                let name_l = name.to_lowercase();
                                                let is_tier1 = (name_l.contains("cpi") && !name_l.contains("コア"))
                                                    || name.contains("非農業") || name.contains("雇用者数")
                                                    || name_l.contains("nfp") || name_l.contains("fomc")
                                                    || name_l.contains("fed");
                                                if is_tier1 {
                                                    (1, 35, 0.039, 0.156, 120)
                                                } else {
                                                    match imp.as_str() {
                                                        "high" => (2, 25, 0.025, 0.060, 80),
                                                        "medium" => (3, 15, 0.012, 0.025, 35),
                                                        _ => (4, 0, 0.002, 0.002, 0),
                                                    }
                                                }
                                            };

                                            // 2026年9月実測検証準拠: 重要指標の収束時間最適化クランプ
                                            if tier == 1 {
                                                rec_s = rec_s.max(120);
                                            } else if tier == 2 {
                                                rec_s = rec_s.max(80);
                                            }

                                            events.push(EconomicEvent {
                                                event_id,
                                                utc_ms,
                                                mt5_ms,
                                                currency: ccy,
                                                event_name: name,
                                                importance: imp,
                                                tier,
                                                advance_ms: adv_s * 1000,
                                                base_pre_spread: pre_s,
                                                base_peak_spread: peak_s,
                                                recovery_ms: rec_s * 1000,
                                            });
                                        }
                                    }
                                }
                            }

                            events.sort_by_key(|e| e.mt5_ms);
                            return events;
                        }
                    }
                }
            }
        }

        Vec::new()
    }

    /// 米国夏時間 (US DST) 判定 (3月第2日曜日 02:00 〜 11月第1日曜日 02:00)
    #[inline]
    pub fn is_us_dst(year: i32, month: u32, day: u32, hour: u32) -> bool {
        if !(3..=11).contains(&month) {
            return false;
        }
        if month > 3 && month < 11 {
            return true;
        }

        // 3月: 第2日曜日 02:00 から夏時間
        if month == 3 {
            // 3月1日の曜日 (1=Mon, 7=Sun)
            let march1_w = chrono::NaiveDate::from_ymd_opt(year, 3, 1)
                .map(|d| d.weekday().number_from_monday())
                .unwrap_or(1);
            let first_sun = 1 + (7 - (march1_w % 7)) % 7;
            let second_sun = first_sun + 7;
            if day > second_sun {
                return true;
            } else if day == second_sun {
                return hour >= 2;
            } else {
                return false;
            }
        }

        // 11月: 第1日曜日 02:00 に冬時間へ戻る
        if month == 11 {
            let nov1_w = chrono::NaiveDate::from_ymd_opt(year, 11, 1)
                .map(|d| d.weekday().number_from_monday())
                .unwrap_or(1);
            let first_sun = 1 + (7 - (nov1_w % 7)) % 7;
            if day < first_sun {
                return true;
            } else if day == first_sun {
                return hour < 2;
            } else {
                return false;
            }
        }

        false
    }

    /// 実質ゴトー日判定（平日5の倍数、週末前倒し金曜日、月末営業日）
    pub fn is_effective_gotobi(year: i32, month: u32, day: u32, wday: Weekday) -> bool {
        // 1. 平日の 5, 10, 15, 20, 25, 30日
        if day.is_multiple_of(5) && wday != Weekday::Sat && wday != Weekday::Sun {
            return true;
        }

        // 2. 金曜日の前倒しゴトー日（土曜が5の倍数、または日曜が5の倍数）
        if wday == Weekday::Fri {
            let sat_day = day + 1;
            let sun_day = day + 2;
            if sat_day.is_multiple_of(5) || sun_day.is_multiple_of(5) {
                return true;
            }
            // 月末金曜日（土日が月末跨ぎ）
            let days_in_month = match month {
                1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                4 | 6 | 9 | 11 => 30,
                2 => if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) { 29 } else { 28 },
                _ => 30,
            };
            if day == days_in_month || day + 1 == days_in_month || day + 2 == days_in_month {
                return true;
            }
        }

        // 3. 平日の月末最終日（28, 29, 31日）
        let days_in_month = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 => if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) { 29 } else { 28 },
            _ => 30,
        };
        if day == days_in_month && wday != Weekday::Sat && wday != Weekday::Sun {
            return true;
        }

        false
    }

    /// 単一ティックを4層パイプラインで疑似DMMレートに変換
    /// 間引き対象の場合は None を返す
    #[inline]
    pub fn process_tick(
        &mut self,
        mt5_time_msc: i64,
        raw_bid: f64,
        raw_ask: f64,
    ) -> Option<(f64, f64, f64)> {
        let raw_mid = (raw_bid + raw_ask) / 2.0;
        let raw_oanda_spread = (raw_ask - raw_bid).abs();

        // 1. 適応型EMA平滑化（平常時は0.15で高周波ノイズ抑制、急変時は動的に引き上げて即座に追従）
        if self.ema_mid == 0.0 {
            self.ema_mid = raw_mid;
            self.last_quantized_mid = (raw_mid * 1000.0).round() / 1000.0;
        } else {
            let diff = (raw_mid - self.ema_mid).abs();
            let dynamic_alpha = if diff > 0.010 {
                0.80 // 1pip以上の急変時は即座にジャンプ追従
            } else if diff > 0.003 {
                0.40 // 0.3pip以上の動意時は追従性をブースト
            } else {
                dmm_characteristics::EMA_ALPHA // 平常時は0.15で平滑化
            };
            self.ema_mid += dynamic_alpha * (raw_mid - self.ema_mid);
        }

        // 2. デッドバンド判定 ＆ 3. 0.001 (0.1pip) ステップ量子化
        let delta_from_last = (self.ema_mid - self.last_quantized_mid).abs();
        let mid = if delta_from_last >= dmm_characteristics::DEADBAND_THRESHOLD {
            let quantized = (self.ema_mid * 1000.0).round() / 1000.0;
            self.last_quantized_mid = quantized;
            quantized
        } else {
            self.last_quantized_mid
        };

        // MT5時刻から UTC ms および JST ms を計算
        let naive_mt5_sec = mt5_time_msc / 1000;
        let naive_dt = chrono::DateTime::from_timestamp(naive_mt5_sec, 0)
            .map(|dt| dt.naive_utc())
            .unwrap_or_default();
        
        let y = naive_dt.year();
        let m = naive_dt.month();
        let d = naive_dt.day();
        let h = naive_dt.hour();
        let is_dst = Self::is_us_dst(y, m, d, h);

        // MT5夏時間 = UTC+3 (オフセット3h), 冬時間 = UTC+2 (オフセット2h)
        let offset_ms = if is_dst { 3 * 3600 * 1000 } else { 2 * 3600 * 1000 };
        let utc_ms = mt5_time_msc - offset_ms;
        let jst_ms = utc_ms + 9 * 3600 * 1000;

        // JST 時刻情報の分解
        let jst_sec = jst_ms / 1000;
        let jst_dt = chrono::DateTime::from_timestamp(jst_sec, 0)
            .map(|dt| dt.naive_utc())
            .unwrap_or_default();
        let jst_hour = jst_dt.hour();
        let jst_min = jst_dt.minute();
        let jst_wday = jst_dt.weekday();
        let jst_day = jst_dt.day();

        // --- Layer 0: ベーススプレッド (DMM標準: 0.2銭) ---
        let mut target_spread = 0.002;

        // --- Layer 1: 仲値制御 (平日 9:53〜09:55:30 JST / 2026年最新実測データ準拠) ---
        if jst_wday != Weekday::Sat && jst_wday != Weekday::Sun
            && jst_hour == 9 {
                let is_gotobi = Self::is_effective_gotobi(y, m, jst_day, jst_wday);
                let jst_sec_of_min = jst_dt.second();

                let fixing_spread = if jst_min == 54 {
                    // 09:54:00〜09:54:59 (仲値直前ピーク): 通常 1.0銭 / 実質ゴトー日 1.2銭
                    if is_gotobi { 0.012 } else { 0.010 }
                } else if jst_min == 55 {
                    if jst_sec_of_min < 30 {
                        // 09:55:00〜09:55:29 (仲値通過): 通常 0.8銭 / 実質ゴトー日 1.0銭
                        if is_gotobi { 0.010 } else { 0.008 }
                    } else {
                        // 09:55:30〜09:55:59 (急減衰帯): 0.3銭
                        0.003
                    }
                } else if jst_min == 53 {
                    // 09:53:00〜09:53:59 (事前動意帯 / 実測平均0.0085): 0.8銭
                    0.008
                } else if (50..53).contains(&jst_min) {
                    0.004
                } else {
                    0.002
                };

                if fixing_spread > target_spread {
                    target_spread = fixing_spread;
                }
            }

        // --- Layer 2: 早朝ロールオーバー制御 (2026年9月最新実測分単位統計準拠) ---
        // 夏時間: 05:50〜07:15 JST (06:00ロールオーバー) / 冬時間: 06:50〜08:15 JST (07:00ロールオーバー)
        let rollover_hour = if is_dst { 6 } else { 7 };
        let pre_hour = rollover_hour - 1;

        if jst_hour == pre_hour {
            if jst_min == 59 {
                // ロールオーバー1分前直前拡大 (05:59 / 06:59): 実測平均3.81銭・中央値3.90銭
                let early_spread = 0.039;
                if early_spread > target_spread {
                    target_spread = early_spread;
                }
            } else if jst_min >= 55 {
                // ロールオーバー5〜2分前先行微増 (05:55〜05:58): 実測0.20銭〜0.50銭
                let progress = (jst_min - 55) as f64 / 4.0;
                let early_spread = 0.002 + 0.003 * progress;
                if early_spread > target_spread {
                    target_spread = early_spread;
                }
            }
        } else if jst_hour == rollover_hour {
            let early_spread = if jst_min <= 5 {
                0.120 // ロールオーバー直後スパイク (06:00〜06:05: 実測平均10.0〜12.3銭 / 最大12.9銭)
            } else if jst_min <= 9 {
                0.090 // スパイク後段 (06:06〜06:09: 実測平均8.7〜11.5銭)
            } else if jst_min <= 15 {
                0.050 // スパイク減衰帯 (06:10〜06:15: 実測平均4.3〜6.1銭 / 中央値3.9銭)
            } else {
                0.039 // 早朝ワイドスプレッド安定帯 (06:16〜06:59: 実測中央値・P90ともに厳密に3.9銭)
            };
            if early_spread > target_spread {
                target_spread = early_spread;
            }
        } else if jst_hour == rollover_hour + 1 && jst_min < 10 {
            // 早朝残存固定帯 (07:00〜07:09 / 08:00〜08:09): 実測最頻値・中央値・P90すべて3.5銭厳密固定
            let early_spread = 0.035;
            if early_spread > target_spread {
                target_spread = early_spread;
            }
        } else if jst_hour == rollover_hour + 1 && jst_min < 15 {
            // 復帰急減衰帯 (07:10〜07:14 / 08:10〜08:14): 3.5銭から0.2銭へ急減衰 (実測07:10中央値0.2銭/平均0.48銭)
            let progress = (jst_min - 10) as f64 / 5.0;
            let early_spread = 0.008 - (0.008 - 0.002) * progress;
            if early_spread > target_spread {
                target_spread = early_spread;
            }
        }

        // --- Layer 3: 経済指標動的制御 (MT5サーバー時間で直接照合) ---
        // 直近10秒間のティック履歴を更新（10秒以上古いものは削除）
        let cutoff_10s = mt5_time_msc - 10000;
        self.recent_ticks.retain(|&(t, _)| t >= cutoff_10s);
        self.recent_ticks.push((mt5_time_msc, mid));

        // 直近10秒間の値幅 (pips)
        let mut min_mid_10s = mid;
        let mut max_mid_10s = mid;
        for &(_, p) in &self.recent_ticks {
            if p < min_mid_10s { min_mid_10s = p; }
            if p > max_mid_10s { max_mid_10s = p; }
        }
        let price_volatility_10s_pips = (max_mid_10s - min_mid_10s) * 100.0;

        // アクティブな指標ウィンドウを検索
        for ev in &self.events {
            let t_start = ev.mt5_ms - ev.advance_ms;
            let t_end = ev.mt5_ms + ev.recovery_ms;

            if mt5_time_msc >= t_start && mt5_time_msc <= t_end {
                let indicator_spread = if mt5_time_msc < ev.mt5_ms {
                    // 事前拡大フェーズ (T - advance 〜 T)
                    let rel_sec = (mt5_time_msc - ev.mt5_ms) as f64 / 1000.0;
                    if ev.tier == 1 {
                        // Tier 1 (NFP, CPI): -35s〜-15s (0.002->0.039), -15s〜-5s (0.039->0.069), -5s〜0s (0.069->0.096)
                        if rel_sec < -15.0 {
                            0.002 + (0.039 - 0.002) * ((rel_sec + 35.0) / 20.0).max(0.0)
                        } else if rel_sec < -5.0 {
                            0.039 + (0.069 - 0.039) * ((rel_sec + 15.0) / 10.0)
                        } else {
                            0.069 + (0.096 - 0.069) * ((rel_sec + 5.0) / 5.0)
                        }
                    } else if ev.tier == 2 {
                        // Tier 2 (ISM, Retail, PPI): -25s〜-5s (0.002->0.035), -5s〜0s (0.035->0.050)
                        if rel_sec < -5.0 {
                            0.002 + (0.035 - 0.002) * ((rel_sec + 25.0) / 20.0).max(0.0)
                        } else {
                            0.035 + (0.050 - 0.035) * ((rel_sec + 5.0) / 5.0)
                        }
                    } else {
                        let progress = (mt5_time_msc - t_start) as f64 / (ev.advance_ms as f64).max(1.0);
                        0.002 + (ev.base_pre_spread - 0.002) * progress
                    }
                } else if mt5_time_msc <= ev.mt5_ms + 10000 {
                    // 初動・ピークフェーズ (T 〜 T+10s): 瞬間スパイク＆ボラティリティ連動
                    let oanda_excess = (raw_oanda_spread - 0.004).max(0.0);
                    let max_cap = if ev.tier == 1 { 0.156 } else if ev.tier == 2 { 0.080 } else { 0.035 };
                    let dyn_spread = ev.base_peak_spread + 0.35 * oanda_excess + 0.05 * price_volatility_10s_pips;
                    dyn_spread.min(max_cap)
                } else {
                    // 収束フェーズ (T+10s 〜 T+recovery): 2026年9月実測検証準拠の2次減衰
                    // T+10s初動通過後の実測ベース水準 (Tier 1: 5.2銭, Tier 2: 3.5銭)
                    let decay_start_spread = if ev.tier == 1 { 0.052 } else if ev.tier == 2 { 0.035 } else { ev.base_peak_spread };
                    let rem_progress = ((mt5_time_msc - (ev.mt5_ms + 10000)) as f64 / ((ev.recovery_ms - 10000) as f64).max(1.0)).clamp(0.0, 1.0);
                    let decay = (1.0 - rem_progress).powi(2);
                    0.002 + (decay_start_spread - 0.002) * decay
                };

                if indicator_spread > target_spread {
                    target_spread = indicator_spread;
                }
            }
        }

        // --- 突発ボラティリティSTRESS追従 (指標スケジュール外の急変) ---
        if raw_oanda_spread > 0.015 {
            let stress_spread = 0.002 + 0.25 * (raw_oanda_spread - 0.015);
            if stress_spread > target_spread {
                target_spread = stress_spread;
            }
        }

        // 上限・下限の厳格適用 (USDJPY: 0.2銭〜16.0銭)
        let final_spread = target_spread.clamp(0.002, 0.160);

        // --- Layer 4: クォート間引き＆レート正規化 ---
        let dt_msc = mt5_time_msc - self.last_emitted_msc;
        let d_mid = (mid - self.last_emitted_mid).abs();
        let d_spr = (final_spread - self.last_emitted_spread).abs();

        // 時間帯別の目標配信間隔 (ms)
        let target_tps = dmm_characteristics::TPS_BY_JST_HOUR[(jst_hour.min(23)) as usize];
        let min_interval_ms = (1000.0 / target_tps) as i64;

        // 価格変動(0.1pip以上)やスプレッド変動がある場合は最新レートを即座に伝えるため最小20msで配信
        // 変動がない同値クォートの場合は時間帯別の配信レート(min_interval_ms)に間引き
        if self.last_emitted_msc > 0 {
            if d_mid < 0.0005 && d_spr < 0.0002 {
                // 変動なし（同値クォート）: 目標TPS間隔を満たしていなければ間引き
                if dt_msc < min_interval_ms {
                    return None;
                }
            } else if dt_msc < 20 {
                // 価格またはスプレッドが変動した場合: 極端なバースト(20ms未満)のみ抑制
                return None;
            }
        }

        // 更新を記録
        self.last_emitted_msc = mt5_time_msc;
        self.last_emitted_mid = mid;
        self.last_emitted_spread = final_spread;

        // DMM クォート生成 (スプレッド幅が厳密に一致するよう、bid丸め後に正確なスプレッドを加算)
        let spr_points = (final_spread * 1000.0).round() / 1000.0;
        let dmm_bid = ((mid - final_spread / 2.0) * 1000.0).round() / 1000.0;
        let dmm_ask = ((dmm_bid + spr_points) * 1000.0).round() / 1000.0;

        Some((dmm_bid, dmm_ask, final_spread))
    }
}

/// 月別の経済指標データ存在ステータス
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EconomicMonthStatus {
    pub year_month: String, // "YYYY-MM"
    pub exists: bool,
    pub event_count: usize,
}

/// 期間内の経済指標データ充足状況
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EconomicDataAvailability {
    pub symbol: String,
    pub pair: String,
    pub is_all_available: bool,
    pub has_any_data: bool,
    pub total_events: usize,
    pub months: Vec<EconomicMonthStatus>,
    pub missing_months: Vec<String>,
    pub available_months: Vec<String>,
}

/// シンボル名から既知のベース通貨ペア名を抽出
pub fn extract_base_pair(symbol: &str) -> String {
    let upper = symbol.to_uppercase();
    for &kp in crate::custom_symbol::KNOWN_PAIRS {
        if upper.starts_with(kp) {
            return kp.to_string();
        }
    }
    let first = symbol.split(&['_', '.', '-'][..]).next().unwrap_or(symbol);
    first.to_uppercase()
}

/// 日時文字列の範囲から含まれる年月 (YYYY, MM) の一覧を取得
pub fn get_year_months_between(start_dt_str: &str, end_dt_str: &str) -> Vec<(i32, u32)> {
    let parse_ym = |s: &str| -> Option<(i32, u32)> {
        let clean = s.replace('T', " ");
        let first_part = clean.split(' ').next()?;
        let parts: Vec<&str> = first_part.split(&['-', '/', '.'][..]).collect();
        if parts.len() >= 2 {
            let y = parts[0].parse::<i32>().ok()?;
            let m = parts[1].parse::<u32>().ok()?;
            if (1..=12).contains(&m) {
                return Some((y, m));
            }
        }
        None
    };

    let start_ym = parse_ym(start_dt_str).unwrap_or((2026, 5));
    let end_ym = parse_ym(end_dt_str).unwrap_or(start_ym);

    let mut result = Vec::new();
    let mut curr_y = start_ym.0;
    let mut curr_m = start_ym.1;

    let end_cmp = end_ym.0 * 12 + (end_ym.1 as i32);

    while curr_y * 12 + (curr_m as i32) <= end_cmp {
        result.push((curr_y, curr_m));
        curr_m += 1;
        if curr_m > 12 {
            curr_m = 1;
            curr_y += 1;
        }
        if result.len() > 120 { // 最大10年分
            break;
        }
    }

    if result.is_empty() {
        result.push(start_ym);
    }
    result
}

/// 指定期間内の全月のParquetを走査・ロードし、充足判定とロード済みイベントを同時に返す (単一パス/IO重複排除)
pub fn load_and_check_economic_data_range(
    symbol: &str,
    start_dt_str: &str,
    end_dt_str: &str,
    preload_mode: Option<&str>,
    preload_date_str: Option<&str>,
    custom_dir: Option<&str>,
) -> (EconomicDataAvailability, HashMap<String, Vec<EconomicEvent>>) {
    let pair = extract_base_pair(symbol);
    let effective_start = match (preload_mode, preload_date_str) {
        (Some("DATE"), Some(p_date)) if !p_date.is_empty() && p_date < start_dt_str => p_date,
        _ => start_dt_str,
    };

    let ym_list = get_year_months_between(effective_start, end_dt_str);
    let profiles = PseudoDmmEngine::load_profile_matrix();

    let mut months = Vec::new();
    let mut missing_months = Vec::new();
    let mut available_months = Vec::new();
    let mut loaded_events_map = HashMap::new();
    let mut total_events = 0;

    for (y, m) in ym_list {
        let ym_str = format!("{:04}-{:02}", y, m);
        let events = PseudoDmmEngine::load_events_for_month(&pair, y, m, &profiles, custom_dir);
        let count = events.len();
        let exists = count > 0;

        if exists {
            total_events += count;
            available_months.push(ym_str.clone());
            loaded_events_map.insert(ym_str.clone(), events);
        } else {
            missing_months.push(ym_str.clone());
        }

        months.push(EconomicMonthStatus {
            year_month: ym_str,
            exists,
            event_count: count,
        });
    }

    let is_all_available = missing_months.is_empty();
    let has_any_data = !available_months.is_empty();

    (
        EconomicDataAvailability {
            symbol: symbol.to_string(),
            pair,
            is_all_available,
            has_any_data,
            total_events,
            months,
            missing_months,
            available_months,
        },
        loaded_events_map,
    )
}

/// 期間内の重要指標 (Tier 1..=3) をEA用CSVフォーマットに変換
/// フォーマット: "time_msc,tier,adv_s,pre_spr,peak_spr,rec_s;..."
pub fn format_economic_schedule_csv(events: &[EconomicEvent]) -> String {
    let mut filtered: Vec<&EconomicEvent> = events
        .iter()
        .filter(|e| e.tier >= 1 && e.tier <= 3)
        .collect();
    filtered.sort_by_key(|e| e.mt5_ms);

    let mut parts = Vec::with_capacity(filtered.len());
    for ev in filtered {
        let adv_s = (ev.advance_ms / 1000).max(0);
        let rec_s = (ev.recovery_ms / 1000).max(0);
        parts.push(format!(
            "{},{},{},{:.4},{:.4},{}",
            ev.mt5_ms, ev.tier, adv_s, ev.base_pre_spread, ev.base_peak_spread, rec_s
        ));
    }
    parts.join(";")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDateTime;

    #[test]
    fn test_format_economic_schedule_csv() {
        let events = vec![
            EconomicEvent {
                event_id: 1,
                utc_ms: 1000000,
                mt5_ms: 1010800000,
                currency: "USD".to_string(),
                event_name: "非農業部門雇用者数".to_string(),
                importance: "high".to_string(),
                tier: 1,
                advance_ms: 35000,
                base_pre_spread: 0.039,
                base_peak_spread: 0.156,
                recovery_ms: 45000,
            },
            EconomicEvent {
                event_id: 2,
                utc_ms: 2000000,
                mt5_ms: 1020800000,
                currency: "USD".to_string(),
                event_name: "低影響指標".to_string(),
                importance: "low".to_string(),
                tier: 4,
                advance_ms: 0,
                base_pre_spread: 0.002,
                base_peak_spread: 0.002,
                recovery_ms: 0,
            },
        ];

        let csv = format_economic_schedule_csv(&events);
        assert_eq!(csv, "1010800000,1,35,0.0390,0.1560,45");
    }

    #[test]
    fn test_normal_hours_spread() {
        let mut engine = PseudoDmmEngine::new("USDJPY", "2026-08");
        // 平日 14:00 JST (05:00 UTC, 08:00 MT5夏時間)
        let mt5_msc = 1785571200000; // 2026-08-01 08:00:00 MT5
        let res = engine.process_tick(mt5_msc, 150.000, 150.004);
        assert!(res.is_some());
        let (bid, ask, spr) = res.unwrap();
        assert!((spr - 0.002).abs() < 0.0001, "Normal hours spread should be 0.2銭, got {}", spr);
        assert_eq!(bid, 150.001);
        assert_eq!(ask, 150.003);
    }

    #[test]
    fn test_fixing_hours_spread() {
        let mut engine = PseudoDmmEngine::new("USDJPY", "2026-08");
        // 2026-08-03 (月) 09:54:30 JST (00:54:30 UTC, 03:54:30 MT5) -> ピーク 通常 1.0銭
        let mt5_dt_peak = NaiveDateTime::parse_from_str("2026-08-03 03:54:30", "%Y-%m-%d %H:%M:%S").unwrap();
        let mt5_msc_peak = mt5_dt_peak.and_utc().timestamp() * 1000;
        let res_peak = engine.process_tick(mt5_msc_peak, 150.000, 150.004);
        assert!(res_peak.is_some());
        let (_, _, spr_peak) = res_peak.unwrap();
        assert!((spr_peak - 0.010).abs() < 0.0001, "Fixing peak spread should be 1.0銭, got {}", spr_peak);

        // 2026-08-03 (月) 09:56:00 JST (00:56:00 UTC, 03:56:00 MT5) -> 正常復帰 0.2銭
        let mt5_dt_norm = NaiveDateTime::parse_from_str("2026-08-03 03:56:00", "%Y-%m-%d %H:%M:%S").unwrap();
        let mt5_msc_norm = mt5_dt_norm.and_utc().timestamp() * 1000;
        let res_norm = engine.process_tick(mt5_msc_norm, 150.000, 150.004);
        assert!(res_norm.is_some());
        let (_, _, spr_norm) = res_norm.unwrap();
        assert!((spr_norm - 0.002).abs() < 0.0001, "Fixing after spread should be 0.2銭, got {}", spr_norm);
    }

    #[test]
    fn test_early_morning_spread() {
        let mut engine = PseudoDmmEngine::new("USDJPY", "2026-08");
        // 2026-08-03 (月) 05:30:00 JST (夏時間: 20:30:00 UTC, 23:30:00 MT5前日) -> 平時 0.2銭
        let mt5_dt_pre = NaiveDateTime::parse_from_str("2026-08-02 23:30:00", "%Y-%m-%d %H:%M:%S").unwrap();
        let mt5_msc_pre = mt5_dt_pre.and_utc().timestamp() * 1000;
        let res_pre = engine.process_tick(mt5_msc_pre, 150.000, 150.004);
        assert!(res_pre.is_some());
        let (_, _, spr_pre) = res_pre.unwrap();
        assert!((spr_pre - 0.002).abs() < 0.0001, "Pre-rollover 05:30 spread should be 0.2銭, got {}", spr_pre);

        // 2026-08-03 (月) 06:00:00 JST (夏時間: 21:00:00 UTC, 00:00:00 MT5) -> スパイク 12.0銭 (実測最大12.9銭)
        let mt5_dt_peak = NaiveDateTime::parse_from_str("2026-08-03 00:00:00", "%Y-%m-%d %H:%M:%S").unwrap();
        let mt5_msc_peak = mt5_dt_peak.and_utc().timestamp() * 1000;
        let res_peak = engine.process_tick(mt5_msc_peak, 150.000, 150.004);
        assert!(res_peak.is_some());
        let (_, _, spr_peak) = res_peak.unwrap();
        assert_eq!(spr_peak, 0.120, "Rollover 06:00 peak should be 12.0銭, got {}", spr_peak);

        // 2026-08-03 (月) 06:30:00 JST (夏時間: 21:30:00 UTC, 00:30:00 MT5) -> 3.9銭 (実測中央値準拠)
        let mt5_dt_mid = NaiveDateTime::parse_from_str("2026-08-03 00:30:00", "%Y-%m-%d %H:%M:%S").unwrap();
        let mt5_msc_mid = mt5_dt_mid.and_utc().timestamp() * 1000;
        let res_mid = engine.process_tick(mt5_msc_mid, 150.000, 150.004);
        assert!(res_mid.is_some());
        let (_, _, spr_mid) = res_mid.unwrap();
        assert!((spr_mid - 0.039).abs() < 0.0001, "Early morning 06:30 spread should be 3.9銭, got {}", spr_mid);

        // 2026-08-03 (月) 07:05:00 JST (夏時間: 22:05:00 UTC, 01:05:00 MT5) -> 3.5銭厳密固定帯
        let mt5_dt_7h = NaiveDateTime::parse_from_str("2026-08-03 01:05:00", "%Y-%m-%d %H:%M:%S").unwrap();
        let mt5_msc_7h = mt5_dt_7h.and_utc().timestamp() * 1000;
        let res_7h = engine.process_tick(mt5_msc_7h, 150.000, 150.004);
        assert!(res_7h.is_some());
        let (_, _, spr_7h) = res_7h.unwrap();
        assert_eq!(spr_7h, 0.035, "Early morning 07:00-07:09 spread should be strictly 3.5銭, got {}", spr_7h);

        // 2026-08-03 (月) 07:15:00 JST (夏時間: 22:15:00 UTC, 01:15:00 MT5) -> 復帰 0.2銭
        let mt5_dt_rec = NaiveDateTime::parse_from_str("2026-08-03 01:15:00", "%Y-%m-%d %H:%M:%S").unwrap();
        let mt5_msc_rec = mt5_dt_rec.and_utc().timestamp() * 1000;
        let res_rec = engine.process_tick(mt5_msc_rec, 150.000, 150.004);
        assert!(res_rec.is_some());
        let (_, _, spr_rec) = res_rec.unwrap();
        assert!((spr_rec - 0.002).abs() < 0.0001, "Morning recovery 07:15 spread should be 0.2銭, got {}", spr_rec);
    }

    #[test]
    fn test_economic_indicator_dynamic_spread() {
        let mut engine = PseudoDmmEngine::new("USDJPY", "2026-08");
        // 指標イベントを手動注入 (2026-08-07 21:30:00 JST / 12:30:00 UTC / 15:30:00 MT5)
        let mt5_event_dt = NaiveDateTime::parse_from_str("2026-08-07 15:30:00", "%Y-%m-%d %H:%M:%S").unwrap();
        let mt5_event_ms = mt5_event_dt.and_utc().timestamp() * 1000;
        let utc_event_ms = mt5_event_ms - 3 * 3600 * 1000;

        engine.events.push(EconomicEvent {
            event_id: 999999,
            utc_ms: utc_event_ms,
            mt5_ms: mt5_event_ms,
            currency: "USD".to_string(),
            event_name: "非農業部門雇用者数".to_string(),
            importance: "high".to_string(),
            tier: 1,
            advance_ms: 35000,
            base_pre_spread: 0.039,
            base_peak_spread: 0.156,
            recovery_ms: 120000,
        });

        // 1. 発表 20秒前 (T - 20s): 事前拡大
        let mt5_pre_msc = (mt5_event_dt.and_utc().timestamp() - 20) * 1000;
        let res_pre = engine.process_tick(mt5_pre_msc, 150.000, 150.004);
        assert!(res_pre.is_some());
        let (_, _, spr_pre) = res_pre.unwrap();
        assert!(spr_pre >= 0.020, "Pre-event spread should ramp up, got {}", spr_pre);

        // 2. 発表直後 (T + 2s): ピーク拡大 (15.6銭到達)
        let mt5_peak_msc = (mt5_event_dt.and_utc().timestamp() + 2) * 1000;
        let res_peak = engine.process_tick(mt5_peak_msc, 150.000, 150.050);
        assert!(res_peak.is_some());
        let (_, _, spr_peak) = res_peak.unwrap();
        assert_eq!(spr_peak, 0.156, "Peak spread should reach 0.156 on Tier 1 event");

        // 3. 発表後 30秒 (T + 30s): 減衰フェーズ (約3.0〜3.8銭)
        let mt5_mid_msc = (mt5_event_dt.and_utc().timestamp() + 30) * 1000;
        let res_mid = engine.process_tick(mt5_mid_msc, 150.000, 150.004);
        assert!(res_mid.is_some());
        let (_, _, spr_mid) = res_mid.unwrap();
        assert!(spr_mid >= 0.030 && spr_mid <= 0.040, "Spread at T+30s should be ~3.5銭, got {}", spr_mid);

        // 4. 発表後 130秒 (T + 130s): 完全平時復帰 (0.2銭)
        let mt5_post_msc = (mt5_event_dt.and_utc().timestamp() + 130) * 1000;
        let res_post = engine.process_tick(mt5_post_msc, 150.000, 150.004);
        assert!(res_post.is_some());
        let (_, _, spr_post) = res_post.unwrap();
        assert!((spr_post - 0.002).abs() < 0.0001, "Spread at T+130s should recover to 0.2銭, got {}", spr_post);
    }

    #[test]
    fn test_get_year_months_between() {
        let ym = get_year_months_between("2026-05-01 00:00:00", "2026-07-15 23:59:59");
        assert_eq!(ym, vec![(2026, 5), (2026, 6), (2026, 7)]);

        let ym_cross_year = get_year_months_between("2025-11-01", "2026-02-01");
        assert_eq!(ym_cross_year, vec![(2025, 11), (2025, 12), (2026, 1), (2026, 2)]);

        let ym_single = get_year_months_between("2026-05-01", "2026-05-10");
        assert_eq!(ym_single, vec![(2026, 5)]);
    }

    #[test]
    fn test_extract_base_pair() {
        assert_eq!(extract_base_pair("USDJPY.dmm2026"), "USDJPY");
        assert_eq!(extract_base_pair("USDJPY_OANDA_2016"), "USDJPY");
        assert_eq!(extract_base_pair("EURUSD"), "EURUSD");
        assert_eq!(extract_base_pair("GBPJPY.cl"), "GBPJPY");
    }

    #[test]
    fn test_load_events_symbol_partition() {
        use arrow::datatypes::{DataType, Field, Schema};
        use arrow::record_batch::RecordBatch;
        use parquet::arrow::arrow_writer::ArrowWriter;
        use std::sync::Arc;

        let temp_dir = std::env::temp_dir().join("tickreplay_test_symbol_parquet");
        let _ = std::fs::remove_dir_all(&temp_dir);

        let part_dir = temp_dir.join("economic").join("symbol=usdjpy").join("year=2026").join("month=08");
        std::fs::create_dir_all(&part_dir).unwrap();
        let part_file = part_dir.join("events.parquet");

        let schema = Arc::new(Schema::new(vec![
            Field::new("event_id", DataType::Int64, false),
            Field::new("utc_ms", DataType::Int64, false),
            Field::new("mt5_ms", DataType::Int64, false),
            Field::new("currency", DataType::Utf8, false),
            Field::new("event_name", DataType::Utf8, false),
            Field::new("importance", DataType::Utf8, false),
        ]));

        let event_ids = Arc::new(Int64Array::from(vec![101]));
        let utc_mss = Arc::new(Int64Array::from(vec![1785571200000i64]));
        let mt5_mss = Arc::new(Int64Array::from(vec![1785582000000i64]));
        let currencies = Arc::new(StringArray::from(vec!["USD"]));
        let event_names = Arc::new(StringArray::from(vec!["非農業部門雇用者数"]));
        let importances = Arc::new(StringArray::from(vec!["high"]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                event_ids,
                utc_mss,
                mt5_mss,
                currencies,
                event_names,
                importances,
            ],
        ).unwrap();

        let file = File::create(&part_file).unwrap();
        let mut writer = ArrowWriter::try_new(file, schema, None).unwrap();
        writer.write(&batch).unwrap();
        writer.close().unwrap();

        let profiles = PseudoDmmEngine::load_profile_matrix();
        let events = PseudoDmmEngine::load_events_for_month(
            "USDJPY",
            2026,
            8,
            &profiles,
            Some(temp_dir.to_str().unwrap()),
        );

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_id, 101);
        assert_eq!(events[0].event_name, "非農業部門雇用者数");
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_load_profile_matrix_comprehensive() {
        let profiles = PseudoDmmEngine::load_profile_matrix();
        assert!(profiles.len() > 10, "プロファイルマトリクスが正常にロードされること (件数: {})", profiles.len());
        assert!(profiles.contains_key("USD:非農業部門雇用者数") || profiles.contains_key("USD:CPI"));
        assert!(profiles.contains_key("AUD:AIGオーストラリア建設指数") || profiles.contains_key("EUR:ECB政策金利") || profiles.len() > 100);
    }

    #[test]
    fn test_is_us_dst_accurate_dates() {
        // 2024年: 3月1日(金) -> 第2日曜は3月10日, 11月1日(金) -> 第1日曜は11月3日
        assert!(!PseudoDmmEngine::is_us_dst(2024, 3, 9, 23));
        assert!(!PseudoDmmEngine::is_us_dst(2024, 3, 10, 1));
        assert!(PseudoDmmEngine::is_us_dst(2024, 3, 10, 2));
        assert!(PseudoDmmEngine::is_us_dst(2024, 3, 11, 0));
        assert!(PseudoDmmEngine::is_us_dst(2024, 11, 2, 23));
        assert!(PseudoDmmEngine::is_us_dst(2024, 11, 3, 1));
        assert!(!PseudoDmmEngine::is_us_dst(2024, 11, 3, 2));
        assert!(!PseudoDmmEngine::is_us_dst(2024, 11, 4, 0));

        // 2025年: 3月1日(土) -> 第2日曜は3月9日, 11月1日(土) -> 第1日曜は11月2日
        assert!(!PseudoDmmEngine::is_us_dst(2025, 3, 8, 23));
        assert!(!PseudoDmmEngine::is_us_dst(2025, 3, 9, 1));
        assert!(PseudoDmmEngine::is_us_dst(2025, 3, 9, 2));
        assert!(PseudoDmmEngine::is_us_dst(2025, 11, 1, 23));
        assert!(PseudoDmmEngine::is_us_dst(2025, 11, 2, 1));
        assert!(!PseudoDmmEngine::is_us_dst(2025, 11, 2, 2));

        // 2026年: 3月1日(日) -> 第2日曜は3月8日, 11月1日(日) -> 第1日曜は11月1日
        assert!(!PseudoDmmEngine::is_us_dst(2026, 3, 7, 23));
        assert!(!PseudoDmmEngine::is_us_dst(2026, 3, 8, 1));
        assert!(PseudoDmmEngine::is_us_dst(2026, 3, 8, 2));
        assert!(PseudoDmmEngine::is_us_dst(2026, 11, 1, 1));
        assert!(!PseudoDmmEngine::is_us_dst(2026, 11, 1, 2));
    }

    #[test]
    fn test_dmm_quantization_and_deadband() {
        let mut engine = PseudoDmmEngine::new("USDJPY", "2026-08");
        // 平日 14:00 JST (MT5夏時間 08:00)
        let t0 = 1785571200000i64;
        
        // 1. 初回ティック (raw_mid = 150.002)
        let res0 = engine.process_tick(t0, 150.000, 150.004);
        assert!(res0.is_some());
        let (bid0, ask0, _) = res0.unwrap();
        assert_eq!(bid0, 150.001);
        assert_eq!(ask0, 150.003);

        // 2. 1秒後、微小な変動 (raw_bid=150.0002, raw_ask=150.0042 -> raw_mid=150.0022)
        // deltaは0.0005未満なのでデッドバンドにより前回の150.002が維持される
        let res1 = engine.process_tick(t0 + 1000, 150.0002, 150.0042);
        assert!(res1.is_some());
        let (bid1, ask1, _) = res1.unwrap();
        assert_eq!(bid1, 150.001);
        assert_eq!(ask1, 150.003);

        // 3. 2秒後、大きな変動 (raw_bid=150.010, raw_ask=150.014 -> raw_mid=150.012)
        // EMA平滑化・デッドバンドを超え、0.001単位に量子化された新しいレートが出力される
        let res2 = engine.process_tick(t0 + 2000, 150.010, 150.014);
        assert!(res2.is_some());
        let (bid2, ask2, _) = res2.unwrap();
        assert!(bid2 > bid0, "Bid should update upward: {}", bid2);
        // 0.001単位で厳密にステップ量子化されていること
        assert_eq!(((bid2 * 1000.0).round() - (bid2 * 1000.0)).abs(), 0.0);
        assert_eq!(((ask2 * 1000.0).round() - (ask2 * 1000.0)).abs(), 0.0);
    }

    #[test]
    fn test_dynamic_tps_pruning() {
        let mut engine = PseudoDmmEngine::new("USDJPY", "2026-08");
        // 平日 14:00 JST (目標TPS約2.7 -> min_interval_msは約370ms)
        let t0 = 1785571200000i64;

        let res0 = engine.process_tick(t0, 150.000, 150.004);
        assert!(res0.is_some());

        // 50ms後、同値クォート -> 目標間隔(370ms)未満のため間引かれてNone
        let res_pruned = engine.process_tick(t0 + 50, 150.000, 150.004);
        assert!(res_pruned.is_none());

        // 400ms後、同値クォート -> 目標間隔(370ms)以上経過したため出力される
        let res_emitted = engine.process_tick(t0 + 400, 150.000, 150.004);
        assert!(res_emitted.is_some());

        // 価格が大きく動いた場合 (150.020 / 150.024) -> 30ms後でも即座に出力される
        let res_moved = engine.process_tick(t0 + 430, 150.020, 150.024);
        assert!(res_moved.is_some());
    }

    #[test]
    fn test_get_drenhis_export_dir() {
        let dir = PseudoDmmEngine::get_drenhis_export_dir();
        // 戻り値が存在するか、もしくは D:\Drehis 関連の有効なパスであること
        assert!(!dir.to_string_lossy().is_empty());
    }
}

