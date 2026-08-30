import sqlite3
import pandas as pd
import numpy as np
import os
import sys
import argparse
import time

def parse_args():
    parser = argparse.ArgumentParser(description='Drenhis Economic Calendar Parquet Partition Exporter')
    parser.add_argument('--db-path', default=r'data\drehis\news.db', help='Path to drehis news.db')
    parser.add_argument('--output-dir', default=r'D:\Drehis\economic', help='Target directory for partitioned Parquet files')
    parser.add_argument('--symbol', default='USDJPY', help='Target symbol/pair (USDJPY, EURUSD, GBPJPY, ALL)')
    parser.add_argument('--force', action='store_true', help='Force overwrite all partitions regardless of diff')
    return parser.parse_args()

CURRENCY_MAPPING = {
    'USDJPY': ['USD', 'JPY', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'CNY'],
    'EURUSD': ['EUR', 'USD', 'GBP', 'JPY', 'CHF'],
    'GBPJPY': ['GBP', 'JPY', 'USD', 'EUR'],
    'ALL': None
}

def export_partitions():
    args = parse_args()
    t_start = time.time()
    
    db_path = os.path.abspath(args.db_path)
    output_root = os.path.abspath(args.output_dir)
    symbol = args.symbol.upper()
    
    if not os.path.exists(db_path):
        print(f"[Error] Database not found at: {db_path}", file=sys.stderr)
        sys.exit(1)
        
    print(f"=== DREHIS ECONOMIC CALENDAR PARQUET EXPORTER ===")
    print(f"Source DB   : {db_path}")
    print(f"Output Root : {output_root}")
    print(f"Symbol      : {symbol}")
    print(f"Force Mode  : {args.force}")
    
    conn = sqlite3.connect(db_path)
    
    ccy_filter = CURRENCY_MAPPING.get(symbol, None)
    if ccy_filter:
        ccy_placeholders = ','.join([f"'{c}'" for c in ccy_filter])
        ccy_clause = f"AND i.currency_code IN ({ccy_placeholders})"
    else:
        ccy_clause = ""
        
    query = f"""
    SELECT 
        e.id AS event_id,
        e.release_date AS utc_ms,
        datetime(e.release_date/1000, 'unixepoch') AS release_utc,
        i.currency_code AS currency,
        i.event_name,
        i.importance,
        i.country,
        i.event_type,
        e.actual_num,
        e.forecast_num,
        e.previous_num,
        e.actual_value,
        e.forecast_value,
        e.unit,
        e.impact_direction,
        e.impact_value
    FROM economic_events e
    JOIN economic_indicators i ON e.indicator_id = i.id
    WHERE e.release_date > 0 {ccy_clause}
    ORDER BY e.release_date;
    """
    
    df_all = pd.read_sql_query(query, conn)
    conn.close()
    
    print(f"Loaded {len(df_all):,} records from SQLite.")
    if len(df_all) == 0:
        print("[Info] No records found.")
        return
        
    # JST timestamp calculation for Partitioning (year=YYYY/month=MM)
    # JST is UTC + 9 hours
    df_all['jst_dt'] = pd.to_datetime(df_all['utc_ms'] + 9*3600*1000, unit='ms')
    df_all['year'] = df_all['jst_dt'].dt.strftime('%Y')
    df_all['month'] = df_all['jst_dt'].dt.strftime('%m')
    df_all.drop(columns=['jst_dt'], inplace=True)
    
    sym_folder = os.path.join(output_root, symbol.lower())
    os.makedirs(sym_folder, exist_ok=True)
    
    grouped = df_all.groupby(['year', 'month'])
    total_months = len(grouped)
    written_count = 0
    skipped_count = 0
    
    print(f"\n--- Checking Diff & Writing Hive Partitions ({total_months} months) ---")
    
    for (year_str, month_str), group in grouped:
        part_dir = os.path.join(sym_folder, f"year={year_str}", f"month={month_str}")
        part_file = os.path.join(part_dir, "events.parquet")
        
        db_count = len(group)
        db_max_id = int(group['event_id'].max())
        
        # Delta / Diff check
        needs_write = True
        if not args.force and os.path.exists(part_file):
            try:
                # Read metadata without reading entire payload
                existing_df = pd.read_parquet(part_file, columns=['event_id'])
                if len(existing_df) == db_count and existing_df['event_id'].max() == db_max_id:
                    needs_write = False
            except Exception:
                needs_write = True
                
        if needs_write:
            os.makedirs(part_dir, exist_ok=True)
            # Remove partition keys from payload to keep parquet super clean
            cols_to_save = [c for c in group.columns if c not in ['year', 'month']]
            group[cols_to_save].to_parquet(part_file, index=False, compression='snappy')
            written_count += 1
        else:
            skipped_count += 1
            
    print(f"\n=== EXPORT COMPLETED in {time.time() - t_start:.2f}s ===")
    print(f"Total Partitions : {total_months}")
    print(f"Written/Updated  : {written_count}")
    print(f"Skipped (No diff): {skipped_count}")
    print(f"Destination      : {sym_folder}")

if __name__ == '__main__':
    export_partitions()
