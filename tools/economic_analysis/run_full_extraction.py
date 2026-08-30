import sqlite3
import pandas as pd
import numpy as np
import zipfile
import glob
import os
import time
import json
from concurrent.futures import ProcessPoolExecutor, as_completed

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'data', 'analysis')
os.makedirs(OUTPUT_DIR, exist_ok=True)

DST_BOUNDS = {
    2016: ('2016-03-13 02:00:00', '2016-11-06 02:00:00'),
    2017: ('2017-03-12 02:00:00', '2017-11-05 02:00:00'),
    2018: ('2018-03-11 02:00:00', '2018-11-04 02:00:00'),
    2019: ('2019-03-10 02:00:00', '2019-11-03 02:00:00'),
    2020: ('2020-03-08 02:00:00', '2020-11-01 02:00:00'),
    2021: ('2021-03-14 02:00:00', '2021-11-07 02:00:00'),
    2022: ('2022-03-13 02:00:00', '2022-11-06 02:00:00'),
    2023: ('2023-03-12 02:00:00', '2023-11-05 02:00:00'),
    2024: ('2024-03-10 02:00:00', '2024-11-03 02:00:00'),
    2025: ('2025-03-09 02:00:00', '2025-11-02 02:00:00'),
    2026: ('2026-03-08 02:00:00', '2026-11-01 02:00:00'),
}

def process_month_vectorized(args):
    zip_path, month_events = args
    if not month_events:
        return []
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            fname = z.namelist()[0]
            with z.open(fname) as f:
                df_ticks = pd.read_csv(
                    f, 
                    sep='\t', 
                    skiprows=1, 
                    names=['date', 'time', 'bid', 'ask', 'last', 'vol'],
                    usecols=['date', 'time', 'bid', 'ask'],
                    dtype={'bid': np.float64, 'ask': np.float64}
                )
    except Exception as e:
        print(f"Error reading {zip_path}: {e}")
        return []
        
    if len(df_ticks) == 0:
        return []
        
    # Vectorized timestamp conversion
    dt_str = df_ticks['date'] + ' ' + df_ticks['time']
    ts_mt5 = pd.to_datetime(dt_str, format='%Y.%m.%d %H:%M:%S.%f')
    
    y = int(df_ticks['date'].iloc[0][:4])
    dst_start, dst_end = DST_BOUNDS.get(y, (f'{y}-03-10 02:00:00', f'{y}-11-03 02:00:00'))
    
    is_summer = (ts_mt5 >= dst_start) & (ts_mt5 < dst_end)
    offset_h = np.where(is_summer, 3, 2)
    
    # Exact ms epoch
    ts_utc_ms = ts_mt5.astype('datetime64[ms]').astype('int64').values - (offset_h * 3600 * 1000)
    
    bids = df_ticks['bid'].values
    asks = df_ticks['ask'].values
    spreads = np.round(asks - bids, 5)
    mids = (bids + asks) / 2.0
    
    results = []
    # Fast binary search slicing
    for ev in month_events:
        t = ev['utc_ms']
        
        idx_w_start = np.searchsorted(ts_utc_ms, t - 120000, side='left')
        idx_t_m30   = np.searchsorted(ts_utc_ms, t - 30000, side='left')
        idx_t0      = np.searchsorted(ts_utc_ms, t, side='left')
        idx_t_p30   = np.searchsorted(ts_utc_ms, t + 30000, side='right')
        idx_t_p60   = np.searchsorted(ts_utc_ms, t + 60000, side='right')
        idx_w_end   = np.searchsorted(ts_utc_ms, t + 180000, side='right')
        
        # If no ticks in event window (e.g. weekend or bank holiday)
        if idx_w_start >= idx_w_end:
            continue
            
        # Base spread [T-120s, T-30s]
        if idx_w_start < idx_t_m30:
            base_spr = float(np.mean(spreads[idx_w_start:idx_t_m30]))
            ticks_base = idx_t_m30 - idx_w_start
        else:
            base_spr = 0.004
            ticks_base = 1
            
        # Pre max spread & velocity [T-30s, T-0s]
        if idx_t_m30 < idx_t0:
            pre_sprs = spreads[idx_t_m30:idx_t0]
            pre_max_spr = float(np.max(pre_sprs))
            dt_s = (ts_utc_ms[idx_t0-1] - ts_utc_ms[idx_t_m30]) / 1000.0
            d_spr = (pre_sprs[-1] - pre_sprs[0]) * 100 # pips
            spr_vel = float(d_spr / max(1.0, dt_s))
            ticks_pre = idx_t0 - idx_t_m30
        else:
            pre_max_spr = base_spr
            spr_vel = 0.0
            ticks_pre = 0
            
        # Peak spread [T-0s, T+30s]
        if idx_t0 < idx_t_p30:
            peak_spr = float(np.max(spreads[idx_t0:idx_t_p30]))
        else:
            peak_spr = pre_max_spr
            
        # 1m Price Range (High - Low in pips) [T-0s, T+60s]
        if idx_t0 < idx_t_p60:
            p_bids_1m = bids[idx_t0:idx_t_p60]
            p_range_1m = float(np.max(p_bids_1m) - np.min(p_bids_1m)) * 100
            p_dir_1m = float(mids[idx_t_p60-1] - mids[idx_t0]) * 100
        else:
            p_range_1m = 0.0
            p_dir_1m = 0.0
            
        # 3m Price Range [T-0s, T+180s]
        if idx_t0 < idx_w_end:
            p_bids_3m = bids[idx_t0:idx_w_end]
            p_range_3m = float(np.max(p_bids_3m) - np.min(p_bids_3m)) * 100
        else:
            p_range_3m = 0.0
            
        # Tick acceleration
        tick_rate_pre = ticks_pre / 30.0
        tick_rate_base = ticks_base / 90.0
        tick_accel = float(tick_rate_pre / max(0.001, tick_rate_base))
        
        # Surprise
        act = ev['actual_num']
        fc = ev['forecast_num']
        surprise = float(abs(act - fc)) if (act is not None and fc is not None and not np.isnan(act) and not np.isnan(fc)) else None
        
        results.append({
            'event_id': ev['event_id'],
            'utc_ms': ev['utc_ms'],
            'release_utc': ev['release_utc'],
            'currency': ev['currency_code'],
            'event_name': ev['event_name'],
            'importance': ev['importance'],
            'actual_num': ev['actual_num'],
            'forecast_num': ev['forecast_num'],
            'previous_num': ev['previous_num'],
            'surprise': surprise,
            'is_solo': ev['is_solo'],
            'max_slot_importance': ev['max_slot_importance'],
            'simul_count': ev['simul_count'],
            'simul_indicators': ev['simul_indicators'],
            # Tick features
            'base_spread': round(base_spr, 5),
            'pre_max_spread': round(pre_max_spr, 5),
            'pre_spread_velocity': round(spr_vel, 4),
            'peak_spread': round(peak_spr, 5),
            'price_range_1m_pips': round(p_range_1m, 2),
            'price_range_3m_pips': round(p_range_3m, 2),
            'price_dir_1m_pips': round(p_dir_1m, 2),
            'tick_accel': round(tick_accel, 2),
            'ticks_1m': idx_t_p60 - idx_t0,
            'total_ticks_window': idx_w_end - idx_w_start
        })
        
    return results

def main():
    t_start = time.time()
    print("=== STEP 1: LOADING ALL ECONOMIC EVENTS (2016-09 to 2026-08) ===")
    db_path = os.path.join(PROJECT_ROOT, 'data', 'drehis', 'news.db')
    conn = sqlite3.connect(db_path)
    
    query = """
    SELECT 
        e.id AS event_id,
        e.release_date AS utc_ms,
        datetime(e.release_date/1000, 'unixepoch') AS release_utc,
        i.currency_code,
        i.event_name,
        i.importance,
        e.actual_num,
        e.forecast_num,
        e.previous_num
    FROM economic_events e
    JOIN economic_indicators i ON e.indicator_id = i.id
    WHERE e.release_date >= 1472688000000 AND e.release_date <= 1788188400000 -- 2016-09 to 2026-08
      AND i.currency_code IN ('USD', 'JPY', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'CNY')
    ORDER BY e.release_date;
    """
    df_events = pd.read_sql_query(query, conn)
    conn.close()
    print(f"Total events in target currencies: {len(df_events):,}")
    
    print("=== STEP 2: CLUSTERING SIMULTANEOUS EVENTS & TAGGING ATTRIBUTION ===")
    imp_order = {'high': 3, 'medium': 2, 'low': 1, 'none': 0}
    slot_info = {}
    for (utc_ms, ccy), group in df_events.groupby(['utc_ms', 'currency_code']):
        imps = group['importance'].tolist()
        names = group['event_name'].tolist()
        max_imp_val = max([imp_order.get(x, 0) for x in imps])
        max_imp_str = [k for k, v in imp_order.items() if v == max_imp_val][0]
        
        slot_info[(utc_ms, ccy)] = {
            'simul_count': len(group),
            'is_solo': len(group) == 1,
            'max_slot_importance': max_imp_str,
            'simul_indicators': "; ".join([f"[{imp}] {name}" for imp, name in zip(imps, names)])
        }
        
    df_events['is_solo'] = df_events.apply(lambda r: slot_info[(r['utc_ms'], r['currency_code'])]['is_solo'], axis=1)
    df_events['max_slot_importance'] = df_events.apply(lambda r: slot_info[(r['utc_ms'], r['currency_code'])]['max_slot_importance'], axis=1)
    df_events['simul_count'] = df_events.apply(lambda r: slot_info[(r['utc_ms'], r['currency_code'])]['simul_count'], axis=1)
    df_events['simul_indicators'] = df_events.apply(lambda r: slot_info[(r['utc_ms'], r['currency_code'])]['simul_indicators'], axis=1)
    
    df_events['jst_month'] = pd.to_datetime(df_events['utc_ms'] + 9*3600*1000, unit='ms').dt.strftime('%Y-%m')
    events_by_month = {}
    for jst_m, grp in df_events.groupby('jst_month'):
        events_by_month[jst_m] = grp.to_dict('records')
        
    zip_pattern = os.path.join(PROJECT_ROOT, 'data', 'OANDA(USDJPYonly)', '*', '*', '*.zip')
    zip_files = glob.glob(zip_pattern)
    tasks = []
    for zpath in zip_files:
        base = os.path.basename(zpath)
        parts = base.replace('.zip', '').split('_')
        if len(parts) >= 3:
            ym = parts[2]
            month_evs = events_by_month.get(ym, [])
            if len(month_evs) > 0:
                tasks.append((zpath, month_evs))
                
    print(f"Prepared {len(tasks)} parallel zip tasks.")
    
    print(f"=== STEP 3: RUNNING HIGH-SPEED VECTORIZED EXTRACTION (16 Workers) ===")
    all_results = []
    completed_count = 0
    
    with ProcessPoolExecutor(max_workers=min(16, os.cpu_count())) as executor:
        futures = {executor.submit(process_month_vectorized, task): task[0] for task in tasks}
        
        for future in as_completed(futures):
            zpath = futures[future]
            res = future.result()
            all_results.extend(res)
            completed_count += 1
            if completed_count % 15 == 0 or completed_count == len(tasks):
                print(f"  Processed {completed_count}/{len(tasks)} zips ({completed_count/len(tasks)*100:.1f}%) -> {len(all_results):,} events sliced...")
                
    df_all_results = pd.DataFrame(all_results)
    print(f"\nAll 120 zip files sliced in {time.time() - t_start:.2f}s!")
    print(f"Total sliced event instances: {len(df_all_results):,}")
    
    parquet_out = os.path.join(OUTPUT_DIR, 'historical_events_full_2016_2026.parquet')
    df_all_results.to_parquet(parquet_out, index=False)
    print(f"Saved dataset to {parquet_out} ({os.path.getsize(parquet_out)/1024/1024:.2f} MB)")

if __name__ == '__main__':
    main()
