//+------------------------------------------------------------------+
//|                                                       Config.mqh |
//|                                  Copyright 2026, Google DeepMind |
//|                        (TickReplay 定数・構造体・列挙型定義)      |
//+------------------------------------------------------------------+
#ifndef __TICKREPLAY_CONFIG_MQH__
#define __TICKREPLAY_CONFIG_MQH__

#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property strict

//--- Win32 API パイプ定数
#define GENERIC_READ          0x80000000
#define GENERIC_WRITE         0x40000000
#define OPEN_EXISTING         3
#define INVALID_HANDLE_VALUE  -1
#define SW_SHOWNORMAL         1

//--- 共通列挙型 (Enumerations)
enum ENUM_REPLAY_SPEED_MODE
{
    REPLAY_MODE_TEMPORAL, // 時間比率モード（実際の時間の流れをN倍速にする）
    REPLAY_MODE_COUNT     // ティック枚数モード（1タイマー周期あたり固定N枚流す）
};

//--- チャートレイアウト情報構造体
struct ChartLayoutInfo
{
   string            tpl_path;
   ENUM_TIMEFRAMES   period;
   int               floating;
   int               win_left;
   int               win_top;
   int               win_right;
   int               win_bottom;
   int               float_left;
   int               float_top;
   int               float_right;
   int               float_bottom;
   bool              show_grid; // グリッド表示フラグ (true: 表示, false: 非表示)
};

//--- 仮想取引システム用構造体
struct VirtualPosition
{
   int               ticket;           // 一意のチケットID
   string            symbol;           // 銘柄名
   ENUM_POSITION_TYPE type;            // ポジションタイプ (POSITION_TYPE_BUY / POSITION_TYPE_SELL)
   double            volume;           // 取引数量 (ロット)
   double            open_price;       // エントリー価格
   datetime          open_time;        // エントリー仮想時間
   long              open_time_msc;    // エントリー仮想時間 (ミリ秒)
   double            close_price;      // 決済価格 (保有中は0)
   datetime          close_time;       // 決済仮想時間 (保有中は0)
   long              close_time_msc;   // 決済仮想時間 (ミリ秒)
   double            sl;               // ストップロス価格 (0で無効)
   double            tp;               // テイクプロフィット価格 (0で無効)
   double            current_price;    // 現在価格 (評価用)
   double            commission;       // 手数料 (仮想)
   double            swap;             // スワップ (仮想)
   double            profit;           // 評価・実現損益 (仮想)
   string            close_reason;     // 決済理由 ("MANUAL", "SL", "TP")
   
   // --- 分析用追加パラメータ ---
   double            mfe_pips;         // 最大順行幅 (MFE)
   double            mae_pips;         // 最大逆行幅 (MAE)
   double            spread_entry;     // エントリー時スプレッド (pips)
   double            volatility;       // エントリー直前60秒間の高低レンジ (pips)
   ulong             volume_60s;       // エントリー直前60秒間の積算出来高
};

#endif // __TICKREPLAY_CONFIG_MQH__
