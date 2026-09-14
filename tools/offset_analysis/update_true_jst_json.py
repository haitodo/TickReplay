"""
dmm_quote_characteristics.json を真のJST時間帯TPSで更新するスクリプト
"""
import json
from pathlib import Path

repo_dir = Path(r"D:\dev\TickReplay")
char_path = repo_dir / "analysis" / "scripts" / "dmm_quote_characteristics.json"

with open(char_path, "r", encoding="utf-8") as f:
    chars = json.load(f)

# 真のJST時間帯別TPS (早朝2.7TPS → 東京4.7TPS → ロンドン5.4TPS → NY6.1TPS)
true_tps_array = [
    4.98, 4.45, 4.15, 4.30, 4.16,  # 00-04 JST (NYクローズ後・オセアニア)
    3.04, 2.71, 2.66, 3.84,        # 05-08 JST (早朝閑散・ロールオーバー帯)
    4.70, 4.73, 4.13, 3.72, 3.86,  # 09-13 JST (東京セッション・仲値)
    4.21, 5.32, 5.18, 5.46,        # 14-17 JST (欧州プレ・ロンドンオープン)
    4.61, 4.70, 5.11,              # 18-20 JST (欧州コア)
    6.07, 6.09, 5.75               # 21-23 JST (NYオープン・米指標コア・1日最大ピーク)
]

tps_by_hour = {str(h): true_tps_array[h] for h in range(24)}

chars["tick_frequency_tps_by_jst_hour"] = tps_by_hour
chars["tps_array_jst_0_to_23"] = true_tps_array
chars["note"] = "Corrected: DMM ts_ms was verified as JST wall-clock, true JST hours applied."

with open(char_path, "w", encoding="utf-8") as f:
    json.dump(chars, f, indent=2, ensure_ascii=False)

print("Updated dmm_quote_characteristics.json with TRUE JST TPS:")
print(json.dumps(tps_by_hour, indent=2))
