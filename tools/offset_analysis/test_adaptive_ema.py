"""
適応型EMA (Adaptive EMA) の効果検証スクリプト
通常時は alpha=0.15 でマイクロノイズを平滑化し、
急変時 (diff > 0.010 = 1pip以上) は alpha を動的に引き上げて即座にジャンプ追従させる。
"""

import io
import sys
from datetime import datetime, timezone
from pathlib import Path
import polars as pl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
data_dir = Path(r"D:\dev\data")

oanda = pl.read_parquet(data_dir / "OANDA" / "USDJPY" / "year=2026" / "month=09" / "data.parquet").sort("utc_ms")
t_event = int(datetime(2026, 9, 4, 12, 30, 0, tzinfo=timezone.utc).timestamp() * 1000)
oanda_win = oanda.filter((pl.col("utc_ms") >= t_event - 1000) & (pl.col("utc_ms") <= t_event + 10000))

def test_alpha_mode(adaptive=False):
    mt5_ms = oanda_win["mt5_ms"].to_list()
    utc_ms = oanda_win["utc_ms"].to_list()
    bids = oanda_win["bid"].to_list()
    asks = oanda_win["ask"].to_list()
    
    ema = 0.0
    last_q = 0.0
    res = []
    
    for i in range(len(mt5_ms)):
        raw_mid = (bids[i] + asks[i]) / 2.0
        if ema == 0.0:
            ema = raw_mid
            last_q = round(raw_mid * 1000.0) / 1000.0
        else:
            diff = abs(raw_mid - ema)
            if adaptive:
                # 急変動時はalphaをブースト
                alpha = 0.80 if diff > 0.010 else (0.40 if diff > 0.003 else 0.15)
            else:
                alpha = 0.15
            ema += alpha * (raw_mid - ema)
            
        delta = abs(ema - last_q)
        if delta >= 0.0005:
            last_q = round(ema * 1000.0) / 1000.0
            mid = last_q
        else:
            mid = last_q
            
        res.append((utc_ms[i], mid))
    return res

fixed_res = test_alpha_mode(adaptive=False)
adapt_res = test_alpha_mode(adaptive=True)

print(f"{'Rel ms':>8} {'OANDA Raw Mid':>14} {'Fixed α=0.15':>14} {'Adaptive α':>14}")
for i in range(min(25, len(fixed_res))):
    rel = fixed_res[i][0] - t_event
    raw = (oanda_win["bid"][i] + oanda_win["ask"][i]) / 2.0
    fix = fixed_res[i][1]
    adp = adapt_res[i][1]
    print(f"{rel:>+7}ms {raw:>14.3f} {fix:>14.3f} {adp:>14.3f}")
