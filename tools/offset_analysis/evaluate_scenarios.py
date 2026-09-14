"""
各相場局面におけるティック密度・挙動の徹底検証スクリプト

検証対象の場面:
1. 経済指標発表時 (例: 2026年9月4日 21:30 JST 米雇用統計)
2. 突発急変動時 (直近10秒間の値幅が10pips以上の急変場面)
3. 通常平時 (東京・ロンドン・NYの通常取引時間帯)
4. 閑散時 (早朝や取引の薄い時間帯、値動きがほぼない場面)

比較項目:
- DMM実測ティックの秒間密度 (TPS) & 挙動 (ステップサイズ、価格ジャンプ速度)
- OANDAティックの秒間密度 (TPS)
- 疑似DMMが生成する秒間密度 (TPS) と間引きの適切性
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

# 特性定数のロード
char_path = repo_dir / "analysis" / "scripts" / "dmm_quote_characteristics.json"
with open(char_path, "r", encoding="utf-8") as f:
    chars = json.load(f)

tps_by_hour = chars["tps_array_jst_0_to_23"]
EMA_ALPHA = chars["ema_alpha"]
DEADBAND = chars["deadband_threshold"]

print("=== Loading Overlapping Data ===")
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

dmm_all = pl.concat(dmm_frames).sort("ts_ms")
dmm_all = dmm_all.with_columns([
    pl.col("ts_ms").dt.epoch("ms").alias("utc_ms"),
    ((pl.col("bid") + pl.col("ask")) / 2.0).alias("mid"),
    (pl.col("ask") - pl.col("bid")).alias("spread"),
])

print(f"OANDA total: {oanda.shape[0]:,}")
print(f"DMM total: {dmm_all.shape[0]:,}")

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
            ema_mid += EMA_ALPHA * (raw_mid - ema_mid)

        delta = abs(ema_mid - last_quantized_mid)
        if delta >= DEADBAND:
            quantized = round(ema_mid * 1000.0) / 1000.0
            last_quantized_mid = quantized
            mid = quantized
        else:
            mid = last_quantized_mid

        jst_ms = utc_time_msc + 9 * 3600 * 1000
        jst_sec = jst_ms // 1000
        jst_hour = (jst_sec % 86400) // 3600

        target_spread = 0.002
        if raw_oanda_spread > 0.015:
            target_spread = 0.002 + 0.25 * (raw_oanda_spread - 0.015)
        final_spread = max(0.002, min(0.160, target_spread))

        dt_msc = mt5_time_msc - last_emitted_msc
        d_mid = abs(mid - last_emitted_mid)
        d_spr = abs(final_spread - last_emitted_spread)

        target_tps = tps_by_hour[min(23, max(0, jst_hour))]
        min_interval_ms = int(1000.0 / target_tps)

        if last_emitted_msc > 0:
            if d_mid < 0.0005 and d_spr < 0.0002:
                if dt_msc < min_interval_ms:
                    continue
            elif dt_msc < 20:
                continue

        last_emitted_msc = mt5_time_msc
        last_emitted_mid = mid
        last_emitted_spread = final_spread

        pseudo_ticks.append({
            "utc_ms": utc_time_msc,
            "sec": utc_time_msc // 1000,
            "mid": mid,
            "spread": final_spread,
        })

    return pl.DataFrame(pseudo_ticks) if pseudo_ticks else pl.DataFrame()

# ============================================================
# 場面 1: 経済指標発表時 (米雇用統計: 2026-09-04 12:30:00 UTC = 21:30 JST)
# ============================================================
print("\n" + "=" * 65)
print("SCENARIO 1: HIGH-IMPACT ECONOMIC EVENT (US NFP: 2026-09-04 21:30 JST)")
print("=" * 65)
# Window: 21:29:00 〜 21:35:00 JST (12:29:00 〜 12:35:00 UTC)
t_event_utc_ms = int(datetime(2026, 9, 4, 12, 30, 0, tzinfo=timezone.utc).timestamp() * 1000)
t_start_ms = t_event_utc_ms - 60_000   # 1分前
t_end_ms   = t_event_utc_ms + 300_000  # 5分後

oanda_nfp = oanda.filter((pl.col("utc_ms") >= t_start_ms) & (pl.col("utc_ms") <= t_end_ms))
dmm_nfp = dmm_all.filter((pl.col("utc_ms") >= t_start_ms) & (pl.col("utc_ms") <= t_end_ms))
pseudo_nfp = simulate_pseudo_dmm(oanda_nfp)

print(f"Time window: 21:29:00 - 21:35:00 JST (6 minutes)")
print(f"Total ticks in window:")
print(f"  OANDA:      {oanda_nfp.shape[0]:,} ticks (avg {oanda_nfp.shape[0]/360:.1f} tps)")
print(f"  DMM (Real): {dmm_nfp.shape[0]:,} ticks (avg {dmm_nfp.shape[0]/360:.1f} tps)")
print(f"  Pseudo-DMM: {pseudo_nfp.shape[0]:,} ticks (avg {pseudo_nfp.shape[0]/360:.1f} tps)")

# Peak TPS around event (T to T+10s)
t_peak_end = t_event_utc_ms + 10_000
oanda_peak = oanda_nfp.filter((pl.col("utc_ms") >= t_event_utc_ms) & (pl.col("utc_ms") <= t_peak_end)).shape[0] / 10.0
dmm_peak   = dmm_nfp.filter((pl.col("utc_ms") >= t_event_utc_ms) & (pl.col("utc_ms") <= t_peak_end)).shape[0] / 10.0
pseudo_peak = pseudo_nfp.filter((pl.col("utc_ms") >= t_event_utc_ms) & (pl.col("utc_ms") <= t_peak_end)).shape[0] / 10.0

print(f"\nPeak 10 seconds right after release (T to T+10s):")
print(f"  OANDA peak TPS:      {oanda_peak:.1f} tps")
print(f"  DMM (Real) peak TPS: {dmm_peak:.1f} tps")
print(f"  Pseudo-DMM peak TPS: {pseudo_peak:.1f} tps")

# 1秒ごとのTPS推移 (T-5s to T+15s)
print(f"\nSecond-by-second TPS around release:")
print(f"{'Rel Sec':>8} {'OANDA TPS':>12} {'DMM Real TPS':>14} {'Pseudo TPS':>12}")
for rel_s in range(-5, 15):
    s_ms = t_event_utc_ms + rel_s * 1000
    e_ms = s_ms + 1000
    o_cnt = oanda_nfp.filter((pl.col("utc_ms") >= s_ms) & (pl.col("utc_ms") < e_ms)).shape[0]
    d_cnt = dmm_nfp.filter((pl.col("utc_ms") >= s_ms) & (pl.col("utc_ms") < e_ms)).shape[0]
    p_cnt = pseudo_nfp.filter((pl.col("utc_ms") >= s_ms) & (pl.col("utc_ms") < e_ms)).shape[0]
    print(f"{rel_s:>+8}s {o_cnt:>12} {d_cnt:>14} {p_cnt:>12}")

# ============================================================
# 場面 2: 突発急変動時 (10秒間で20pips以上の急変動が発生した区間を探索)
# ============================================================
print("\n" + "=" * 65)
print("SCENARIO 2: SUDDEN MARKET SPIKE / INCIDENT NEWS")
print("=" * 65)

# OANDAの1秒バーから急変動箇所を探す
oanda_1s = oanda.with_columns([(pl.col("utc_ms") // 1000).alias("sec")]).group_by("sec").agg([
    ((pl.col("bid").max() + pl.col("ask").max())/2 - (pl.col("bid").min() + pl.col("ask").min())/2).alias("high_low"),
    pl.col("utc_ms").min().alias("start_utc_ms"),
]).sort("high_low", descending=True)

top_spike = oanda_1s.head(1)
spike_time_ms = top_spike["start_utc_ms"][0]
spike_dt = datetime.fromtimestamp(spike_time_ms / 1000, tz=timezone.utc)
print(f"Found largest volatility spike at: {spike_dt} UTC")

# その前後のウィンドウ (60秒間)
w_start = spike_time_ms - 30_000
w_end   = spike_time_ms + 30_000

oanda_spk = oanda.filter((pl.col("utc_ms") >= w_start) & (pl.col("utc_ms") <= w_end))
dmm_spk = dmm_all.filter((pl.col("utc_ms") >= w_start) & (pl.col("utc_ms") <= w_end))
pseudo_spk = simulate_pseudo_dmm(oanda_spk)

print(f"Window: ±30s around spike (60s total)")
print(f"  OANDA ticks:      {oanda_spk.shape[0]:,} (avg {oanda_spk.shape[0]/60:.1f} tps)")
print(f"  DMM (Real) ticks: {dmm_spk.shape[0]:,} (avg {dmm_spk.shape[0]/60:.1f} tps)")
print(f"  Pseudo-DMM ticks: {pseudo_spk.shape[0]:,} (avg {pseudo_spk.shape[0]/60:.1f} tps)")

# ============================================================
# 場面 3: 通常平時 (東京・ロンドン・NYの活発時間帯)
# ============================================================
print("\n" + "=" * 65)
print("SCENARIO 3: NORMAL TRADING HOURS (Tokyo 10:00 JST / London 16:00 JST / NY 22:00 JST)")
print("=" * 65)

test_sessions = [
    ("Tokyo Regular (10:00-10:10 JST)", datetime(2026, 9, 3, 1, 0, 0, tzinfo=timezone.utc)),
    ("London Regular (16:00-16:10 JST)", datetime(2026, 9, 3, 7, 0, 0, tzinfo=timezone.utc)),
    ("NY Regular (22:00-22:10 JST)", datetime(2026, 9, 3, 13, 0, 0, tzinfo=timezone.utc)),
]

for label, start_dt in test_sessions:
    s_ms = int(start_dt.timestamp() * 1000)
    e_ms = s_ms + 600_000  # 10 minutes
    o_sub = oanda.filter((pl.col("utc_ms") >= s_ms) & (pl.col("utc_ms") <= e_ms))
    d_sub = dmm_all.filter((pl.col("utc_ms") >= s_ms) & (pl.col("utc_ms") <= e_ms))
    p_sub = simulate_pseudo_dmm(o_sub)
    print(f"\n{label}:")
    print(f"  OANDA:      {o_sub.shape[0]:>5} ticks (avg {o_sub.shape[0]/600:.2f} tps)")
    print(f"  DMM Real:   {d_sub.shape[0]:>5} ticks (avg {d_sub.shape[0]/600:.2f} tps)")
    print(f"  Pseudo DMM: {p_sub.shape[0]:>5} ticks (avg {p_sub.shape[0]/600:.2f} tps)")

# ============================================================
# 場面 4: 閑散時 (全く動かない時間、オセアニア早朝など)
# ============================================================
print("\n" + "=" * 65)
print("SCENARIO 4: QUIET / LOW-VOLATILITY HOURS (Early Morning 05:00-05:30 JST)")
print("=" * 65)

quiet_dt = datetime(2026, 9, 3, 20, 0, 0, tzinfo=timezone.utc) # 05:00 JST
s_ms = int(quiet_dt.timestamp() * 1000)
e_ms = s_ms + 1800_000 # 30 minutes
o_quiet = oanda.filter((pl.col("utc_ms") >= s_ms) & (pl.col("utc_ms") <= e_ms))
d_quiet = dmm_all.filter((pl.col("utc_ms") >= s_ms) & (pl.col("utc_ms") <= e_ms))
p_quiet = simulate_pseudo_dmm(o_quiet)

print(f"Early Morning 05:00-05:30 JST (30 minutes):")
print(f"  OANDA:      {o_quiet.shape[0]:>5} ticks (avg {o_quiet.shape[0]/1800:.2f} tps)")
print(f"  DMM Real:   {d_quiet.shape[0]:>5} ticks (avg {d_quiet.shape[0]/1800:.2f} tps)")
print(f"  Pseudo DMM: {p_quiet.shape[0]:>5} ticks (avg {p_quiet.shape[0]/1800:.2f} tps)")

print("\n=== SCENARIO EVALUATION COMPLETE ===")
