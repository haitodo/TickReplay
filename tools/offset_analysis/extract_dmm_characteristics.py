"""
DMMクォート特性パラメータ抽出スクリプト
DMMサンプルデータおよびOANDAティックデータから、DMM擬似クォート生成エンジン用の
統計パラメータを算出し、analysis/scripts/dmm_quote_characteristics.json に保存する。
"""

import io
import json
import math
import sys
from pathlib import Path
import numpy as np
import polars as pl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

data_dir = Path(r"D:\dev\data")
repo_dir = Path(r"D:\dev\TickReplay")
output_json_path = repo_dir / "analysis" / "scripts" / "dmm_quote_characteristics.json"
output_json_path.parent.mkdir(parents=True, exist_ok=True)

print("=== Loading DMM Data ===")
dmm_frames = []
dmm_base = data_dir / "DMM" / "USDJPY"
for pf in sorted(dmm_base.rglob("*.parquet")):
    try:
        df = pl.read_parquet(pf)
        if df.shape[0] == 0:
            continue
        for c in ["ts", "ts_ms", "received_at"]:
            if c in df.columns:
                dt = df[c].dtype
                if hasattr(dt, "time_zone") and dt.time_zone is not None:
                    df = df.with_columns(pl.col(c).dt.replace_time_zone(None))
        dmm_frames.append(df)
    except Exception as e:
        print(f"Error loading {pf}: {e}")

dmm_all = pl.concat(dmm_frames).sort("ts_ms")
dmm_all = dmm_all.with_columns([
    pl.col("ts_ms").dt.epoch("ms").alias("utc_ms"),
    ((pl.col("bid") + pl.col("ask")) / 2.0).alias("mid"),
])
print(f"Loaded {dmm_all.shape[0]:,} DMM ticks")

# JST hour calculation
dmm_all = dmm_all.with_columns([
    ((pl.col("utc_ms") // 1000 + 9 * 3600) % 86400 // 3600).alias("jst_hour"),
    (pl.col("utc_ms") // 1000).alias("sec"),
])

# 1. TPS by JST hour
print("Calculating TPS by JST hour...")
tps_df = (
    dmm_all.group_by(["jst_hour", "sec"])
    .agg(pl.len().alias("tps"))
    .group_by("jst_hour")
    .agg([
        pl.col("tps").mean().alias("mean_tps"),
        pl.col("tps").median().alias("median_tps"),
    ])
    .sort("jst_hour")
)

tps_by_hour = {}
tps_array = [3.5] * 24  # default fallback
for row in tps_df.iter_rows():
    h = int(row[0])
    mean_tps = round(float(row[1]), 2)
    tps_by_hour[str(h)] = mean_tps
    tps_array[h] = mean_tps

# 2. Price change rate and step sizes
print("Calculating step size and price change rate...")
dmm_diffs = dmm_all.with_columns([
    pl.col("mid").diff().alias("dmid"),
    pl.col("bid").diff().alias("dbid"),
    pl.col("ask").diff().alias("dask"),
]).filter(pl.col("dmid").is_not_null())

nonzero_dmid = dmm_diffs.filter(pl.col("dmid").abs() > 0.0001)
price_change_rate = round(nonzero_dmid.shape[0] / dmm_diffs.shape[0], 4)

abs_steps = nonzero_dmid["dmid"].abs().to_numpy()
step_p50 = float(np.percentile(abs_steps, 50))
step_p75 = float(np.percentile(abs_steps, 75))
step_p90 = float(np.percentile(abs_steps, 90))

# 3. Spread distribution
spread_vals = (
    dmm_all["spread"].to_numpy()
    if "spread" in dmm_all.columns
    else (dmm_all["ask"] - dmm_all["bid"]).to_numpy()
)
spread_p50 = float(np.percentile(spread_vals, 50))
spread_p90 = float(np.percentile(spread_vals, 90))
spread_p95 = float(np.percentile(spread_vals, 95))
spread_p99 = float(np.percentile(spread_vals, 99))

characteristics = {
    "symbol": "USDJPY",
    "total_dmm_ticks_analyzed": dmm_all.shape[0],
    "tick_frequency_tps_by_jst_hour": tps_by_hour,
    "tps_array_jst_0_to_23": tps_array,
    "price_change_rate": price_change_rate,
    "mid_price_step_size": 0.001,
    "step_percentiles": {
        "p50": round(step_p50, 4),
        "p75": round(step_p75, 4),
        "p90": round(step_p90, 4),
    },
    "deadband_threshold": 0.0005,
    "ema_alpha": 0.15,
    "spread_stats": {
        "p50": round(spread_p50, 4),
        "p90": round(spread_p90, 4),
        "p95": round(spread_p95, 4),
        "p99": round(spread_p99, 4),
    },
}

with open(output_json_path, "w", encoding="utf-8") as f:
    json.dump(characteristics, f, indent=2, ensure_ascii=False)

print(f"Successfully generated characteristics JSON at: {output_json_path}")
print(json.dumps(characteristics, indent=2, ensure_ascii=False))
