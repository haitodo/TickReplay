use std::sync::Arc;
use tauri::State;
use crate::error::AppError;
use crate::state::ReplayState;
use crate::pseudo_dmm::{EconomicDataAvailability, load_and_check_economic_data_range};

#[tauri::command]
pub async fn check_economic_data_availability(
    symbol: String,
    start_time: String,
    end_time: String,
    preload_mode: Option<String>,
    preload_date: Option<String>,
    state: State<'_, Arc<ReplayState>>,
) -> Result<EconomicDataAvailability, AppError> {
    let sym = symbol.clone();
    let st = start_time.clone();
    let et = end_time.clone();
    let pm = preload_mode.clone();
    let pd = preload_date.clone();

    let (availability, loaded_events) = tokio::task::spawn_blocking(move || {
        load_and_check_economic_data_range(
            &sym,
            &st,
            &et,
            pm.as_deref(),
            pd.as_deref(),
            None,
        )
    })
    .await
    .map_err(|e| AppError::Config(format!("経済指標チェックタスクエラー: {}", e)))?;

    // メモリキャッシュを更新 (後続処理での重複IOを防止)
    {
        let mut cache = state.economic_events.lock().unwrap();
        for (ym, events) in loaded_events {
            cache.insert(ym, events);
        }
    }

    Ok(availability)
}

#[tauri::command]
pub async fn check_month_economic_availability(
    symbol: String,
    year_month: String,
    state: State<'_, Arc<ReplayState>>,
) -> Result<bool, AppError> {
    // まずメモリキャッシュを確認
    {
        let cache = state.economic_events.lock().unwrap();
        if let Some(events) = cache.get(&year_month) {
            return Ok(!events.is_empty());
        }
    }

    // キャッシュにない場合はロードしてキャッシュ
    let sym = symbol.clone();
    let ym = year_month.clone();
    let (exists, events_opt) = tokio::task::spawn_blocking(move || {
        let pair = crate::pseudo_dmm::extract_base_pair(&sym);
        let parts: Vec<&str> = ym.split('-').collect();
        let year: i32 = parts.get(0).and_then(|s| s.parse().ok()).unwrap_or(2026);
        let month: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(5);
        let profiles = crate::pseudo_dmm::PseudoDmmEngine::load_profile_matrix();
        let events = crate::pseudo_dmm::PseudoDmmEngine::load_events_for_month(&pair, year, month, &profiles, None);
        let has = !events.is_empty();
        (has, events)
    })
    .await
    .map_err(|e| AppError::Config(format!("経済指標月別チェックエラー: {}", e)))?;

    if exists {
        let mut cache = state.economic_events.lock().unwrap();
        cache.insert(year_month, events_opt);
    }

    Ok(exists)
}

#[tauri::command]
pub async fn get_economic_schedule_csv(
    symbol: String,
    start_time: String,
    end_time: String,
    preload_mode: Option<String>,
    preload_date: Option<String>,
    state: State<'_, Arc<ReplayState>>,
) -> Result<String, AppError> {
    let sym = symbol.clone();
    let st = start_time.clone();
    let et = end_time.clone();
    let pm = preload_mode.clone();
    let pd = preload_date.clone();

    // 1. 必要年月を計算
    let ym_list = crate::pseudo_dmm::get_year_months_between(
        if pm.as_deref() == Some("DATE") && pd.as_ref().map_or(false, |s| !s.is_empty()) {
            pd.as_deref().unwrap()
        } else {
            &st
        },
        &et,
    );

    // 2. キャッシュ確認
    let mut all_events = Vec::new();
    let mut missing_ym = Vec::new();
    {
        let cache = state.economic_events.lock().unwrap();
        for (y, m) in &ym_list {
            let ym_str = format!("{:04}-{:02}", y, m);
            if let Some(events) = cache.get(&ym_str) {
                all_events.extend(events.clone());
            } else {
                missing_ym.push((*y, *m));
            }
        }
    }

    // 3. 未キャッシュ月があればロード
    if !missing_ym.is_empty() {
        let (_, loaded_events) = tokio::task::spawn_blocking(move || {
            crate::pseudo_dmm::load_and_check_economic_data_range(
                &sym,
                &st,
                &et,
                pm.as_deref(),
                pd.as_deref(),
                None,
            )
        })
        .await
        .map_err(|e| AppError::Config(format!("経済指標CSV取得タスクエラー: {}", e)))?;

        let mut cache = state.economic_events.lock().unwrap();
        for (ym, events) in loaded_events {
            all_events.extend(events.clone());
            cache.insert(ym, events);
        }
    }

    // 4. CSVフォーマットへ変換
    let csv = crate::pseudo_dmm::format_economic_schedule_csv(&all_events);
    Ok(csv)
}
