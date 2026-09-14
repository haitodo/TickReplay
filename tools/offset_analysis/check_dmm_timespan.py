"""
DMMのファイル構造、ファイル名、および記録されている日時の詳細確認
"""
import polars as pl
from pathlib import Path
from datetime import datetime

data_dir = Path(r"D:\dev\data")

# 2026年9月1日のDMMファイル
p_sep01 = list((data_dir / "DMM" / "USDJPY" / "year=2026" / "month=09" / "day=01").glob("*.parquet"))[0]
df = pl.read_parquet(p_sep01).sort("ts_ms")

print("=== DMM Day=01 Details ===")
print("First 5 rows:")
for r in df.head(5).iter_rows(named=True):
    print(r)

print("\nLast 5 rows:")
for r in df.tail(5).iter_rows(named=True):
    print(r)

print(f"\nRow count: {df.shape[0]}")
print(f"Time span in file: {df['ts_ms'].min()}  to  {df['ts_ms'].max()}")
