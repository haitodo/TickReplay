import pandas as pd
import numpy as np
import json
import os
import io
import sys

# Ensure UTF-8 output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
parquet_path = os.path.join(PROJECT_ROOT, 'data', 'analysis', 'historical_events_full_2016_2026.parquet')
df = pd.read_parquet(parquet_path)

print(f"Loaded {len(df):,} event instances across 2016-2026.")

# Clean event names
df['event_clean'] = df['event_name'].str.strip()

# 1. Overall Statistics by Importance
print("\n" + "="*80)
print("=== 1. OVERALL STATS BY IMPORTANCE (USD/JPY Ticks 2016-2026) ===")
print("="*80)
imp_stats = df.groupby('importance').agg(
    count=('peak_spread', 'count'),
    mean_peak_spr=('peak_spread', 'mean'),
    p90_peak_spr=('peak_spread', lambda x: np.percentile(x, 90)),
    max_peak_spr=('peak_spread', 'max'),
    mean_1m_range_pips=('price_range_1m_pips', 'mean'),
    p90_1m_range_pips=('price_range_1m_pips', lambda x: np.percentile(x, 90)),
    mean_pre_vel=('pre_spread_velocity', 'mean'),
    mean_tick_accel=('tick_accel', 'mean')
).loc[['high', 'medium', 'low', 'none']]
print(imp_stats.to_string())

# 2. Solo vs Composite Effect (Testing the User's Attribution Hypothesis)
print("\n" + "="*80)
print("=== 2. SOLO VS COMPOSITE (CONFOUNDING) ATTRIBUTION ANALYSIS ===")
print("="*80)
solo_vs_comp = df.groupby(['importance', 'is_solo']).agg(
    count=('peak_spread', 'count'),
    mean_peak_spr=('peak_spread', 'mean'),
    mean_1m_range_pips=('price_range_1m_pips', 'mean'),
    widen_rate_over_1pip=('peak_spread', lambda x: (x >= 0.010).mean() * 100)
)
print(solo_vs_comp.to_string())

# 3. Top High-Impact USD Indicators (Ranked by 1m Price Range & Spread Peak)
print("\n" + "="*80)
print("=== 3. TOP 25 MARKET-MOVING USD INDICATORS (Ranked by 1-min Volatility) ===")
print("="*80)
usd_high = df[(df['currency'] == 'USD') & (df['importance'].isin(['high', 'medium']))]
usd_summary = usd_high.groupby('event_clean').agg(
    count=('peak_spread', 'count'),
    solo_count=('is_solo', 'sum'),
    mean_1m_pips=('price_range_1m_pips', 'mean'),
    p90_1m_pips=('price_range_1m_pips', lambda x: np.percentile(x, 90)),
    max_1m_pips=('price_range_1m_pips', 'max'),
    mean_peak_spr=('peak_spread', 'mean'),
    p90_peak_spr=('peak_spread', lambda x: np.percentile(x, 90)),
    mean_pre_vel=('pre_spread_velocity', 'mean'),
    importance=('importance', 'first')
)
usd_top25 = usd_summary[usd_summary['count'] >= 10].sort_values('mean_1m_pips', ascending=False).head(25)
print(usd_top25[['importance', 'count', 'solo_count', 'mean_1m_pips', 'p90_1m_pips', 'max_1m_pips', 'mean_peak_spr', 'p90_peak_spr', 'mean_pre_vel']].to_string())

# 4. Top JPY, EUR, GBP, AUD Indicators on USD/JPY
print("\n" + "="*80)
print("=== 4. TOP FOREIGN & JPY INDICATORS IMPACT ON USD/JPY ===")
print("="*80)
foreign_df = df[(df['currency'].isin(['JPY', 'EUR', 'GBP', 'AUD'])) & (df['importance'] == 'high')]
foreign_summary = foreign_df.groupby(['currency', 'event_clean']).agg(
    count=('peak_spread', 'count'),
    mean_1m_pips=('price_range_1m_pips', 'mean'),
    max_1m_pips=('price_range_1m_pips', 'max'),
    mean_peak_spr=('peak_spread', 'mean'),
    p90_peak_spr=('peak_spread', lambda x: np.percentile(x, 90)),
    mean_pre_vel=('pre_spread_velocity', 'mean')
)
foreign_top = foreign_summary[foreign_summary['count'] >= 10].sort_values('mean_1m_pips', ascending=False).head(20)
print(foreign_top.to_string())

# 5. Build Calibrated Indicator Profile Matrix
print("\n" + "="*80)
print("=== 5. BUILDING CALIBRATED INDICATOR MATRIX (JSON) ===")
print("="*80)

# Indicator profiling logic:
# Classify each indicator into Tier:
# Tier 1 (Super Heavy): mean_1m_pips >= 20.0 or p90_1m_pips >= 35.0
# Tier 2 (Heavy): mean_1m_pips >= 10.0 or p90_1m_pips >= 18.0
# Tier 3 (Moderate): mean_1m_pips >= 5.0
# Tier 4 (Minor / Unaffected): mean_1m_pips < 5.0 and mean_peak_spr < 0.008

all_summary = df.groupby(['currency', 'event_clean']).agg(
    count=('peak_spread', 'count'),
    importance=('importance', 'first'),
    mean_1m_pips=('price_range_1m_pips', 'mean'),
    p90_1m_pips=('price_range_1m_pips', lambda x: np.percentile(x, 90)),
    mean_peak_spr=('peak_spread', 'mean'),
    p90_peak_spr=('peak_spread', lambda x: np.percentile(x, 90)),
    mean_pre_vel=('pre_spread_velocity', 'mean'),
    pre_max_spr=('pre_max_spread', 'mean')
).reset_index()

matrix = {}
for _, r in all_summary.iterrows():
    ccy = r['currency']
    name = r['event_clean']
    m_pips = float(r['mean_1m_pips'])
    p90_pips = float(r['p90_1m_pips'])
    m_spr = float(r['mean_peak_spr'])
    p90_spr = float(r['p90_peak_spr'])
    pre_vel = float(r['mean_pre_vel'])
    
    if m_pips >= 20.0 or p90_pips >= 35.0:
        tier = 1
        dmm_base_pre = 0.025
        dmm_base_peak = 0.039
        advance_sec = 25
        recovery_sec = 60
    elif m_pips >= 10.0 or p90_pips >= 18.0:
        tier = 2
        dmm_base_pre = 0.015
        dmm_base_peak = 0.030
        advance_sec = 15
        recovery_sec = 40
    elif m_pips >= 5.0 or m_spr >= 0.010:
        tier = 3
        dmm_base_pre = 0.008
        dmm_base_peak = 0.018
        advance_sec = 10
        recovery_sec = 25
    else:
        tier = 4
        dmm_base_pre = 0.002
        dmm_base_peak = 0.002
        advance_sec = 0
        recovery_sec = 0
        
    key = f"{ccy}:{name}"
    matrix[key] = {
        'currency': ccy,
        'event_name': name,
        'importance': r['importance'],
        'sample_count': int(r['count']),
        'tier': tier,
        'mean_1m_pips': round(m_pips, 2),
        'p90_1m_pips': round(p90_pips, 2),
        'mean_oanda_peak_spread': round(m_spr, 4),
        'p90_oanda_peak_spread': round(p90_spr, 4),
        'mean_pre_velocity': round(pre_vel, 4),
        'dmm_advance_seconds': advance_sec,
        'dmm_base_pre_spread': dmm_base_pre,
        'dmm_base_peak_spread': dmm_base_peak,
        'dmm_recovery_seconds': recovery_sec
    }

matrix_out_path = os.path.join(PROJECT_ROOT, 'data', 'analysis', 'indicator_profile_matrix.json')
with open(matrix_out_path, 'w', encoding='utf-8') as f:
    json.dump(matrix, f, ensure_ascii=False, indent=2)

print(f"Successfully generated profile matrix for {len(matrix):,} indicators -> {matrix_out_path}")
