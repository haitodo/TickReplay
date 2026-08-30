import pandas as pd
import numpy as np
import io
import sys

import os

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
parquet_path = os.path.join(PROJECT_ROOT, 'data', 'analysis', 'historical_events_full_2016_2026.parquet')
df = pd.read_parquet(parquet_path)

# Filter high & medium events
df_hm = df[df['importance'].isin(['high', 'medium'])].copy()

# Correlation matrix
corr_cols = ['price_range_1m_pips', 'price_range_3m_pips', 'peak_spread', 'pre_spread_velocity', 'tick_accel', 'ticks_1m']
corr = df_hm[corr_cols].corr()
print("=== CORRELATION MATRIX (High/Medium Indicators) ===")
print(corr.round(3).to_string())

# Regression: Relationship between Price Range and OANDA Peak Spread
# In DMM, max spread is capped at 3.9銭 (0.039) on USDJPY.
# Standard spread is 0.2銭 (0.002).
# Profile Base Spread + Dynamic Multiplier
# DMM Spread Model:
# S_dmm(t) = min(MaxSpread, BaseSpread + alpha * (OANDA_Spread - BaseOANDA) + beta * Price_Velocity)

print("\n=== SPREAD VS PRICE VOLATILITY QUANTILES ===")
df_hm['range_bin'] = pd.qcut(df_hm['price_range_1m_pips'], q=[0, 0.5, 0.8, 0.95, 0.99, 1.0], duplicates='drop')
binned = df_hm.groupby('range_bin', observed=False).agg(
    count=('peak_spread', 'count'),
    mean_range=('price_range_1m_pips', 'mean'),
    mean_oanda_spr=('peak_spread', 'mean'),
    p90_oanda_spr=('peak_spread', lambda x: np.percentile(x, 90)),
    max_oanda_spr=('peak_spread', 'max')
)
print(binned.to_string())
