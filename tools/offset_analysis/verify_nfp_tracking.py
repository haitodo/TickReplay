"""
急変動時における価格追従性・遅延の検証スクリプト
雇用統計発表時（2026-09-04 21:30 JST）における、
OANDA、DMM実測、Pseudo-DMM の「価格波形（軌跡）」と「初動遅延」を比較する。
"""

import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import polars as pl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

data_dir = Path(r"D:\dev\data")
repo_dir = Path(r"D:\dev\TickReplay")

oanda = pl.read_parquet(data_dir / "OANDA" / "USDJPY" / "year=2026" / "month=09" / "data.parquet").sort("utc_ms")
dmm_frames = []
for pf in sorted((data_dir / "DMM" / "USDJPY" / "year=2026" / "month=09").rglob("*.parquet")):
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
    except:
        pass
dmm_all = pl.concat(dmm_frames).sort("ts_ms").with_columns([
    pl.col("ts_ms").dt.epoch("ms").alias("utc_ms"),
    ((pl.col("bid") + pl.col("ask")) / 2.0).alias("mid"),
])

# NFP 雇用統計: 2026-09-04 12:30:00 UTC
t_event = int(datetime(2026, 9, 4, 12, 30, 0, tzinfo=timezone.utc).timestamp() * 1000)

# Window: T-5s 〜 T+30s
oanda_win = oanda.filter((pl.col("utc_ms") >= t_event - 5000) & (pl.col("utc_ms") <= t_event + 30000))
dmm_win = dmm_all.filter((pl.col("utc_ms") >= t_event - 5000) & (pl.col("utc_ms") <= t_event + 30000))

def simulate_pseudo_dmm(oanda_df):
    mt5_ms_list = oanda_df["mt5_ms"].to_list()
    utc_ms_list = oanda_df["utc_ms"].to_list()
    bid_list = oanda_df["bid"].to_list()
    ask_list = oanda_df["ask"].to_list()

    pseudo_ticks = []
    ema_mid = 0.0
    last_quantized_mid = 0.0
    last_emitted_msc = 0
    last_emitted_mid = 0.0
    last_emitted_spread = 0.002

    for i in range(len(mt5_ms_list)):
        mt5_time_msc = mt5_ms_list[i]
        utc_time_msc = utc_ms_list[i]
        raw_bid = bid_list[i]
        raw_ask = ask_list[i]
        raw_mid = (raw_bid + raw_ask) / 2.0
        raw_oanda_spread = abs(raw_ask - raw_bid)

        if ema_mid == 0.0:
            ema_mid = raw_mid
            last_quantized_mid = round(raw_mid * 1000.0) / 1000.0
        else:
            ema_mid += 0.15 * (raw_mid - ema_mid)

        delta = abs(ema_mid - last_quantized_mid)
        if delta >= 0.0005:
            quantized = round(ema_mid * 1000.0) / 1000.0
            last_quantized_mid = quantized
            mid = quantized
        else:
            mid = last_quantized_mid

        target_spread = 0.002
        if raw_oanda_spread > 0.015:
            target_spread = 0.002 + 0.25 * (raw_oanda_spread - 0.015)
        final_spread = max(0.002, min(0.160, target_spread))

        dt_msc = mt5_time_msc - last_emitted_msc
        d_mid = abs(mid - last_emitted_mid)
        d_spr = abs(final_spread - last_emitted_spread)

        if last_emitted_msc > 0:
            if d_mid < 0.0005 and d_spr < 0.0002:
                if dt_msc < 250:
                    continue
            elif dt_msc < 20:
                continue

        last_emitted_msc = mt5_time_msc
        last_emitted_mid = mid
        last_emitted_spread = final_spread

        pseudo_ticks.append({
            "utc_ms": utc_time_msc,
            "mid": mid,
            "spread": final_spread,
        })

    return pl.DataFrame(pseudo_ticks) if pseudo_ticks else pl.DataFrame()

pseudo_win = simulate_pseudo_dmm(oanda_win)

print("=== NFP EVENT: PRICE TRACKING COMPARISON (T-5s to T+30s) ===")
print(f"OANDA initial mid at T:  {oanda_win.filter(pl.col('utc_ms') >= t_event)['bid'][0]:.3f}")
if dmm_win.filter(pl.col('utc_ms') >= t_event).shape[0] > 0:
    print(f"DMM initial mid at T:    {dmm_win.filter(pl.col('utc_ms') >= t_event)['mid'][0]:.3f}")
print(f"Pseudo initial mid at T: {pseudo_win.filter(pl.col('utc_ms') >= t_event)['mid'][0]:.3f}")

# 5秒ごとの値幅（Min/Max/Move）
print(f"\n{'Window':>12} {'OANDA Min-Max':>18} {'OANDA Move':>12} {'Pseudo Min-Max':>18} {'Pseudo Move':>12} {'DMM Real Move':>14}")
for s_sec in range(0, 30, 5):
    e_sec = s_sec + 5
    s_ms = t_event + s_sec * 1000
    e_ms = t_event + e_sec * 1000
    
    o_seg = oanda_win.filter((pl.col("utc_ms") >= s_ms) & (pl.col("utc_ms") < e_ms))
    p_seg = pseudo_win.filter((pl.col("utc_ms") >= s_ms) & (pl.col("utc_ms") < e_ms))
    d_seg = dmm_win.filter((pl.col("utc_ms") >= s_ms) & (pl.col("utc_ms") < e_ms))
    
    o_min = (o_seg["bid"].min() + o_seg["ask"].min())/2 if o_seg.shape[0] > 0 else 0
    o_max = (o_seg["bid"].max() + o_seg["ask"].max())/2 if o_seg.shape[0] > 0 else 0
    o_move = (o_max - o_min) * 100
    
    p_min = p_seg["mid"].min() if p_seg.shape[0] > 0 else 0
    p_max = p_seg["mid"].max() if p_seg.shape[0] > 0 else 0
    p_move = (p_max - p_min) * 100
    
    d_move = ((d_seg["mid"].max() - d_seg["mid"].min()) * 100) if d_seg.shape[0] > 0 else 0
    
    print(f"T+{s_sec:02d}s..T+{e_sec:02d}s: {o_min:>8.3f}-{o_max:<8.3f} {o_move:>10.1f}p {p_min:>8.3f}-{p_max:<8.3f} {p_move:>10.1f}p {d_move:>12.1f}p")

# 発表直後10秒間の全ティックを出力して初動の応答性を比較
print(f"\n=== FIRST 20 TICKS RIGHT AFTER T (T+0s onwards) ===")
o_first = oanda_win.filter(pl.col("utc_ms") >= t_event).head(15)
p_first = pseudo_win.filter(pl.col("utc_ms") >= t_event).head(15)

print("\nOANDA Raw First Ticks:")
for r in o_first.iter_rows():
    rel_ms = r[0] - t_event
    mid = (r[2] + r[3]) / 2.0
    print(f"  +{rel_ms:>5}ms: bid={r[2]:.3f}, ask={r[3]:.3f}, mid={mid:.3f}")

print("\nPseudo-DMM First Ticks:")
for r in p_first.iter_rows():
    rel_ms = r[0] - t_event
    print(f"  +{rel_ms:>5}ms: mid={r[1]:.3f}, spr={r[2]:.4f}")
