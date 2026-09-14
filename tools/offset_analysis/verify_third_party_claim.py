"""
第三者の主張（DMM ts_ms は JST 壁時計時刻であり、-9時間補正するとOANDAと完全に一致する）の検証スクリプト
"""

import io
import sys
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import polars as pl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

data_dir = Path(r"D:\dev\data")

# OANDA読み込み (2026年9月)
oanda = pl.read_parquet(data_dir / "OANDA" / "USDJPY" / "year=2026" / "month=09" / "data.parquet").sort("utc_ms")
oanda = oanda.with_columns([
    ((pl.col("bid") + pl.col("ask")) / 2.0).alias("oanda_mid"),
    (pl.col("ask") - pl.col("bid")).alias("oanda_spread"),
])

# DMM読み込み (2026年9月1日)
dmm_p1 = list((data_dir / "DMM" / "USDJPY" / "year=2026" / "month=09" / "day=01").glob("*.parquet"))
if not dmm_p1:
    print("DMM day 01 not found!")
    sys.exit(1)

df_dmm = pl.read_parquet(dmm_p1[0]).sort("ts_ms")
for c in ["ts", "ts_ms", "received_at"]:
    if c in df_dmm.columns:
        dt = df_dmm[c].dtype
        if hasattr(dt, "time_zone") and dt.time_zone is not None:
            df_dmm = df_dmm.with_columns(pl.col(c).dt.replace_time_zone(None))

df_dmm = df_dmm.with_columns([
    pl.col("ts_ms").dt.epoch("ms").alias("dmm_raw_epoch_ms"),
    ((pl.col("bid") + pl.col("ask")) / 2.0).alias("dmm_mid"),
])

# ============================================================
# 1. 第三者が提示した具体例の数値確認
# ============================================================
print("=" * 70)
print("1. CHECKING SPECIFIC TICK CITED BY THIRD-PARTY (2026-09-01 first tick)")
print("=" * 70)

first_dmm = df_dmm.head(1)
dmm_epoch = first_dmm["dmm_raw_epoch_ms"][0]
dmm_mid = first_dmm["dmm_mid"][0]
dmm_ts_str = str(first_dmm["ts_ms"][0])

print(f"DMM ts_ms string:        {dmm_ts_str}")
print(f"DMM ts_ms epoch(ms):     {dmm_epoch}")
print(f"DMM mid:                 {dmm_mid:.4f}")

# ケースA: 直接結合 (dmm_epoch をそのまま OANDA utc_ms として探索)
nearest_direct = oanda.filter(
    (pl.col("utc_ms") >= dmm_epoch - 500) & (pl.col("utc_ms") <= dmm_epoch + 500)
).sort("utc_ms").head(1)

if nearest_direct.shape[0] > 0:
    o_mid_direct = nearest_direct["oanda_mid"][0]
    o_utc_direct = nearest_direct["utc_ms"][0]
    print(f"\n[Case A: Direct (No Shift)]")
    print(f"  Nearest OANDA utc_ms:  {o_utc_direct} (diff = {o_utc_direct - dmm_epoch}ms)")
    print(f"  OANDA mid:             {o_mid_direct:.4f}")
    print(f"  Difference (OANDA-DMM):{o_mid_direct - dmm_mid:+.4f} ({(o_mid_direct - dmm_mid)*100:+.2f} pips)")

# ケースB: -9時間補正 (dmm_epoch - 9*3600*1000)
shifted_epoch = dmm_epoch - 9 * 3600 * 1000
nearest_shifted = oanda.filter(
    (pl.col("utc_ms") >= shifted_epoch - 500) & (pl.col("utc_ms") <= shifted_epoch + 500)
).sort("utc_ms").head(1)

if nearest_shifted.shape[0] > 0:
    o_mid_shifted = nearest_shifted["oanda_mid"][0]
    o_utc_shifted = nearest_shifted["utc_ms"][0]
    print(f"\n[Case B: -9 Hours Shift (DMM treated as JST wall-clock)]")
    print(f"  Shifted epoch(ms):     {shifted_epoch}")
    print(f"  Nearest OANDA utc_ms:  {o_utc_shifted} (diff = {o_utc_shifted - shifted_epoch}ms)")
    print(f"  OANDA mid:             {o_mid_shifted:.4f}")
    print(f"  Difference (OANDA-DMM):{o_mid_shifted - dmm_mid:+.4f} ({(o_mid_shifted - dmm_mid)*100:+.2f} pips)")

# ============================================================
# 2. 2026年9月1日 全日の比較 (直接 vs -9時間シフト)
# ============================================================
print("\n" + "=" * 70)
print("2. FULL DAY EVALUATION (2026-09-01): Direct vs -9 Hours Shift")
print("=" * 70)

# 1秒バーで比較
dmm_1s_direct = df_dmm.with_columns([
    (pl.col("dmm_raw_epoch_ms") // 1000).alias("sec")
]).group_by("sec").agg(pl.col("dmm_mid").mean().alias("dmm_mid"))

dmm_1s_shifted = df_dmm.with_columns([
    ((pl.col("dmm_raw_epoch_ms") - 9 * 3600 * 1000) // 1000).alias("sec")
]).group_by("sec").agg(pl.col("dmm_mid").mean().alias("dmm_mid"))

oanda_1s = oanda.with_columns([
    (pl.col("utc_ms") // 1000).alias("sec")
]).group_by("sec").agg(pl.col("oanda_mid").mean().alias("oanda_mid"))

# Case A: Direct
j_direct = oanda_1s.join(dmm_1s_direct, on="sec", how="inner").with_columns([
    (pl.col("dmm_mid") - pl.col("oanda_mid")).alias("diff")
])

# Case B: Shifted -9h
j_shifted = oanda_1s.join(dmm_1s_shifted, on="sec", how="inner").with_columns([
    (pl.col("dmm_mid") - pl.col("oanda_mid")).alias("diff")
])

print(f"Case A (Direct):  Joined bars = {j_direct.shape[0]:,}")
if j_direct.shape[0] > 0:
    diff_d = j_direct["diff"].to_numpy()
    mae_d = np.mean(np.abs(diff_d))
    p95_d = np.percentile(np.abs(diff_d), 95)
    corr_d = np.corrcoef(j_direct["oanda_mid"].to_numpy(), j_direct["dmm_mid"].to_numpy())[0, 1]
    print(f"  MAE:         {mae_d:.6f} ({mae_d*100:.2f} pips)")
    print(f"  Median diff: {np.median(diff_d):+.6f} ({np.median(diff_d)*100:+.2f} pips)")
    print(f"  95% error:   {p95_d:.6f} ({p95_d*100:.2f} pips)")
    print(f"  Correlation: {corr_d:.6f}")

print(f"\nCase B (-9h shift): Joined bars = {j_shifted.shape[0]:,}")
if j_shifted.shape[0] > 0:
    diff_s = j_shifted["diff"].to_numpy()
    mae_s = np.mean(np.abs(diff_s))
    p95_s = np.percentile(np.abs(diff_s), 95)
    corr_s = np.corrcoef(j_shifted["oanda_mid"].to_numpy(), j_shifted["dmm_mid"].to_numpy())[0, 1]
    print(f"  MAE:         {mae_s:.6f} ({mae_s*100:.2f} pips)")
    print(f"  Median diff: {np.median(diff_s):+.6f} ({np.median(diff_s)*100:+.2f} pips)")
    print(f"  95% error:   {p95_s:.6f} ({p95_s*100:.2f} pips)")
    print(f"  Correlation: {corr_s:.6f}")

# ============================================================
# 3. 複数日 (9月1日〜9月11日) での検証
# ============================================================
print("\n" + "=" * 70)
print("3. MULTI-DAY VERIFICATION (Sep 01 to Sep 11)")
print("=" * 70)
print(f"{'Date':>10} {'Direct MAE':>14} {'Shifted(-9h) MAE':>18} {'Direct Corr':>14} {'Shifted Corr':>14}")

dmm_base = data_dir / "DMM" / "USDJPY" / "year=2026" / "month=09"
for day_dir in sorted(dmm_base.glob("day=*")):
    pfs = list(day_dir.glob("*.parquet"))
    if not pfs:
        continue
    try:
        df_d = pl.read_parquet(pfs[0]).sort("ts_ms")
        for c in ["ts", "ts_ms"]:
            if c in df_d.columns:
                dt = df_d[c].dtype
                if hasattr(dt, "time_zone") and dt.time_zone is not None:
                    df_d = df_d.with_columns(pl.col(c).dt.replace_time_zone(None))
        df_d = df_d.with_columns([
            pl.col("ts_ms").dt.epoch("ms").alias("epoch_ms"),
            ((pl.col("bid") + pl.col("ask")) / 2.0).alias("dmm_mid"),
        ])
        
        # Direct 1s
        d_dir = df_d.with_columns([(pl.col("epoch_ms") // 1000).alias("sec")]).group_by("sec").agg(pl.col("dmm_mid").mean())
        # Shifted 1s
        d_shf = df_d.with_columns([((pl.col("epoch_ms") - 9 * 3600 * 1000) // 1000).alias("sec")]).group_by("sec").agg(pl.col("dmm_mid").mean())
        
        j_d = oanda_1s.join(d_dir, on="sec", how="inner")
        j_s = oanda_1s.join(d_shf, on="sec", how="inner")
        
        mae_dir = np.mean(np.abs(j_d["dmm_mid"].to_numpy() - j_d["oanda_mid"].to_numpy())) if j_d.shape[0] > 10 else 0
        corr_dir = np.corrcoef(j_d["dmm_mid"].to_numpy(), j_d["oanda_mid"].to_numpy())[0, 1] if j_d.shape[0] > 10 else 0
        
        mae_shf = np.mean(np.abs(j_s["dmm_mid"].to_numpy() - j_s["oanda_mid"].to_numpy())) if j_s.shape[0] > 10 else 0
        corr_shf = np.corrcoef(j_s["dmm_mid"].to_numpy(), j_s["oanda_mid"].to_numpy())[0, 1] if j_s.shape[0] > 10 else 0
        
        day_str = day_dir.name
        print(f"{day_str:>10} {mae_dir*100:>12.2f}p {mae_shf*100:>16.2f}p {corr_dir:>14.4f} {corr_shf:>14.4f}")
    except Exception as e:
        pass
