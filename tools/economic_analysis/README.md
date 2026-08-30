# 経済指標・スプレッド履歴分析＆プロファイル自動生成ツール

本ディレクトリには、10年間（2016〜2026年）のOANDAティックデータと drehis/news.db の経済指標データを高速突合し、指標別スプレッドプロファイルや相関分析を行うための再利用可能なスクリプト群が格納されています。

---

## 📁 ディレクトリ構成

- **	ools/economic_analysis/**
  - **un_full_extraction.py**: 全120ヶ月分のZIPデータ（約2.4億ティック）と10万件超の指標イベントを16コア並列で高速抽出・スライシングし、Parquetファイルを生成するツール。
  - **nalyze_matrix.py**: 生成されたParquetを読み込み、単独 vs 同時発表の交絡分離、通貨別影響度ランキング、および全902指標の最適スプレッドパラメータ（JSON）を出力するツール。
  - **it_reverse_formula.py**: OANDAスプレッドと価格ボラティリティの相関分析およびDMMスプレッド逆算回帰モデルを評価するツール。
  - **README.md**: 本手順書。

- **data/analysis/**（永続バックアップ保存先）
  - **historical_events_full_2016_2026.parquet**: 全104,949件のイベントスライス特徴量データセット（3.41 MB）。
  - **indicator_profile_matrix.json**: EA/MQL5やシミュレータにそのまま読み込める指標プロファイル辞書（436 KB）。

---

## 🚀 実行方法（いつでも再分析可能）

### 1. 全量抽出の再実行（新しいティックデータや年が追加された場合）
`ash
py -3.11 tools/economic_analysis/run_full_extraction.py
`
- 所要時間: 約5〜6分（全120ファイル・2.4億ティック）
- 出力: data/analysis/historical_events_full_2016_2026.parquet

### 2. 統計分析＆プロファイルJSONの再生成
`ash
py -3.11 tools/economic_analysis/analyze_matrix.py
`
- 所要時間: 約1秒
- 出力: data/analysis/indicator_profile_matrix.json

### 3. 相関＆逆算式の評価
`ash
py -3.11 tools/economic_analysis/fit_reverse_formula.py
`
