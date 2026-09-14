"""
正しいJST時間軸でDMMの真の特性を再集計するスクリプト
DMMの ts_ms 表記はすでに日本時間 (JST壁時計時刻) である。
したがって、ts_ms.dt.hour() がそのまま JST hour である。
"""
import io, sys, json
from pathlib import Path
import polars as pl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
data_dir = Path(r"D:\dev\data")

dmm_frames = []
for pf in sorted((data_dir / "DMM" / "USDJPY" / "year=2026" / "month=09").rglob("*.parquet")):
    try:
        df = pl.read_parquet(pf)
        if df.shape[0] == 0: continue
        for c in ["ts", "ts_ms", "received_at"]:
            if c in df.columns:
                dt = df[c].dtype
                if hasattr(dt, "time_zone") and dt.time_zone is not None:
                    df = df.with_columns(pl.col(c).dt.replace_time_zone(None))
        dmm_frames.append(df)
    except:
        pass

dmm_all = pl.concat(dmm_frames).sort("ts_ms")
print(f"Loaded {dmm_all.shape[0]:,} DMM ticks")

# 正しいJST時刻: ts_ms はすでにJST
dmm_all = dmm_all.with_columns([
    pl.col("ts_ms").dt.hour().alias("true_jst_hour"),
    pl.col("ts_ms").dt.minute().alias("true_jst_min"),
    (pl.col("ts_ms").dt.epoch("ms") // 1000).alias("sec"),
    ((pl.col("bid") + pl.col("ask")) / 2.0).alias("mid"),
])

# 時間帯別TPSの真の集計
tps_true = (
    dmm_all.group_by(["true_jst_hour", "sec"])
    .agg(pl.len().alias("tps"))
    .group_by("true_jst_hour")
    .agg(pl.col("tps").mean().alias("mean_tps"))
    .sort("true_jst_hour")
)

print("\n=== TRUE JST HOURLY TPS (DMM Real) ===")
print(f"{'JST Hour':>8} {'True Mean TPS':>14}")
true_tps_arr = [3.5] * 24
for r in tps_true.iter_rows():
    h = int(r[0])
    val = round(float(r[1]), 2)
    true_tps_arr[h] = val
    print(f"{h:>8} {val:>14.2f}")

print(f"\ntrue_tps_array = {true_tps_arr}")
