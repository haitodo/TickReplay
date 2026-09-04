//+------------------------------------------------------------------+
//|                                     TickReplayControllerEA.mq5   |
//|                                  Copyright 2026, Google DeepMind |
//|                                           https://deepmind.google |
//|                        (Tauri 名前付きパイプIPC版 v3.00)          |
//+------------------------------------------------------------------+
#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property version   "3.00"
#property strict

// Replay back-pressure: source ticks are never dropped. A bounded batch keeps
// one timer callback from monopolizing MT5 when the virtual clock jumps.
input int InpMaxTicksPerTimer = 2000;

double m_tick_accumulator = 0.0;
int    m_main_fail_count = 0;

//--- Win32 API Named Pipe インポート
#import "kernel32.dll"
long CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, long lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, long hTemplateFile);
int WriteFile(long hFile, uchar &lpBuffer[], uint nNumberOfBytesToWrite, uint &lpNumberOfBytesWritten, long lpOverlapped);
int ReadFile(long hFile, uchar &lpBuffer[], uint nNumberOfBytesToRead, uint &lpNumberOfBytesRead, long lpOverlapped);
int PeekNamedPipe(long hNamedPipe, long lpBuffer, uint nBufferSize, long lpBytesRead, uint &lpTotalBytesAvail, long lpBytesLeftThisMessage);
int WaitNamedPipeW(string lpNamedPipeName, uint nTimeOut);
int CloseHandle(long hObject);
#import

//--- Win32 API User32 インポート
#import "user32.dll"
long GetParent(long hWnd);
bool MoveWindow(long hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
bool ShowWindow(long hWnd, int nCmdShow);
#import

//--- Win32 API winmm (高精度マルチメディアタイマー制御) インポート
#import "winmm.dll"
uint timeBeginPeriod(uint uPeriod);
uint timeEndPeriod(uint uPeriod);
#import

#define GENERIC_READ          0x80000000
#define GENERIC_WRITE         0x40000000
#define OPEN_EXISTING         3
#define INVALID_HANDLE_VALUE  -1
#define SW_SHOWNORMAL         1

//--- 共通定数・列挙型 (Enumerations)
enum ENUM_REPLAY_SPEED_MODE
{
    REPLAY_MODE_TEMPORAL, // 時間比率モード（実際の時間の流れをN倍速にする）
    REPLAY_MODE_COUNT     // ティック枚数モード（1タイマー周期あたり固定N枚流す）
};

//--- Inputパラメータ定義
input int    InpTimerMs  = 10;    // タイマーの周期（ミリ秒、推奨: 10ms = 100Hz）

//--- コントローラーEA内部の状態変数
string                  m_replay_symbol;        // 生成するカスタムシンボルの名前
string                  m_source_symbol;        // 複製元となるリアル銘柄名
MqlTick                 m_all_ticks[];          // ロードした全ティック配列
int                     m_total_ticks = 0;      // ロードした総ティック数
int                     m_current_idx = 0;      // 現在再生中のティックの配列インデックス

//--- デュアルフィード（比較リプレイ）状態変数
bool                    m_enable_dual_feed = false; // デュアルフィード有効フラグ
string                  m_source_symbol_sub = "";   // サブ比較銘柄の元シンボル名
string                  m_replay_symbol_sub = "";   // サブ比較銘柄のリプレイシンボル名
MqlTick                 m_all_ticks_sub[];          // サブ比較銘柄の全ティック配列
int                     m_total_ticks_sub = 0;      // サブ比較銘柄の総ティック数
int                     m_current_idx_sub = 0;      // サブ比較銘柄の現在インデックス

bool                    m_is_playing = false;   // 再生中フラグ
ENUM_REPLAY_SPEED_MODE  m_speed_mode = REPLAY_MODE_TEMPORAL; // 再生速度制御のモード
double                  m_time_multiplier = 1.0;// 時間比率モード時の倍速 (1.0 = 等倍)
int                     m_tick_step_count = 1;  // ティック枚数モード時の1タイマーあたりの配信数
long                    m_virtual_current_msc = 0; // リプレイ内の仮想現在時刻（ミリ秒）
double                  m_virtual_current_msc_acc = 0.0; // 仮想現在時刻の高精度積算アキュムレータ（ミリ秒・小数部保持）
ulong                   m_last_real_timer_us = 0;  // 前回タイマー実行時のPCローカル時刻（マイクロ秒カウンタ）
long                    m_viewer_chart_ids[];   // 生成されたビューアーチャートのチャートID配列
ENUM_TIMEFRAMES         m_viewer_periods[];     // ビューアーチャートの時間軸配列
long                    m_loop_a_msc = -1;      // A-Bループの開始点A（ミリ秒、-1で未設定）
long                    m_loop_b_msc = -1;      // A-Bループの終了点B（ミリ秒、-1で未設定）
int                     m_loop_a_idx = -1;      // A-Bループ開始点Aのキャッシュインデックス
int                     m_loop_b_idx = -1;      // A-Bループ終了点Bのキャッシュインデックス
datetime                m_server_start_time = 0;// サーバー時間換算の開始日時
datetime                m_server_end_time = 0;  // サーバー時間換算の終了日時

//--- Tauriから送られてくる設定の保持
string                  m_profile_name = "";
bool                    InpAutoScrollSync = true;
int                     InpPreloadedBars = 300;
string                  m_preload_mode = "BARS"; // "BARS" または "DATE"
datetime                m_preload_start_time = 0; // 過去日付指定時の開始日時 (JST)
string                  m_preload_timeframe = "AUTO"; // プリロード基準時間足 ("AUTO", "M1", "M5", etc.)

//--- 履歴制限設定
bool                    m_limit_tick_history = true;
ENUM_TIMEFRAMES         m_tick_history_timeframe = PERIOD_M5;
int                     m_max_history_bars = 300;

//--- セッション設定変数（INITで動的に更新）
string                  InpTokyoCoreTime    = "08:45";
string                  InpLondonCoreSummer = "15:00";
string                  InpLondonCoreWinter = "16:00";
string                  InpNYCoreSummer     = "21:00";
string                  InpNYCoreWinter     = "22:00";

//--- Named Pipe IPC 状態変数
long                    hReplayPipe = INVALID_HANDLE_VALUE;     // 単一の全二重名前付きパイプハンドル
string                  m_accumulated_commands = "";            // 受信バッファ（後方互換用）
uchar                   m_ipc_raw_buf[];                        // IPC 受信ストリームバッファ（複数コマンド・バイナリ保持用）
int                     m_ipc_read_offset = 0;                  // IPC 受信ストリーム読み取りオフセット（ゼロコピー用）
bool                    m_session_boundaries_sent = false;      // セッション境界送信済みフラグ（差分ステータス用）
int                     m_last_sent_history_rev = -1;           // 前回送信した履歴リビジョン（差分ステータス用）
datetime                m_last_connect_attempt = 0;             // 前回の接続試行時刻
uint                    m_last_status_write = 0;                // 前回ステータス書き込み時刻
bool                    m_sync_enabled = false;                 // 同期処理の有効化フラグ
bool                    m_auto_skip_weekend = true;             // 週末などの休場期間を自動スキップするフラグ
bool                    m_initialized = false;                  // リプレイ初期化完了フラグ
bool                    m_hedging = false;                      // 両建て許可フラグ（デフォルトOFF）
bool                    m_pseudo_rate_enabled = true;          // 疑似レート生成機能の有効化フラグ
double                  m_domestic_base_spread = 0.002;         // 国内基準スプレッド（USDJPY: 0.2銭）
double                  m_mt5_threshold = 0.018;                // MT5側判定閾値（USDJPY実測最適: 1.8 pips）
double                  m_sensitivity_coeff = 0.30;             // 拡大感度（USDJPY実測最適: 0.30）
bool                    m_pseudo_rollover_enabled = true;      // 早朝ロールオーバー適応フラグ
double                  m_pseudo_rollover_spread = 0.035;       // 早朝ロールオーバー基準スプレッド
int                     m_pseudo_rollover_recovery_min = 15;    // 早朝復帰時間（分）

//--- 疑似DMMレート構造体
struct PseudoRate
{
   double bid;
   double ask;
   double spread;
};

PseudoRate m_pseudo_rates[]; // 全ティック分の疑似DMMレートキャッシュ

//--- 疑似DMM状態列挙型
enum ENUM_PSEUDO_STATE
{
   PSEUDO_STATE_NORMAL,
   PSEUDO_STATE_STRESS,
   PSEUDO_STATE_ROLLOVER_EXTREME,
   PSEUDO_STATE_ROLLOVER_MID,
   PSEUDO_STATE_ROLLOVER_WIDE,
   PSEUDO_STATE_RECOVERY
};

//--- チャートレイアウト情報構造体
struct ChartLayoutInfo
{
   string            tpl_path;
   string            target_symbol; // 割り当て対象シンボル (Main または Sub)
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

//--- 仮想取引システム用構造体および定数
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

//--- 仮想取引エンジン状態変数
int               m_next_ticket = 10001;        // 次の発行チケットID
double            m_account_initial_balance = 1000000.0; // 初期残高
double            m_account_balance = 1000000.0; // 仮想口座残商
double            m_account_equity = 1000000.0;  // 仮想口座有効残高
double            m_account_leverage = 25.0;     // レバレッジ
double            m_contract_size = 10000.0;     // 1ロットあたりの通貨数 (デフォルト1万)
double            m_account_margin = 0.0;        // 使用中の証拠金
double            m_account_free_margin = 1000000.0; // 余剰証拠金
double            m_account_margin_level = 0.0;  // 証拠金維持率 (%)

VirtualPosition   m_virtual_positions[];         // 保有ポジション配列
VirtualPosition   m_virtual_history[];           // 決済履歴の動的配列
bool              m_show_history = false;        // 決済履歴の表示有無
bool              m_history_json_dirty = true;   // 決済履歴JSONの再構築が必要かどうかのフラグ
int               m_history_revision = 0;        // 決済履歴の変更世代番号（UI比較用）
bool              m_status_dirty = true;         // 前回送信後に再生/取引状態が変化したか

//--- ミリ秒時間取得用キャリブレーション変数
long              gl_start_time_msc = 0;        // 起動時のPCローカル時間(ミリ秒)
ulong             gl_start_tick_count = 0;      // 起動時のGetMicrosecondCount(ミリ秒) 【修正: long から ulong へ変更】

//--- 新規追加の仮想取引関数宣言
void VirtualOrderOpen(string type_str, double volume, double sl_points, double tp_points);
void VirtualOrderClose(int ticket, double volume, string reason, bool trigger_reeval = true);
void VirtualOrderCloseEx(int ticket, double volume, string reason, double closePrice, long closeTimeMsc, int tick_idx = -1, bool trigger_reeval = true);
void VirtualOrderCloseAll(string reason);
void ExportTradeTicksJson(int ticket);
void VirtualOrderCloseBuy(string reason);
void VirtualOrderCloseSell(string reason);
void VirtualOrderModify(int ticket, double sl_price, double tp_price);
void EvaluatePositionsByTick(MqlTick &tick, int tick_idx = -1);
double CalculateVirtualProfit(string symbol, ENUM_POSITION_TYPE type, double volume, double openPrice, double currentPrice);
double CalculateVirtualProfitWithRate(ENUM_POSITION_TYPE type, double volume, double openPrice, double currentPrice, double conversion_rate);
double GetProfitConversionRate(string symbol);
void MarkTradeHistoryDirty();
void SetHistoryVisibility(bool show);
void RedrawHistoryObjects();
void UpdateChartObjects();
void ClearChartTradeObjects();
void ResetAccount(double initial_balance, double leverage);
string SerializePositionsAndHistoryToJson(bool include_history = true);
void SyncVirtualTradesOnSeek(long target_msc);

//--- 前方宣言
double RoundHalfUp(double value, int digits); // 厳密な四捨五入（ハーフアップ）
int ToUnit(double price, double unit);
double ToPrice(int units, double unit, int digits);
void PrecalculatePseudoRates();
bool GetPseudoRateAtIndex(int index, double &bid, double &ask, double &spread);
void GetPseudoRates(MqlTick &src_tick, double &out_bid, double &out_ask, double &out_spread); // 疑似レート・スプレッド計算
bool InitializeReplaySymbol(string replay_symbol, string source_symbol);
bool LoadHistoricalTicks(string source_symbol, datetime start, datetime end);
bool LoadHistoricalTicksEx(string source_symbol, datetime start, datetime end, MqlTick &out_ticks[], int &out_total);
void CreateMTFCharts(string main_symbol, string sub_symbol = "", bool enable_dual = false);
datetime ConvertServerToJST(datetime server_time);
datetime ConvertJSTToServer(datetime jst_time);
long FindExistingViewerChart(string symbol, ENUM_TIMEFRAMES period, long &exclude_ids[]);
ENUM_TIMEFRAMES StringToTimeframe(string tf_str);
int OpenChrFileForReading(string profile_file_path);
bool ProcessProfile(string profile_name, string main_symbol, string sub_symbol, bool enable_dual, ChartLayoutInfo &out_layouts[]);
ENUM_TIMEFRAMES GetTimeframeFromPeriod(int p_type, int p_size);
ENUM_TIMEFRAMES SecondsToTimeframe(int seconds);
void CleanTempTemplates();
int GetMaxPeriodSeconds(string profile_name);
datetime GetBarHistoryStartTime(string symbol, ENUM_TIMEFRAMES tf, datetime ref_time, int bar_count);
bool PreloadHistoricalRates(string source_symbol, string replay_symbol, datetime start_time, int max_period_sec);
void PrepareAdditionalSymbol(string sym, datetime start_time, datetime end_time, int max_period_sec = 60);
void SeekToPosition(int target_index);
int GetReplayBatchLimit();
bool IsSummerTimeEurope(datetime dt);
bool IsSummerTimeUS(datetime dt);
void ParseTimeStrings(string time_str, int &out_hour, int &out_min);
datetime AddDays(datetime time_val, int days);
datetime GetSessionStartForDate(datetime date_val, string session);
datetime FindPreviousSessionStart(datetime current_time, string session);
datetime FindNextSessionStart(datetime current_time, string session);
int FindTickIndexForward(datetime target_time);
int FindTickIndexBackward(datetime target_time);
int FindTickIndexByMsc(long target_msc);
void JumpToSessionStart(string session, bool is_advance);
void CalculateSessionBoundaries(string &out_tyo_json, string &out_ldn_json, string &out_ny_json);
void UpdateReplayGeneration();


//--- Named Pipe IPC用ヘルパー
void ClosePipes();
bool ConnectPipes(bool retry);
bool EnsurePipesConnected();
void WritePipeStatus(string message);
void CheckAndProcessCommand();
void WriteStatusFile();
void WriteReadyStatus();
void WriteErrorStatus(string message);
datetime ParseDateTime(string dt_str);
string GetJsonKeyValue(string json, string key);

//--- 同期ボタンUI用ヘルパー
void CreateSyncButton();
void UpdateSyncButtonUI();
void DeleteSyncButton();

//--- 軽量JSON解析用ヘルパー
string GetJsonString(string json, string key);
double GetJsonDouble(string json, string key);
bool GetJsonBool(string json, string key);

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("[Info] MT5 TickReplay 名前付きパイプIPC EA 起動中。");
   
   // Windows OS タイマー解像度を1msに設定（タイマージッター極小化）
   timeBeginPeriod(1);
   
   // ミリ秒時刻取得のキャリブレーション
   gl_start_time_msc = TimeLocal() * 1000;
   gl_start_tick_count = GetMicrosecondCount() / 1000;
   
   // ミリ秒タイマーの起動
   if(!EventSetMillisecondTimer(InpTimerMs))
   {
      Print("[Error] タイマー設定に失敗しました。");
      timeEndPeriod(1);
      return(INIT_FAILED);
   }
   
   // チャート上の同期ボタン作成
   CreateSyncButton();
   
   Print("[Info] EA起動完了。チャート上に同期ボタンを作成しました。");
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   // タイマーの停止
   EventKillTimer();
   
   // Windows OS タイマー解像度の復元
   timeEndPeriod(1);
   
   // ビューアーチャートの終了
   if(reason != REASON_PARAMETERS && reason != REASON_RECOMPILE && reason != REASON_CHARTCHANGE)
   {
      int total_charts = ArraySize(m_viewer_chart_ids);
      for(int i = 0; i < total_charts; i++)
      {
         if(m_viewer_chart_ids[i] > 0)
         {
            ChartClose(m_viewer_chart_ids[i]);
            m_viewer_chart_ids[i] = 0;
         }
      }
      
      // カスタムシンボルデータも削除（クリーンアップ徹底）
      if(m_replay_symbol != "")
      {
         CustomTicksDelete(m_replay_symbol, 0, LONG_MAX);
         CustomRatesDelete(m_replay_symbol, 0, LONG_MAX);
      }
      
      // 仮想取引データのクリーンアップ
      ArrayFree(m_virtual_positions);
      ArrayFree(m_virtual_history);
      ClearChartTradeObjects();
   }
   ArrayFree(m_viewer_chart_ids);
   ArrayFree(m_viewer_periods);
   
   // 一時生成したテンプレートファイルの削除とフォルダのクリーンアップ
   CleanTempTemplates();
   
   // ステータスパイプにDISCONNECTED通知を書き込み、パイプをクローズ
   WritePipeStatus("{\"status\":\"DISCONNECTED\"}");
   ClosePipes();
   
   // 同期ボタンのクリーンアップ
   DeleteSyncButton();
   
   Print("[Info] 仲介EAが終了しました。");
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   // タイマー駆動のため未使用
}

//+------------------------------------------------------------------+
//| 全ビューアーチャートの強制即時再描画                              |
//+------------------------------------------------------------------+
void RedrawAllViewerCharts()
{
   int total_charts = ArraySize(m_viewer_chart_ids);
   for(int c_idx = 0; c_idx < total_charts; c_idx++)
   {
      long cid = m_viewer_chart_ids[c_idx];
      if(cid > 0) ChartRedraw(cid);
   }
}

//+------------------------------------------------------------------+
//| Timer function                                                   |
//+------------------------------------------------------------------+
int GetReplayBatchLimit()
{
   // Very small batches amplify IPC/custom-symbol overhead; very large
   // batches make MT5 chart events visibly stutter. Keep the input bounded.
   int limit = InpMaxTicksPerTimer;
   if(limit < 64) limit = 64;
   if(limit > 10000) limit = 10000;
   return limit;
}

void OnTimer()
{
   // 1. パイプ接続の確認と再接続
   if(!EnsurePipesConnected())
      return;

   // 2. コマンドパイプの監視と処理
   CheckAndProcessCommand();
   
   // 3. 再生処理
   if(m_is_playing && m_total_ticks > 0 && m_current_idx < m_total_ticks)
   {
      // 経過時間（マイクロ秒）の高精度計算
      ulong current_real_us = GetMicrosecondCount();
      if(m_last_real_timer_us == 0)
      {
         m_last_real_timer_us = current_real_us;
         return;
      }
      else
      {
         ulong real_elapsed_us = 0;
         if(current_real_us > m_last_real_timer_us)
         {
            real_elapsed_us = current_real_us - m_last_real_timer_us;
            // 異常な時間跳躍（1秒以上の停止やPCスリープ等）を制限
            if(real_elapsed_us > 1000000)
               real_elapsed_us = 1000000;
            m_last_real_timer_us = current_real_us;
         }
         else if(m_last_real_timer_us - current_real_us > 1000000)
         {
            // PC時刻変更等による極端な後退時は基準時刻を再同期
            m_last_real_timer_us = current_real_us;
         }
         // current_real_us <= m_last_real_timer_us（微小ジッター）の場合は real_elapsed_us = 0 とし、
         // m_last_real_timer_us は引き下げずに維持（単調増加フィルタリング）

         double real_elapsed_msc = (double)real_elapsed_us / 1000.0;

         int start_idx = m_current_idx;
         int end_idx = m_current_idx;
         int batch_limit = GetReplayBatchLimit();

         //--- 【モードA: 時間比率モード】
         if(m_speed_mode == REPLAY_MODE_TEMPORAL)
         {
             // 仮想時刻が未設定(0)の場合のみ初期化
             if(m_virtual_current_msc <= 0 && m_current_idx < m_total_ticks)
             {
                m_virtual_current_msc = (long)m_all_ticks[m_current_idx].time_msc;
                m_virtual_current_msc_acc = (double)m_virtual_current_msc;
             }
             
             // 実経過ミリ秒に再生倍率を掛けた正確な時間を浮動小数点加算（ジッターによる離散化を排除）
             m_virtual_current_msc_acc += (real_elapsed_msc * m_time_multiplier);
             m_virtual_current_msc = (long)m_virtual_current_msc_acc;
            
            // 自動スキップが有効で、次のティックまでの空白が1時間（3,600,000ms）以上ある場合
            if(m_auto_skip_weekend && m_current_idx < m_total_ticks)
            {
               long next_tick_msc = (long)m_all_ticks[m_current_idx].time_msc;
               if(next_tick_msc - m_virtual_current_msc > 3600000)
               {
                  Print("[Info] 休場/週末の空白期間をスキップします。仮想時刻を ", 
                        TimeToString((datetime)(m_virtual_current_msc/1000), TIME_DATE|TIME_SECONDS), 
                        " から ", 
                        TimeToString((datetime)(next_tick_msc/1000), TIME_DATE|TIME_SECONDS), 
                        " に進めます。");
                  m_virtual_current_msc = next_tick_msc;
                  m_virtual_current_msc_acc = (double)next_tick_msc;
               }
            }
            
            while(end_idx < m_total_ticks && m_all_ticks[end_idx].time_msc <= m_virtual_current_msc)
            {
               end_idx++;
            }
         }
         //--- 【モードB: ティック枚数モード（実時間レート制御: m_tick_step_count Ticks / sec）】
         else if(m_speed_mode == REPLAY_MODE_COUNT)
         {
            m_tick_accumulator += (real_elapsed_msc / 1000.0) * (double)m_tick_step_count;
            int advance_count = (int)m_tick_accumulator;
            if(advance_count > batch_limit)
               advance_count = batch_limit;
            if(advance_count > 0)
            {
               m_tick_accumulator -= advance_count;
               end_idx = start_idx + advance_count;
               if(end_idx > m_total_ticks) end_idx = m_total_ticks;
               
               if(end_idx > start_idx)
               {
                  m_virtual_current_msc = m_all_ticks[end_idx - 1].time_msc;
                  m_virtual_current_msc_acc = (double)m_virtual_current_msc;
               }
            }
         }

         //--- A-Bループ判定: 終了点 B に到達した場合は開始点 A に戻る
         // Bound work per timer callback. The source stream remains lossless:
         // m_current_idx is advanced only by the batch actually evaluated.
         if(end_idx - start_idx > batch_limit)
         {
            end_idx = start_idx + batch_limit;
            // 時間比率モードにおいてバックプレッシャー発生時、仮想時計が実処理を追い越して
            // 先走るのを防ぐため、実際に評価可能な終端ティック時刻へクランプする（Graceful Slowdown）
            if(m_speed_mode == REPLAY_MODE_TEMPORAL && end_idx > start_idx)
            {
               long actual_evaluated_msc = (long)m_all_ticks[end_idx - 1].time_msc;
               m_virtual_current_msc = actual_evaluated_msc;
               m_virtual_current_msc_acc = (double)actual_evaluated_msc;
            }
         }

         // If the virtual clock leaps over B, deliver the queued source ticks
         // through B first. Otherwise a high multiplier can repeatedly jump
         // back to A without ever validating the interval A..B.
         int end_idx_before_loop = end_idx;
         bool loop_active = (m_loop_a_msc != -1 && m_loop_b_msc != -1 && m_loop_a_idx >= 0 && m_loop_b_idx >= 0);
         bool loop_boundary_pending = (loop_active && m_virtual_current_msc >= m_loop_b_msc && m_current_idx <= m_loop_b_idx);
         if(loop_boundary_pending && end_idx > m_loop_b_idx + 1)
            end_idx = m_loop_b_idx + 1;
         if(m_speed_mode == REPLAY_MODE_COUNT && end_idx < end_idx_before_loop)
            m_tick_accumulator += (end_idx_before_loop - end_idx);

         if(loop_active && m_virtual_current_msc >= m_loop_b_msc && m_current_idx > m_loop_b_idx)
         {
            if(m_loop_a_idx >= 0)
            {
               SeekToPosition(m_loop_a_idx);
               m_last_real_timer_us = GetMicrosecondCount(); // シーク後にタイマー基準時間をリセット
            }
         }
         else
         {
            bool ticks_delivered = false;

            // 抽出されたティックの一括配信 (Main)
            int count_to_send = end_idx - start_idx;
            if(count_to_send > 0)
            {
               static MqlTick send_array[];
               if(ArrayResize(send_array, count_to_send, 1000) >= 0)
               {
                  if(ArrayCopy(send_array, m_all_ticks, 0, start_idx, count_to_send) >= 0)
                  {
                     ResetLastError();
                     int added = CustomTicksAdd(m_replay_symbol, send_array);
                     if(added >= 0)
                     {
                        m_main_fail_count = 0;
                        // Validation follows the source stream, not the
                        // custom-symbol return count. Rendering can reject a
                        // duplicate while the strategy must still see it.
                        for(int k = 0; k < count_to_send; k++)
                           EvaluatePositionsByTick(m_all_ticks[start_idx + k], start_idx + k);
                        m_current_idx = end_idx;
                        m_status_dirty = true;
                        ticks_delivered = true;
                     }
                     else if(added < 0)
                     {
                        m_main_fail_count++;
                        int err = GetLastError();
                        if(m_main_fail_count <= 3 || m_main_fail_count % 50 == 0)
                           Print("[Warning] CustomTicksAdd failed (Main). Code: ", err, " count: ", m_main_fail_count);
                        if(m_main_fail_count > 5)
                        {
                           Print("[Error] CustomTicksAdd 連続失敗のため破損ティック(インデックス ", m_current_idx, ")をスキップします。");
                           m_current_idx++;
                           m_main_fail_count = 0;
                        }
                     }
                  }
               }
            }
            
            // デュアルフィード同期配信 (Sub): Mainシンボルの実際の進捗時刻に厳密同期させ、かつバッチ制限を適用
            if(m_enable_dual_feed && m_total_ticks_sub > 0 && m_replay_symbol_sub != "")
            {
               long target_sub_msc = (m_current_idx > 0) ? (long)m_all_ticks[m_current_idx - 1].time_msc : m_virtual_current_msc;
               int start_idx_sub = m_current_idx_sub;
               int end_idx_sub = start_idx_sub;
               while(end_idx_sub < m_total_ticks_sub && m_all_ticks_sub[end_idx_sub].time_msc <= target_sub_msc)
               {
                  end_idx_sub++;
               }
               if(end_idx_sub - start_idx_sub > batch_limit)
                  end_idx_sub = start_idx_sub + batch_limit;

               int count_sub = end_idx_sub - start_idx_sub;
               if(count_sub > 0)
               {
                  static MqlTick send_array_sub[];
                  if(ArrayResize(send_array_sub, count_sub, 1000) >= 0)
                  {
                     if(ArrayCopy(send_array_sub, m_all_ticks_sub, 0, start_idx_sub, count_sub) >= 0)
                     {
                        ResetLastError();
                        int added_sub = CustomTicksAdd(m_replay_symbol_sub, send_array_sub);
                        if(added_sub >= 0)
                        {
                           m_current_idx_sub = end_idx_sub;
                           m_status_dirty = true;
                           ticks_delivered = true;
                        }
                        else
                        {
                           Print("[Warning] CustomTicksAdd failed (Sub). Code: ", GetLastError());
                        }
                     }
                  }
               }
            }
            
            // 階層型スマート再描画更新: 時間足に応じた個別リフレッシュ
            static ulong s_last_redraw_m1_us = 0;
            static ulong s_last_redraw_m5_us = 0;
            static ulong s_last_redraw_htf_us = 0;

            ulong now_us = GetMicrosecondCount();

            // 再生速度に応じたアダプティブ再描画インターバル計算（超高速再生時のMT5 UIフリーズ防止）
            ulong interval_m1_us  = 16000;  // 通常: 60 FPS (~16ms)
            ulong interval_m5_us  = 50000;  // 通常: 20 FPS (~50ms)
            ulong interval_htf_us = 100000; // 通常: 10 FPS (~100ms)

            if(m_speed_mode == REPLAY_MODE_TEMPORAL)
            {
               if(m_time_multiplier >= 1000.0)
               {
                  interval_m1_us  = 70000;  // ~14 FPS
                  interval_m5_us  = 150000; // ~6.6 FPS
                  interval_htf_us = 300000; // ~3.3 FPS
               }
               else if(m_time_multiplier >= 100.0)
               {
                  interval_m1_us  = 50000;  // 20 FPS
                  interval_m5_us  = 100000; // 10 FPS
                  interval_htf_us = 200000; // 5 FPS
               }
               else if(m_time_multiplier >= 20.0)
               {
                  interval_m1_us  = 33000;  // 30 FPS
                  interval_m5_us  = 66000;  // 15 FPS
                  interval_htf_us = 150000; // 6.6 FPS
               }
            }
            else if(m_speed_mode == REPLAY_MODE_COUNT)
            {
               if(m_tick_step_count > 500)
               {
                  interval_m1_us  = 70000;  // ~14 FPS
                  interval_m5_us  = 150000; // ~6.6 FPS
                  interval_htf_us = 300000; // ~3.3 FPS
               }
               else if(m_tick_step_count > 100)
               {
                  interval_m1_us  = 50000;  // 20 FPS
                  interval_m5_us  = 100000; // 10 FPS
                  interval_htf_us = 200000; // 5 FPS
               }
               else if(m_tick_step_count > 20)
               {
                  interval_m1_us  = 33000;  // 30 FPS
                  interval_m5_us  = 66000;  // 15 FPS
                  interval_htf_us = 150000; // 6.6 FPS
               }
            }

            bool do_redraw_m1  = ((now_us > s_last_redraw_m1_us && now_us - s_last_redraw_m1_us >= interval_m1_us && ticks_delivered) || (now_us > s_last_redraw_m1_us && now_us - s_last_redraw_m1_us >= interval_m1_us * 3));
            bool do_redraw_m5  = ((now_us > s_last_redraw_m5_us && now_us - s_last_redraw_m5_us >= interval_m5_us && ticks_delivered) || (now_us > s_last_redraw_m5_us && now_us - s_last_redraw_m5_us >= interval_m5_us * 3));
            bool do_redraw_htf = ((now_us > s_last_redraw_htf_us && now_us - s_last_redraw_htf_us >= interval_htf_us && ticks_delivered) || (now_us > s_last_redraw_htf_us && now_us - s_last_redraw_htf_us >= interval_htf_us * 3));

            if(do_redraw_m1)  s_last_redraw_m1_us = now_us;
            if(do_redraw_m5)  s_last_redraw_m5_us = now_us;
            if(do_redraw_htf) s_last_redraw_htf_us = now_us;

            if(do_redraw_m1 || do_redraw_m5 || do_redraw_htf)
            {
               int total_charts = ArraySize(m_viewer_chart_ids);
               for(int c_idx = 0; c_idx < total_charts; c_idx++)
               {
                  long cid = m_viewer_chart_ids[c_idx];
                  if(cid <= 0) continue;
                  
                  ENUM_TIMEFRAMES p = (c_idx < ArraySize(m_viewer_periods)) ? m_viewer_periods[c_idx] : PERIOD_M1;
                  if(p <= PERIOD_M1)
                  {
                     if(do_redraw_m1) ChartRedraw(cid);
                  }
                  else if(p <= PERIOD_M5)
                  {
                     if(do_redraw_m5) ChartRedraw(cid);
                  }
                  else
                  {
                     if(do_redraw_htf) ChartRedraw(cid);
                  }
               }
            }
         }
      }
   }
   else if(m_is_playing && m_current_idx >= m_total_ticks)
   {
      m_is_playing = false;
      m_last_real_timer_us = 0;
      m_status_dirty = true;
      RedrawAllViewerCharts();
      Print("[Info] すべてのリプレイティック配信が完了しました。");
      WriteStatusFile();
   }
   else if(!m_is_playing)
   {
      // 停止中はタイマーのローカル基準時間をリフレッシュ
      m_last_real_timer_us = 0;
   }
   
   // 4. 定期的なステータス更新の書き込み
   // ティック更新時: 40ms間隔 (25FPS)
   // 無風区間（再生中だが新規ティックなし）: 100ms間隔 (10FPS) でUI時計を低負荷かつ滑らかに更新
   if(m_initialized && m_total_ticks > 0)
   {
      static ulong last_status_write_us = 0;
      ulong now_us = GetMicrosecondCount();
      ulong required_interval_us = m_status_dirty ? 40000 : 100000;
      bool is_time = (now_us > last_status_write_us) && (now_us - last_status_write_us >= required_interval_us);

      if((m_status_dirty || m_is_playing) && is_time)
      {
         WriteStatusFile();
         last_status_write_us = now_us;
      }
   }
   else if(m_sync_enabled && !m_is_playing)
   {
      // 停止中・待機中の定期ハートビート（1秒毎 = 1,000,000us）: フロントエンドとの同期状態を自動維持
      static ulong s_last_heartbeat_us = 0;
      ulong now_us = GetMicrosecondCount();
      if(now_us > s_last_heartbeat_us && now_us - s_last_heartbeat_us >= 1000000)
      {
         s_last_heartbeat_us = now_us;
         string heartbeat_status = StringFormat(
            "{\"status\":\"CONNECTED\",\"symbol\":\"%s\",\"ea_version\":\"3.00\"}",
            _Symbol
         );
         WritePipeStatus(heartbeat_status);
      }
   }
}

//+------------------------------------------------------------------+
//| コマンドパイプの監視と処理                                       |
#define TRBI_MAGIC 0x54524249

struct BinaryCommandPacket
{
   uint   magic;           // 0x54524249 ("TRBI")
   ushort cmd_type;        // 1: SEEK, 2: CONTROL, 3: PLAY, 4: PAUSE, 5: RESET
   ushort reserved;        // パディング
   long   target_index;    // SEEK用インデックス
   long   target_time_msc; // SEEK_TIME用タイムスタンプ
   double multiplier;      // 再生倍率
   int    tick_step;       // ステップ数
   uint   flags;           // フラグ
};

void ProcessBinaryCommand(const BinaryCommandPacket &packet)
{
#ifdef _DEBUG
   Print("[DEV-MQL5-BINARY] バイナリコマンド受信: type=", packet.cmd_type, " target_idx=", packet.target_index, " mult=", packet.multiplier);
#endif

   switch(packet.cmd_type)
   {
      case 1: // SEEK
         if(packet.target_index >= 0)
            SeekToPosition((int)packet.target_index);
         break;
      case 2: // CONTROL
         // A speed-mode change starts a new wall-clock segment. Do not carry
         // fractional COUNT progress across that boundary.
         m_tick_accumulator = 0.0;
         if(packet.multiplier > 0)
            m_time_multiplier = packet.multiplier;
         if(packet.tick_step > 0)
            m_tick_step_count = packet.tick_step;
         if((packet.flags & 0x02) != 0)
         {
            bool prev_playing = m_is_playing;
            m_is_playing = ((packet.flags & 0x01) != 0);
            if(!prev_playing && m_is_playing)
            {
               m_last_real_timer_us = 0;
            }
            else if(prev_playing && !m_is_playing)
            {
               m_last_real_timer_us = 0;
               m_tick_accumulator = 0.0;
               m_main_fail_count = 0;
               if(m_current_idx > 0 && m_current_idx <= m_total_ticks)
               {
                  m_virtual_current_msc = (long)m_all_ticks[m_current_idx - 1].time_msc;
                  m_virtual_current_msc_acc = (double)m_virtual_current_msc;
               }
               RedrawAllViewerCharts();
            }
         }
         if((packet.flags & 0x08) != 0)
         {
            m_speed_mode = ((packet.flags & 0x04) != 0) ? REPLAY_MODE_COUNT : REPLAY_MODE_TEMPORAL;
         }
         if((packet.flags & 0x10) != 0)
         {
            m_auto_skip_weekend = ((packet.flags & 0x20) != 0);
         }
         break;
      case 3: // PLAY
         m_is_playing = true;
         m_last_real_timer_us = 0;
         m_tick_accumulator = 0.0;
         break;
      case 4: // PAUSE
         m_is_playing = false;
         m_last_real_timer_us = 0;
         m_tick_accumulator = 0.0;
         m_main_fail_count = 0;
         if(m_current_idx > 0 && m_current_idx <= m_total_ticks)
         {
            m_virtual_current_msc = (long)m_all_ticks[m_current_idx - 1].time_msc;
            m_virtual_current_msc_acc = (double)m_virtual_current_msc;
         }
         RedrawAllViewerCharts();
         break;
      case 5: // RESET
         SeekToPosition(0);
         break;
      case 6: // SEEK_TIME
         if(packet.target_time_msc > 0)
         {
            int idx = FindTickIndexByMsc(packet.target_time_msc);
            if(idx >= 0) SeekToPosition(idx);
         }
         break;
      case 7: // SEEK_RELATIVE
         {
            int delta = (int)packet.target_index;
            if(delta != 0)
            {
               if(delta == -1 && m_current_idx > 1)
               {
                  int target_idx = m_current_idx - 2;
                  while(target_idx >= 0 && m_all_ticks[target_idx].time_msc == m_all_ticks[m_current_idx - 1].time_msc)
                  {
                     target_idx--;
                  }
                  if(target_idx >= 0) SeekToPosition(target_idx);
                  else SeekToPosition(0);
               }
               else
               {
                  int target_index = m_current_idx - 1 + delta;
                  SeekToPosition(target_index);
               }
            }
         }
         break;
      case 8: // TIME_JUMP
         {
            int delta_sec = (int)packet.target_index;
            if(delta_sec != 0)
            {
               datetime current_v_time = (datetime)(m_virtual_current_msc / 1000);
               datetime target_time = 0;
               int target_idx = -1;
               if(delta_sec > 0)
               {
                  datetime dest_time = current_v_time + delta_sec;
                  target_time = dest_time - (dest_time % 60);
                  if(target_time > m_server_end_time) target_time = m_server_end_time;
                  target_idx = FindTickIndexForward(target_time);
               }
               else
               {
                  int abs_delta = -delta_sec;
                  if(current_v_time >= (datetime)abs_delta)
                  {
                     datetime dest_time = current_v_time - abs_delta;
                     target_time = dest_time - (dest_time % 60);
                  }
                  else
                  {
                     target_time = m_server_start_time;
                  }
                  if(target_time < m_server_start_time) target_time = m_server_start_time;
                  target_idx = FindTickIndexForward(target_time);
               }
               if(target_idx >= 0) SeekToPosition(target_idx);
            }
         }
         break;
      case 9: // SESSION_JUMP
         {
            uint sess_code = packet.flags & 0x03;
            string sess_str = (sess_code == 1) ? "LDN" : (sess_code == 2) ? "NY" : "TYO";
            bool is_advance = ((packet.flags & 0x04) != 0);
            JumpToSessionStart(sess_str, is_advance);
         }
         break;
      case 10: // LOOP_SET_A
         m_loop_a_msc = m_virtual_current_msc;
         m_loop_a_idx = (m_current_idx > 0) ? (m_current_idx - 1) : 0;
         break;
      case 11: // LOOP_SET_B
         if(m_loop_a_msc != -1 && m_virtual_current_msc > m_loop_a_msc)
         {
            m_loop_b_msc = m_virtual_current_msc;
            m_loop_b_idx = (m_current_idx > 0) ? (m_current_idx - 1) : 0;
         }
         break;
      case 12: // LOOP_CLEAR
         m_loop_a_msc = -1;
         m_loop_b_msc = -1;
         m_loop_a_idx = -1;
         m_loop_b_idx = -1;
         break;
      default:
         break;
   }
   // コマンドによる状態変更も、次回の定期ステータス送信へ反映する
   m_status_dirty = true;
}

//+------------------------------------------------------------------+
void CheckAndProcessCommand()
{
   if(hReplayPipe == INVALID_HANDLE_VALUE)
      return;

   uint total_bytes_avail = 0;
   if(!PeekNamedPipe(hReplayPipe, 0, 0, 0, total_bytes_avail, 0))
   {
      Print("[Error] IPC Pipe Peek 失敗。Code: ", GetLastError());
      ClosePipes();
      return;
   }

   if(total_bytes_avail <= 0)
      return;

   // バッファの確保とデータの読み込み
   static uchar buf[];
   if(ArrayResize(buf, total_bytes_avail, 4096) < 0)
      return;

   uint bytes_read = 0;
   if(!ReadFile(hReplayPipe, buf, total_bytes_avail, bytes_read, 0))
   {
      Print("[Error] IPC Pipe 読み取り失敗。Code: ", GetLastError());
      ClosePipes();
      return;
   }

   if(bytes_read <= 0)
      return;

   // 読み込んだデータを未処理ストリームバッファへ追記
   int old_len = ArraySize(m_ipc_raw_buf);
   if(m_ipc_read_offset > 0)
   {
      int unconsumed = old_len - m_ipc_read_offset;
      if(unconsumed > 0 && m_ipc_read_offset < old_len)
      {
         uchar temp[];
         ArrayCopy(temp, m_ipc_raw_buf, 0, m_ipc_read_offset, unconsumed);
         ArrayResize(m_ipc_raw_buf, unconsumed + (int)bytes_read, 4096);
         ArrayCopy(m_ipc_raw_buf, temp, 0, 0, unconsumed);
         ArrayCopy(m_ipc_raw_buf, buf, unconsumed, 0, (int)bytes_read);
      }
      else
      {
         ArrayResize(m_ipc_raw_buf, (int)bytes_read, 4096);
         ArrayCopy(m_ipc_raw_buf, buf, 0, 0, (int)bytes_read);
      }
      m_ipc_read_offset = 0;
   }
   else
   {
      ArrayResize(m_ipc_raw_buf, old_len + (int)bytes_read, 4096);
      ArrayCopy(m_ipc_raw_buf, buf, old_len, 0, (int)bytes_read);
   }

   // 受信ストリームからオフセットを進めながら順次バイナリパケットまたはテキストJSONを抽出して実行（ゼロコピー）
   while(hReplayPipe != INVALID_HANDLE_VALUE && m_ipc_read_offset < ArraySize(m_ipc_raw_buf))
   {
      int current_buf_len = ArraySize(m_ipc_raw_buf);
      int current_len = current_buf_len - m_ipc_read_offset;
      if(current_len <= 0)
         break;

      // 1. TRBIマジックヘッダー（バイナリコマンド 40バイト）のチェック
      if(current_len >= 4 && (m_ipc_read_offset + 3) < current_buf_len)
      {
         uint magic = (uint)m_ipc_raw_buf[m_ipc_read_offset] | 
                      ((uint)m_ipc_raw_buf[m_ipc_read_offset + 1] << 8) | 
                      ((uint)m_ipc_raw_buf[m_ipc_read_offset + 2] << 16) | 
                      ((uint)m_ipc_raw_buf[m_ipc_read_offset + 3] << 24);
         if(magic == TRBI_MAGIC)
         {
            if(current_len < 40)
            {
               // 40バイト揃うまで次回の読み込みを待つ
               break;
            }

            BinaryCommandPacket packet;
            if(CharArrayToStruct(packet, m_ipc_raw_buf, m_ipc_read_offset))
            {
               ProcessBinaryCommand(packet);
            }

            // コマンド処理中に切断やバッファクリアが発生した場合は即終了
            if(hReplayPipe == INVALID_HANDLE_VALUE || ArraySize(m_ipc_raw_buf) == 0)
               return;

            m_ipc_read_offset += 40;
            continue;
         }
      }

      // 2. テキスト/JSONコマンド（改行区切り）の処理
      int newline_pos = -1;
      for(int i = m_ipc_read_offset; i < current_buf_len; i++)
      {
         if(m_ipc_raw_buf[i] == '\n')
         {
            newline_pos = i;
            break;
         }
      }

      if(newline_pos >= 0)
      {
         int msg_len = newline_pos - m_ipc_read_offset;
         if(msg_len > 0)
         {
            string msg = CharArrayToString(m_ipc_raw_buf, m_ipc_read_offset, msg_len, CP_UTF8);
            StringTrimLeft(msg);
            StringTrimRight(msg);
            if(msg != "")
            {
               ProcessCommand(msg);
            }
         }

         // コマンド処理中に切断やバッファクリアが発生した場合は即終了
         if(hReplayPipe == INVALID_HANDLE_VALUE || ArraySize(m_ipc_raw_buf) == 0)
            return;

         m_ipc_read_offset = newline_pos + 1;
         continue;
      }

      // メモリ保護: 改行もマジックもない不正データが64KB超蓄積した場合はクリア
      if(current_len > 65536)
      {
         Print("[Warning] IPC 受信ストリームバッファが異常肥大化したためクリアします: ", current_len, " bytes");
         m_ipc_read_offset = 0;
         ArrayResize(m_ipc_raw_buf, 0);
      }
      break;
   }

   // 全データ消費完了時はバッファをリセット
   if(m_ipc_read_offset >= ArraySize(m_ipc_raw_buf))
   {
      m_ipc_read_offset = 0;
      ArrayResize(m_ipc_raw_buf, 0);
   }
}

//+------------------------------------------------------------------+
//| コマンドプロセッサ                                                |
//+------------------------------------------------------------------+
void ProcessCommand(string line)
{
   string command = GetJsonString(line, "command");
   if(command == "") return;
   m_status_dirty = true;
   
   Print("[Info] コマンド受信: ", line);
   
   if(command == "INIT")
   {
      m_session_boundaries_sent = false;
      m_last_sent_history_rev = -1;

      string source_symbol      = GetJsonString(line, "source_symbol");
      string sub_source_symbol  = GetJsonString(line, "sub_source_symbol");
      bool   enable_dual        = GetJsonBool(line, "enable_dual_feed");
      if(sub_source_symbol != "") enable_dual = true;
      m_enable_dual_feed        = enable_dual;
      m_source_symbol_sub       = sub_source_symbol;
      m_replay_symbol_sub       = (m_source_symbol_sub != "") ? m_source_symbol_sub + "_Replay" : "";

      string start_time_str  = GetJsonString(line, "start_time");
      string end_time_str    = GetJsonString(line, "end_time");
      string profile_name    = GetJsonString(line, "profile_name");
      string additional_symbols = GetJsonString(line, "additional_symbols");
      
      InpTokyoCoreTime     = GetJsonString(line, "tokyo_core");
      InpLondonCoreSummer  = GetJsonString(line, "london_summer");
      InpLondonCoreWinter  = GetJsonString(line, "london_winter");
      InpNYCoreSummer      = GetJsonString(line, "ny_summer");
      InpNYCoreWinter      = GetJsonString(line, "ny_winter");
      
      // デフォルト値のフォールバック（空文字列の場合）
      if(InpTokyoCoreTime == "")    InpTokyoCoreTime = "08:45";
      if(InpLondonCoreSummer == "") InpLondonCoreSummer = "15:00";
      if(InpLondonCoreWinter == "") InpLondonCoreWinter = "16:00";
      if(InpNYCoreSummer == "")     InpNYCoreSummer = "21:00";
      if(InpNYCoreWinter == "")     InpNYCoreWinter = "22:00";
      
      InpPreloadedBars     = (int)GetJsonDouble(line, "preloaded_bars");
      if(InpPreloadedBars <= 0) InpPreloadedBars = 300;
      InpAutoScrollSync    = GetJsonBool(line, "auto_scroll_sync");
      m_preload_mode       = GetJsonString(line, "preload_mode");
      if(m_preload_mode == "") m_preload_mode = "BARS";
      string preload_date_str = GetJsonString(line, "preload_date");
      m_preload_start_time = ParseDateTime(preload_date_str);
      m_preload_timeframe  = GetJsonString(line, "preload_timeframe");
      if(m_preload_timeframe == "") m_preload_timeframe = "AUTO";
      
      string limit_val = GetJsonKeyValue(line, "limit_tick_history");
      if(limit_val != "")
         m_limit_tick_history = (limit_val == "true" || limit_val == "1");
      else
         m_limit_tick_history = true;
         
      string tf_str = GetJsonString(line, "tick_history_timeframe");
      if(tf_str != "")
         m_tick_history_timeframe = StringToTimeframe(tf_str);
      else
         m_tick_history_timeframe = PERIOD_M5;
         
      m_max_history_bars = (int)GetJsonDouble(line, "max_history_bars");
      if(m_max_history_bars <= 0)
         m_max_history_bars = 300;
      
      string skip_val = GetJsonKeyValue(line, "auto_skip_weekend");
      if(skip_val != "")
         m_auto_skip_weekend = (skip_val == "true" || skip_val == "1");
      else
         m_auto_skip_weekend = true;

      m_pseudo_rate_enabled = GetJsonBool(line, "enable_pseudo_rate");
      m_domestic_base_spread = GetJsonDouble(line, "pseudo_base_spread");
      m_mt5_threshold = GetJsonDouble(line, "pseudo_threshold");
      m_sensitivity_coeff = GetJsonDouble(line, "pseudo_sensitivity");

      string rollover_en_val = GetJsonKeyValue(line, "pseudo_rollover_enabled");
      if(rollover_en_val != "")
         m_pseudo_rollover_enabled = (rollover_en_val == "true" || rollover_en_val == "1");
      else
         m_pseudo_rollover_enabled = true;

      string rollover_spr_val = GetJsonKeyValue(line, "pseudo_rollover_spread");
      if(rollover_spr_val != "")
         m_pseudo_rollover_spread = GetJsonDouble(line, "pseudo_rollover_spread");
      else
         m_pseudo_rollover_spread = m_domestic_base_spread * 17.5;

      string rollover_rec_val = GetJsonKeyValue(line, "pseudo_rollover_recovery_min");
      if(rollover_rec_val != "")
         m_pseudo_rollover_recovery_min = (int)GetJsonDouble(line, "pseudo_rollover_recovery_min");
      else
         m_pseudo_rollover_recovery_min = 15;

      Print(StringFormat("[Info] INIT Pseudo rate: Enabled=%s, BaseSpread=%.6f, Threshold=%.6f, Sensitivity=%.3f, RollEnabled=%s, RollSpread=%.6f, RollRecMin=%d",
         (m_pseudo_rate_enabled?"ON":"OFF"), m_domestic_base_spread, m_mt5_threshold, m_sensitivity_coeff,
         (m_pseudo_rollover_enabled?"ON":"OFF"), m_pseudo_rollover_spread, m_pseudo_rollover_recovery_min));
      
      m_source_symbol = (source_symbol != "") ? source_symbol : _Symbol;
      m_replay_symbol = m_source_symbol + "_Replay";
      
      datetime start_time = ParseDateTime(start_time_str);
      datetime end_time   = ParseDateTime(end_time_str);
      
      m_server_start_time = ConvertJSTToServer(start_time);
      m_server_end_time   = ConvertJSTToServer(end_time);
      
      Print("[Info] INITコマンド受信: Main=", m_source_symbol, ", Sub=", m_source_symbol_sub, " (", start_time_str, " - ", end_time_str, ")");
      
      // 以前の初期化を完全にクリア（再INITに対応）
      if(m_initialized)
      {
         m_is_playing = false;
         m_last_real_timer_us = 0;
         
         // 既存ビューアーチャートを閉じる
         int total_charts = ArraySize(m_viewer_chart_ids);
         for(int i = 0; i < total_charts; i++)
         {
            if(m_viewer_chart_ids[i] > 0)
            {
               ChartClose(m_viewer_chart_ids[i]);
               m_viewer_chart_ids[i] = 0;
            }
         }
         ArrayFree(m_viewer_chart_ids);
         ArrayFree(m_viewer_periods);
         CleanTempTemplates();
         
         // カスタムシンボルデータを削除
         if(m_replay_symbol != "")
         {
            CustomTicksDelete(m_replay_symbol, 0, LONG_MAX);
            CustomRatesDelete(m_replay_symbol, 0, LONG_MAX);
         }
         if(m_replay_symbol_sub != "")
         {
            CustomTicksDelete(m_replay_symbol_sub, 0, LONG_MAX);
            CustomRatesDelete(m_replay_symbol_sub, 0, LONG_MAX);
            ArrayFree(m_all_ticks_sub);
            m_total_ticks_sub = 0;
            m_current_idx_sub = 0;
         }
         
         m_loop_a_msc = -1;
         m_loop_b_msc = -1;
         m_loop_a_idx = -1;
         m_loop_b_idx = -1;
         m_initialized = false;
      }
      
      // Toggler 等による画面隠蔽フラグを解除（全インジケーター・ローソク足を表示状態に強制設定）
      GlobalVariableSet("Global_Selected_Candles_Hidden", 0.0);
      
      // カスタムシンボルの作成 (Main)
      if(!InitializeReplaySymbol(m_replay_symbol, m_source_symbol))
      {
         WriteErrorStatus("カスタムシンボルの初期化に失敗: " + m_replay_symbol);
         return;
      }
      // カスタムシンボルの作成 (Sub)
      if(m_enable_dual_feed && m_replay_symbol_sub != "")
      {
         if(!InitializeReplaySymbol(m_replay_symbol_sub, m_source_symbol_sub))
         {
            Print("[Warning] サブカスタムシンボルの初期化に失敗: ", m_replay_symbol_sub);
         }
      }
      
      // ティックデータのロード (Main)
      if(!LoadHistoricalTicksEx(m_source_symbol, m_server_start_time, m_server_end_time, m_all_ticks, m_total_ticks))
      {
         WriteErrorStatus("ティックデータのロードに失敗: " + m_source_symbol);
         return;
      }
      m_current_idx = 0;
      if(m_total_ticks > 0)
      {
         m_virtual_current_msc = m_all_ticks[0].time_msc;
         m_virtual_current_msc_acc = (double)m_virtual_current_msc;
         PrecalculatePseudoRates();
      }
      
      // ティックデータのロード (Sub)
      if(m_enable_dual_feed && m_source_symbol_sub != "")
      {
         LoadHistoricalTicksEx(m_source_symbol_sub, m_server_start_time, m_server_end_time, m_all_ticks_sub, m_total_ticks_sub);
         m_current_idx_sub = 0;
         Print("[Info] サブシンボル ", m_source_symbol_sub, " のティックロード完了: ", m_total_ticks_sub, " 件");
      }

      // 過去データのプリロード情報を先に計算
      int max_period_sec = GetMaxPeriodSeconds(profile_name);

      // 同期他通貨シンボルのデータ事前同期
      if(additional_symbols != "")
      {
         StringReplace(additional_symbols, ";", ",");
         StringReplace(additional_symbols, " ", ",");
         string symbols[];
         ushort u_sep = StringGetCharacter(",", 0);
         int total_symbols = StringSplit(additional_symbols, u_sep, symbols);
         for(int i = 0; i < total_symbols; i++)
         {
            string sym = symbols[i];
            StringTrimLeft(sym);
            StringTrimRight(sym);
            if(sym != "")
            {
               PrepareAdditionalSymbol(sym, m_server_start_time, m_server_end_time, max_period_sec);
            }
         }
      }
      
      // 過去データのプリロード (Main)
      if(!PreloadHistoricalRates(m_source_symbol, m_replay_symbol, m_server_start_time, max_period_sec))
      {
         WriteErrorStatus("過去データのプリロードに失敗");
         return;
      }
      // 過去データのプリロード (Sub)
      if(m_enable_dual_feed && m_source_symbol_sub != "" && m_replay_symbol_sub != "")
      {
         PreloadHistoricalRates(m_source_symbol_sub, m_replay_symbol_sub, m_server_start_time, max_period_sec);
      }
      
      // 初期ティックの書き込み (Main)
      if(m_total_ticks > 0)
      {
         MqlTick init_ticks[];
         if(ArrayResize(init_ticks, 1) >= 0)
         {
            init_ticks[0] = m_all_ticks[0];
            ulong from_msc = m_all_ticks[0].time_msc;
            ulong to_msc   = m_all_ticks[m_total_ticks - 1].time_msc;
            int replaced = CustomTicksReplace(m_replay_symbol, from_msc, to_msc, init_ticks);
            if(replaced < 0)
            {
               Print("[Warning] CustomTicksReplace failed (Main). Code: ", GetLastError());
            }
            m_current_idx = 1;
            m_virtual_current_msc = m_all_ticks[0].time_msc;
            m_virtual_current_msc_acc = (double)m_virtual_current_msc;
         }
      }
      // 初期ティックの書き込み (Sub)
      if(m_enable_dual_feed && m_total_ticks_sub > 0 && m_replay_symbol_sub != "")
      {
         MqlTick init_ticks_sub[];
         if(ArrayResize(init_ticks_sub, 1) >= 0)
         {
            init_ticks_sub[0] = m_all_ticks_sub[0];
            ulong from_msc_sub = m_all_ticks_sub[0].time_msc;
            ulong to_msc_sub   = m_all_ticks_sub[m_total_ticks_sub - 1].time_msc;
            int replaced_sub = CustomTicksReplace(m_replay_symbol_sub, from_msc_sub, to_msc_sub, init_ticks_sub);
            if(replaced_sub < 0)
            {
               Print("[Warning] CustomTicksReplace failed (Sub). Code: ", GetLastError());
            }
            m_current_idx_sub = 1;
         }
      }
      
      m_profile_name = profile_name;
      
      // チャート生成 (Main / Sub 両対応)
      CreateMTFCharts(m_replay_symbol, m_replay_symbol_sub, m_enable_dual_feed);
      
      m_initialized = true;
      UpdateReplayGeneration();
      
      // READY状態通知
      WriteReadyStatus();
      
      Print("[Info] リプレイ初期化完了。総ティック数: ", m_total_ticks);
   }
   else if(command == "CONTROL")
   {
      bool prev_playing = m_is_playing;
      m_is_playing = GetJsonBool(line, "is_playing");
      if(prev_playing && !m_is_playing)
      {
         m_last_real_timer_us = 0;
         m_tick_accumulator = 0.0;
         m_main_fail_count = 0;
         if(m_current_idx > 0 && m_current_idx <= m_total_ticks)
         {
            m_virtual_current_msc = (long)m_all_ticks[m_current_idx - 1].time_msc;
            m_virtual_current_msc_acc = (double)m_virtual_current_msc;
         }
         // 再生停止時は最新状態を確実に描画するため全チャートを再描画
         int total_charts = ArraySize(m_viewer_chart_ids);
         for(int c_idx = 0; c_idx < total_charts; c_idx++)
         {
            long cid = m_viewer_chart_ids[c_idx];
            if(cid > 0) ChartRedraw(cid);
         }
      }
      string speed_mode_str = GetJsonString(line, "speed_mode");
      if(speed_mode_str == "TEMPORAL")
      {
         m_speed_mode = REPLAY_MODE_TEMPORAL;
      }
      else if(speed_mode_str == "COUNT")
      {
         m_speed_mode = REPLAY_MODE_COUNT;
      }
      m_time_multiplier = GetJsonDouble(line, "multiplier");
      m_tick_step_count = (int)GetJsonDouble(line, "tick_step");
      
      if(m_time_multiplier <= 0) m_time_multiplier = 1.0;
      if(m_tick_step_count <= 0) m_tick_step_count = 1;
      
      string skip_val = GetJsonKeyValue(line, "auto_skip_weekend");
      if(skip_val != "")
         m_auto_skip_weekend = (skip_val == "true" || skip_val == "1");
      
      m_last_real_timer_us = 0; // 基準時間を安全に初期化
      m_tick_accumulator = 0.0;
   }
   else if(command == "SEEK")
   {
      string idx_str = GetJsonKeyValue(line, "target_index");
      if(idx_str == "") idx_str = GetJsonKeyValue(line, "target_idx");
      int target_index = (int)StringToDouble(idx_str);
      SeekToPosition(target_index);
   }
   else if(command == "SEEK_RELATIVE")
   {
      int delta = (int)GetJsonDouble(line, "delta");
      if(delta != 0)
      {
         if(delta == -1 && m_current_idx > 1)
         {
            // 同一タイムスタンプのティック群の直前まで戻す
            int target_idx = m_current_idx - 2;
            while(target_idx >= 0 && m_all_ticks[target_idx].time_msc == m_all_ticks[m_current_idx - 1].time_msc)
            {
               target_idx--;
            }
            if(target_idx >= 0)
               SeekToPosition(target_idx);
            else
               SeekToPosition(0);
         }
         else
         {
            int target_index = m_current_idx - 1 + delta;
            SeekToPosition(target_index);
         }
      }
   }
   else if(command == "TIME_JUMP")
   {
      int delta_sec = (int)GetJsonDouble(line, "delta_seconds");
      if(delta_sec != 0)
      {
         datetime current_v_time = (datetime)(m_virtual_current_msc / 1000);
         datetime target_time = 0;
         int target_idx = -1;
         
         if(delta_sec > 0)
         {
            // 時間を加算し、移動先の秒の部分を切り捨て
            datetime dest_time = current_v_time + delta_sec;
            target_time = dest_time - (dest_time % 60);
            if(target_time > m_server_end_time) target_time = m_server_end_time;
            target_idx = FindTickIndexForward(target_time);
         }
         else
         {
            // 時間を減算し、移動先の秒の部分を切り捨て
            int abs_delta = -delta_sec;
            if(current_v_time >= (datetime)abs_delta)
            {
               datetime dest_time = current_v_time - abs_delta;
               target_time = dest_time - (dest_time % 60);
            }
            else
            {
               target_time = m_server_start_time;
            }
            if(target_time < m_server_start_time) target_time = m_server_start_time;
            target_idx = FindTickIndexForward(target_time);
         }
         if(target_idx >= 0) SeekToPosition(target_idx);
      }
   }
   else if(command == "SESSION_JUMP")
   {
      string session = GetJsonString(line, "session");
      string direction = GetJsonString(line, "direction");
      bool is_advance = (direction == "NEXT");
      JumpToSessionStart(session, is_advance);
   }
   else if(command == "SEEK_TIME")
   {
      string target_time_str = GetJsonString(line, "target_time");
      datetime target_time = ParseDateTime(target_time_str);
      datetime server_target = ConvertJSTToServer(target_time);
      int target_idx = FindTickIndexForward(server_target);
      if(target_idx >= 0) SeekToPosition(target_idx);
   }
   else if(command == "LOOP_SET_A")
   {
      m_loop_a_msc = m_virtual_current_msc;
      m_loop_a_idx = (m_current_idx > 0) ? (m_current_idx - 1) : 0;
      Print("[Info] A-B Loop: Set A at ", TimeToString((datetime)(m_loop_a_msc/1000), TIME_DATE|TIME_MINUTES));
   }
   else if(command == "LOOP_SET_B")
   {
      if(m_loop_a_msc == -1)
      {
         WriteErrorStatus("A-B Loop Error: Loop A is not set.");
      }
      else if(m_virtual_current_msc <= m_loop_a_msc)
      {
         WriteErrorStatus("A-B Loop Error: Loop B must be after Loop A.");
      }
      else
      {
         m_loop_b_msc = m_virtual_current_msc;
         m_loop_b_idx = (m_current_idx > 0) ? (m_current_idx - 1) : 0;
         Print("[Info] A-B Loop: Set B at ", TimeToString((datetime)(m_loop_b_msc/1000), TIME_DATE|TIME_MINUTES));
         if(m_loop_a_idx >= 0) SeekToPosition(m_loop_a_idx);
      }
   }
   else if(command == "LOOP_CLEAR")
   {
      m_loop_a_msc = -1;
      m_loop_b_msc = -1;
      m_loop_a_idx = -1;
      m_loop_b_idx = -1;
      Print("[Info] A-B Loop: Cleared.");
   }
   else if(command == "RESET")
   {
      SeekToPosition(0);
   }
   else if(command == "TERMINATE")
   {
      Print("[Info] TERMINATE コマンドを受信。リプレイを停止しデータをクリーンアップします。");
      m_is_playing = false;
      m_last_real_timer_us = 0;
      
      if(m_replay_symbol != "")
      {
         CustomTicksDelete(m_replay_symbol, 0, LONG_MAX);
         CustomRatesDelete(m_replay_symbol, 0, LONG_MAX);
      }
      
      // 取引データの初期化
      ArrayFree(m_virtual_positions);
      ArrayFree(m_virtual_history);
      ClearChartTradeObjects();
      MarkTradeHistoryDirty();
      
      m_current_idx = 0;
      m_total_ticks = 0;
      m_loop_a_msc = -1;
      m_loop_b_msc = -1;
      m_loop_a_idx = -1;
      m_loop_b_idx = -1;
      
      // ビューアーチャートを閉じる
      int total_charts = ArraySize(m_viewer_chart_ids);
      for(int i = 0; i < total_charts; i++)
      {
         if(m_viewer_chart_ids[i] > 0)
         {
            ChartClose(m_viewer_chart_ids[i]);
            m_viewer_chart_ids[i] = 0;
         }
      }
      ArrayFree(m_viewer_chart_ids);
      ArrayFree(m_viewer_periods);
      CleanTempTemplates();
      
      m_initialized = false;
      
      // CONNECTEDステータスに戻す（EA自体は稼働中のまま）
      string connected_status = StringFormat(
         "{\"status\":\"CONNECTED\",\"symbol\":\"%s\",\"ea_version\":\"3.00\"}",
         _Symbol
      );
      WritePipeStatus(connected_status);
   }
   else if(command == "ORDER_OPEN")
   {
      string type_str = GetJsonString(line, "type");
      double volume = GetJsonDouble(line, "volume");
      double sl_points = GetJsonDouble(line, "sl_points");
      double tp_points = GetJsonDouble(line, "tp_points");
      VirtualOrderOpen(type_str, volume, sl_points, tp_points);
   }
   else if(command == "ORDER_CLOSE")
   {
      int ticket = (int)GetJsonDouble(line, "ticket");
      double volume = GetJsonDouble(line, "volume");
      VirtualOrderClose(ticket, volume, "MANUAL");
   }
   else if(command == "ORDER_CLOSE_ALL")
   {
      VirtualOrderCloseAll("MANUAL");
   }
   else if(command == "ORDER_CLOSE_BUY")
   {
      VirtualOrderCloseBuy("MANUAL");
   }
   else if(command == "ORDER_CLOSE_SELL")
   {
      VirtualOrderCloseSell("MANUAL");
   }
   else if(command == "ORDER_MODIFY")
   {
      int ticket = (int)GetJsonDouble(line, "ticket");
      double sl = GetJsonDouble(line, "sl");
      double tp = GetJsonDouble(line, "tp");
      VirtualOrderModify(ticket, sl, tp);
   }
   else if(command == "SET_HISTORY_VISIBILITY")
   {
      bool show = GetJsonBool(line, "show");
      SetHistoryVisibility(show);
   }    else if(command == "SET_CONTRACT_SIZE")
    {
       double size = GetJsonDouble(line, "size");
       if(size > 0)
       {
          m_contract_size = size;
          Print(StringFormat("[Info] Contract size updated to %.1f units per Lot.", m_contract_size));
       }
    }
    else if(command == "SET_HEDGING")
    {
       m_hedging = GetJsonBool(line, "allowed");
       Print(StringFormat("[Info] Hedging setting updated to %s.", m_hedging ? "ON" : "OFF"));
    }
    else if(command == "GET_TRADE_TICKS")
    {
       int ticket = (int)GetJsonDouble(line, "ticket");
       ExportTradeTicksJson(ticket);
    }
      else if(command == "SET_PSEUDO_RATE")
      {
         m_pseudo_rate_enabled = GetJsonBool(line, "enable_pseudo_rate");
         m_domestic_base_spread = GetJsonDouble(line, "pseudo_base_spread");
         m_mt5_threshold = GetJsonDouble(line, "pseudo_threshold");
         m_sensitivity_coeff = GetJsonDouble(line, "pseudo_sensitivity");

         string rollover_en_val = GetJsonKeyValue(line, "pseudo_rollover_enabled");
         if(rollover_en_val != "")
            m_pseudo_rollover_enabled = (rollover_en_val == "true" || rollover_en_val == "1");

         string rollover_spr_val = GetJsonKeyValue(line, "pseudo_rollover_spread");
         if(rollover_spr_val != "")
            m_pseudo_rollover_spread = GetJsonDouble(line, "pseudo_rollover_spread");
         else
            m_pseudo_rollover_spread = m_domestic_base_spread * 17.5;

         string rollover_rec_val = GetJsonKeyValue(line, "pseudo_rollover_recovery_min");
         if(rollover_rec_val != "")
            m_pseudo_rollover_recovery_min = (int)GetJsonDouble(line, "pseudo_rollover_recovery_min");

         Print(StringFormat("[Info] Pseudo rate updated: Enabled=%s, BaseSpread=%.6f, Threshold=%.6f, Sensitivity=%.3f, RollEnabled=%s, RollSpread=%.6f, RollRecMin=%d",
            (m_pseudo_rate_enabled?"ON":"OFF"), m_domestic_base_spread, m_mt5_threshold, m_sensitivity_coeff,
            (m_pseudo_rollover_enabled?"ON":"OFF"), m_pseudo_rollover_spread, m_pseudo_rollover_recovery_min));

         PrecalculatePseudoRates();

         if(m_total_ticks > 0 && m_current_idx > 0 && m_current_idx <= m_total_ticks)
         {
            EvaluatePositionsByTick(m_all_ticks[m_current_idx - 1], m_current_idx - 1);
         }
         WriteStatusFile();
      }
   else if(command == "ACCOUNT_RESET")
   {
      double initial_balance = GetJsonDouble(line, "initial_balance");
      double leverage = GetJsonDouble(line, "leverage");
      ResetAccount(initial_balance, leverage);
   }
   else if(command == "ACCOUNT_TRANSACTION")
   {
      string trans_type = GetJsonString(line, "type");
      double amount = GetJsonDouble(line, "amount");
      if(amount > 0)
      {
         if(trans_type == "DEPOSIT")
         {
            m_account_balance += amount;
            m_account_equity += amount;
            m_account_free_margin += amount;
            Print(StringFormat("[Info] Virtual Deposit: +%.2f. New Balance: %.2f JPY", amount, m_account_balance));
         }
         else if(trans_type == "WITHDRAWAL")
         {
            if(amount > m_account_free_margin)
            {
               WriteErrorStatus("出金額が余剰証拠金を超えています。");
               return;
            }
            m_account_balance -= amount;
            m_account_equity -= amount;
            m_account_free_margin -= amount;
            Print(StringFormat("[Info] Virtual Withdrawal: -%.2f. New Balance: %.2f JPY", amount, m_account_balance));
         }
         
         if(m_total_ticks > 0 && m_current_idx > 0 && m_current_idx <= m_total_ticks)
         {
            EvaluatePositionsByTick(m_all_ticks[m_current_idx - 1], m_current_idx - 1);
         }
         else
         {
            WriteStatusFile();
         }
      }
   }
   else if(command == "RESTORE_ACCOUNT")
   {
      m_account_initial_balance = GetJsonDouble(line, "initial_balance");
      m_account_balance = GetJsonDouble(line, "balance");
      m_account_equity = GetJsonDouble(line, "equity");
      m_account_leverage = GetJsonDouble(line, "leverage");
      m_account_margin = GetJsonDouble(line, "margin");
      m_account_free_margin = GetJsonDouble(line, "free_margin");
      m_account_margin_level = GetJsonDouble(line, "margin_level");
      m_next_ticket = (int)GetJsonDouble(line, "next_ticket");
      if(m_next_ticket <= 0) m_next_ticket = 10001;
      
      ArrayFree(m_virtual_positions);
      ArrayFree(m_virtual_history);
      ClearChartTradeObjects();
      
      Print(StringFormat("[Info] RESTORE_ACCOUNT: Balance restored to %.2f, Leverage %.1fx, NextTicket %d", 
         m_account_balance, m_account_leverage, m_next_ticket));
      
      MarkTradeHistoryDirty();
      WriteStatusFile();
   }
   else if(command == "RESTORE_POSITION")
   {
      int size = ArraySize(m_virtual_positions);
      ArrayResize(m_virtual_positions, size + 1);
      m_virtual_positions[size].ticket = (int)GetJsonDouble(line, "ticket");
      m_virtual_positions[size].symbol = m_replay_symbol;
      string type_str = GetJsonString(line, "type");
      m_virtual_positions[size].type = (type_str == "BUY") ? POSITION_TYPE_BUY : POSITION_TYPE_SELL;
      m_virtual_positions[size].volume = GetJsonDouble(line, "volume");
      m_virtual_positions[size].open_price = GetJsonDouble(line, "open_price");
      m_virtual_positions[size].open_time_msc = (long)GetJsonDouble(line, "open_time_msc");
      m_virtual_positions[size].open_time = (datetime)(m_virtual_positions[size].open_time_msc / 1000);
      m_virtual_positions[size].sl = GetJsonDouble(line, "sl");
      m_virtual_positions[size].tp = GetJsonDouble(line, "tp");
      m_virtual_positions[size].current_price = GetJsonDouble(line, "current_price");
      m_virtual_positions[size].profit = GetJsonDouble(line, "profit");
      m_virtual_positions[size].close_price = 0.0;
      m_virtual_positions[size].close_time = 0;
      m_virtual_positions[size].close_time_msc = 0;
      m_virtual_positions[size].commission = 0.0;
      m_virtual_positions[size].swap = 0.0;
      m_virtual_positions[size].close_reason = "";
      m_virtual_positions[size].mfe_pips = GetJsonDouble(line, "mfe_pips");
      m_virtual_positions[size].mae_pips = GetJsonDouble(line, "mae_pips");
      m_virtual_positions[size].spread_entry = GetJsonDouble(line, "spread_entry");
      m_virtual_positions[size].volatility = GetJsonDouble(line, "volatility");
      m_virtual_positions[size].volume_60s = (ulong)GetJsonDouble(line, "volume_60s");
      
      Print(StringFormat("[Info] RESTORE_POSITION: Ticket %d, %s %.2f @ %.5f", 
         m_virtual_positions[size].ticket, type_str, m_virtual_positions[size].volume, m_virtual_positions[size].open_price));
         
      UpdateChartObjects();
      WriteStatusFile();
   }
   else if(command == "RESTORE_HISTORY")
   {
      int size = ArraySize(m_virtual_history);
      ArrayResize(m_virtual_history, size + 1);
      m_virtual_history[size].ticket = (int)GetJsonDouble(line, "ticket");
      m_virtual_history[size].symbol = m_replay_symbol;
      string type_str = GetJsonString(line, "type");
      m_virtual_history[size].type = (type_str == "BUY") ? POSITION_TYPE_BUY : POSITION_TYPE_SELL;
      m_virtual_history[size].volume = GetJsonDouble(line, "volume");
      m_virtual_history[size].open_price = GetJsonDouble(line, "open_price");
      m_virtual_history[size].open_time_msc = (long)GetJsonDouble(line, "open_time_msc");
      m_virtual_history[size].open_time = (datetime)(m_virtual_history[size].open_time_msc / 1000);
      m_virtual_history[size].close_price = GetJsonDouble(line, "close_price");
      m_virtual_history[size].close_time_msc = (long)GetJsonDouble(line, "close_time_msc");
      m_virtual_history[size].close_time = (datetime)(m_virtual_history[size].close_time_msc / 1000);
      m_virtual_history[size].sl = GetJsonDouble(line, "sl");
      m_virtual_history[size].tp = GetJsonDouble(line, "tp");
      m_virtual_history[size].current_price = m_virtual_history[size].close_price;
      m_virtual_history[size].profit = GetJsonDouble(line, "profit");
      m_virtual_history[size].commission = 0.0;
      m_virtual_history[size].swap = 0.0;
      m_virtual_history[size].close_reason = GetJsonString(line, "close_reason");
      m_virtual_history[size].mfe_pips = GetJsonDouble(line, "mfe_pips");
      m_virtual_history[size].mae_pips = GetJsonDouble(line, "mae_pips");
      m_virtual_history[size].spread_entry = GetJsonDouble(line, "spread_entry");
      m_virtual_history[size].volatility = GetJsonDouble(line, "volatility");
      m_virtual_history[size].volume_60s = (ulong)GetJsonDouble(line, "volume_60s");
      
      Print(StringFormat("[Info] RESTORE_HISTORY: Ticket %d, %s %.2f Closed @ %.5f, Profit %.2f", 
         m_virtual_history[size].ticket, type_str, m_virtual_history[size].volume, m_virtual_history[size].close_price, m_virtual_history[size].profit));
         
      if(m_show_history)
      {
         RedrawHistoryObjects();
      }
      MarkTradeHistoryDirty();
      WriteStatusFile();
   }
   else if(command == "PING")
   {
      // Tauriアプリからの生存確認（PINGに応答してステータスを即時更新）
      if(m_initialized && m_total_ticks > 0)
      {
         WriteStatusFile();
      }
      else
      {
         string ping_response = StringFormat(
            "{\"status\":\"CONNECTED\",\"symbol\":\"%s\",\"ea_version\":\"3.00\"}",
            _Symbol
         );
         WritePipeStatus(ping_response);
      }
   }
   else if(command == "IMPORT_TICKS")
   {
      string target_symbol = GetJsonString(line, "symbol");
      string group_path   = GetJsonString(line, "group");
      string base_symbol  = GetJsonString(line, "base_symbol");
      string bin_file     = GetJsonString(line, "bin_file");
      
      if(target_symbol != "" && bin_file != "")
      {
         if(group_path == "") group_path = "Custom";
         if(base_symbol == "") base_symbol = target_symbol;
         
         Print("[Info] IMPORT_TICKS コマンド受信: ", target_symbol, ", bin: ", bin_file);
         
         int file_handle = FileOpen(bin_file, FILE_READ|FILE_BIN);
         if(file_handle != INVALID_HANDLE)
         {
            ulong file_size = FileSize(file_handle);
            int tick_count = (int)(file_size / sizeof(MqlTick));
            if(tick_count > 0)
            {
               MqlTick ticks[];
               ArrayResize(ticks, tick_count);
               uint read_count = FileReadArray(file_handle, ticks, 0, tick_count);
               FileClose(file_handle);
               
               if(read_count > 0)
               {
                  bool is_custom = false;
                  if(!SymbolExist(target_symbol, is_custom))
                  {
                     string actual_base = base_symbol;
                     bool base_exists = false;
                     if(!SymbolExist(actual_base, base_exists))
                     {
                        int under = StringFind(target_symbol, "_");
                        if(under > 0) actual_base = StringSubstr(target_symbol, 0, under);
                        if(!SymbolExist(actual_base, base_exists)) actual_base = _Symbol;
                     }
                     if(CustomSymbolCreate(target_symbol, group_path, actual_base))
                     {
                        Print("[Info] カスタムシンボル作成成功: ", target_symbol, " (ベース: ", actual_base, ")");
                        CustomSymbolSetInteger(target_symbol, SYMBOL_DIGITS, SymbolInfoInteger(actual_base, SYMBOL_DIGITS));
                        CustomSymbolSetDouble(target_symbol, SYMBOL_POINT, SymbolInfoDouble(actual_base, SYMBOL_POINT));
                     }
                  }
                  SymbolSelect(target_symbol, true);
                  
                  int added = CustomTicksAdd(target_symbol, ticks);
                  Print("[Success] EA経由のインポート完了: ", target_symbol, " (追加件数: ", added, ")");
                  FileDelete(bin_file);
               }
            }
            else
            {
               FileClose(file_handle);
               FileDelete(bin_file);
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| パイプハンドルのクローズ                                         |
//+------------------------------------------------------------------+
void ClosePipes()
{
   bool was_connected = (hReplayPipe != INVALID_HANDLE_VALUE);
   if(hReplayPipe != INVALID_HANDLE_VALUE)
   {
      CloseHandle(hReplayPipe);
      hReplayPipe = INVALID_HANDLE_VALUE;
   }
   ArrayResize(m_ipc_raw_buf, 0);
   m_ipc_read_offset = 0;
   m_accumulated_commands = "";
   if(was_connected)
   {
      UpdateSyncButtonUI();
   }
}

//+------------------------------------------------------------------+
//| パイプへの接続処理（単一の全二重パイプ tick_replay_ipc に接続） |
//+------------------------------------------------------------------+
bool ConnectPipes(bool retry)
{
   ClosePipes(); // 既存の接続があればクローズ

   string pipe_name = "\\\\.\\pipe\\tick_replay_ipc";

   int attempts = retry ? 5 : 2;
   for(int i = 0; i < attempts; i++)
   {
      WaitNamedPipeW(pipe_name, 50);
      hReplayPipe = CreateFileW(pipe_name, GENERIC_READ | GENERIC_WRITE, 0, 0, OPEN_EXISTING, 0, 0);

      if(hReplayPipe != INVALID_HANDLE_VALUE)
      {
         Print("[Info] Named Pipe 接続成功。");
         // 接続確立直後に CONNECTED ステータスを送信
         string init_status = StringFormat(
            "{\"status\":\"CONNECTED\",\"symbol\":\"%s\",\"ea_version\":\"3.00\"}",
            _Symbol
         );
         WritePipeStatus(init_status);
         
         // すでに初期化済みの場合は、READYステータス（セッション情報含む）も即座に送信してフロントエンドの状態を同期する
         if(m_initialized && m_total_ticks > 0)
         {
            WriteReadyStatus();
         }
         
         UpdateSyncButtonUI();
         return true;
      }

      if(i < attempts - 1)
      {
         Sleep(retry ? 100 : 30);
      }
   }

   UpdateSyncButtonUI();
   return false;
}

//+------------------------------------------------------------------+
//| パイプ接続の確認と再接続                                         |
//+------------------------------------------------------------------+
bool EnsurePipesConnected()
{
   if(!m_sync_enabled)
      return false;

   if(hReplayPipe != INVALID_HANDLE_VALUE)
      return true;

   datetime now = TimeLocal();
   // フリーズ防止のため、再接続の試行は2秒以上の間隔を空ける
   if(now - m_last_connect_attempt < 2)
      return false;

   m_last_connect_attempt = now;
   Print("[Info] Named Pipe の接続を試行します。");
   
   // 接続状況の変更をUIに反映
   UpdateSyncButtonUI();
   
   return ConnectPipes(false);
}

//+------------------------------------------------------------------+
//| ステータスパイプへの書き込みヘルパー                              |
//+------------------------------------------------------------------+
void WritePipeStatus(string message)
{
   if(hReplayPipe == INVALID_HANDLE_VALUE)
      return;

   // 改行を追加して送信
   string full_msg = message + "\n";
   uchar buf[];
   int len = StringToCharArray(full_msg, buf, 0, -1, CP_UTF8);
   if(len <= 1) return; // 終端のNULLのみ、または空の場合

   uint bytes_to_write = (uint)len - 1; // 終端NULL文字は書き込まない
   uint bytes_written = 0;

   if(!WriteFile(hReplayPipe, buf, bytes_to_write, bytes_written, 0))
   {
      Print("[Error] IPC Pipe 書き込み失敗。Code: ", GetLastError());
      ClosePipes();
   }
}

//+------------------------------------------------------------------+
//| 定期ステータス更新の書き込み                                     |
//+------------------------------------------------------------------+
string g_tyo_json = "[]";
string g_ldn_json = "[]";
string g_ny_json = "[]";

void WriteStatusFile()
{
   string loop_active_str = (m_loop_a_msc != -1 && m_loop_b_msc != -1) ? "true" : "false";
   int loop_a_idx = m_loop_a_idx;
   int loop_b_idx = m_loop_b_idx;
   
   string speed_mode_str = (m_speed_mode == REPLAY_MODE_TEMPORAL) ? "TEMPORAL" : "COUNT";
   
   // 履歴更新リビジョンが変わった時のみhistory配列を結合
   bool send_history = (m_history_revision != m_last_sent_history_rev);
   if(send_history)
      m_last_sent_history_rev = m_history_revision;
   string trade_json = SerializePositionsAndHistoryToJson(send_history);
   
   double bid = 0.0;
   double ask = 0.0;
   double spread = 0.0;
   double dmm_bid = 0.0;
   double dmm_ask = 0.0;
   double dmm_spread = 0.0;
   if(m_total_ticks > 0 && m_current_idx > 0 && m_current_idx <= m_total_ticks)
   {
      int idx = m_current_idx - 1;
      bid = m_all_ticks[idx].bid;
      ask = m_all_ticks[idx].ask;
      if(bid <= 0) bid = m_all_ticks[idx].last;
      if(ask <= 0) ask = m_all_ticks[idx].last;
      if(ask > bid)
      {
         double pt = SymbolInfoDouble(m_source_symbol, SYMBOL_POINT);
         int dig = (int)SymbolInfoInteger(m_source_symbol, SYMBOL_DIGITS);
         if(dig == 0) dig = (StringFind(m_source_symbol, "JPY") >= 0) ? 3 : 5;
         double pip_unit = (dig == 3 || dig == 5) ? pt * 10.0 : pt;
         if(pip_unit > 0) spread = (ask - bid) / pip_unit;
      }
      
      GetPseudoRateAtIndex(idx, dmm_bid, dmm_ask, dmm_spread);
      if(dmm_ask > dmm_bid)
      {
         double pt = SymbolInfoDouble(m_source_symbol, SYMBOL_POINT);
         int dig = (int)SymbolInfoInteger(m_source_symbol, SYMBOL_DIGITS);
         if(dig == 0) dig = (StringFind(m_source_symbol, "JPY") >= 0) ? 3 : 5;
         double pip_unit = (dig == 3 || dig == 5) ? pt * 10.0 : pt;
         if(pip_unit > 0) dmm_spread = (dmm_ask - dmm_bid) / pip_unit;
      }
   }
   
   string sub_feed_json = "\"dual_feed\":false";
   if(m_enable_dual_feed && m_source_symbol_sub != "")
   {
      double s_bid = 0.0, s_ask = 0.0, s_spread = 0.0;
      if(m_total_ticks_sub > 0 && m_current_idx_sub > 0 && m_current_idx_sub <= m_total_ticks_sub)
      {
         s_bid = m_all_ticks_sub[m_current_idx_sub - 1].bid;
         s_ask = m_all_ticks_sub[m_current_idx_sub - 1].last;
         if(s_bid <= 0) s_bid = m_all_ticks_sub[m_current_idx_sub - 1].last;
         if(s_ask <= 0) s_ask = m_all_ticks_sub[m_current_idx_sub - 1].last;
         if(s_ask > s_bid)
         {
            double pt = SymbolInfoDouble(m_source_symbol_sub, SYMBOL_POINT);
            int dig = (int)SymbolInfoInteger(m_source_symbol_sub, SYMBOL_DIGITS);
            if(dig == 0) dig = (StringFind(m_source_symbol_sub, "JPY") >= 0) ? 3 : 5;
            double pip_unit = (dig == 3 || dig == 5) ? pt * 10.0 : pt;
            if(pip_unit > 0) s_spread = (s_ask - s_bid) / pip_unit;
         }
      }
      sub_feed_json = StringFormat(
         "\"dual_feed\":true,\"sub_symbol\":\"%s\",\"sub_bid\":%.5f,\"sub_ask\":%.5f,\"sub_spread\":%.2f,\"sub_idx\":%d,\"sub_total\":%d",
         m_source_symbol_sub, s_bid, s_ask, s_spread, m_current_idx_sub, m_total_ticks_sub
      );
   }
   
   // 初回送信済みであればセッション境界JSONを省略して送信ペイロードを大幅削減
   string session_json = "";
   if(!m_session_boundaries_sent)
   {
      session_json = StringFormat(",\"session_boundaries\":{\"TYO\":%s,\"LDN\":%s,\"NY\":%s}", g_tyo_json, g_ldn_json, g_ny_json);
      m_session_boundaries_sent = true;
   }
   
   int max_bars = (int)TerminalInfoInteger(TERMINAL_MAXBARS);
   string msg = StringFormat(
      "{\"status\":\"ACTIVE\",\"current_idx\":%d,\"total_ticks\":%d,\"virtual_time_msc\":%I64d,\"is_playing\":%s,\"speed_mode\":\"%s\",\"multiplier\":%s,\"tick_step\":%d,\"bid\":%.5f,\"ask\":%.5f,\"spread\":%.2f,\"dmm_bid\":%.5f,\"dmm_ask\":%.5f,\"dmm_spread\":%.2f,\"max_bars\":%d,\"history_revision\":%d%s,\"loop\":{\"active\":%s,\"a_msc\":%I64d,\"b_msc\":%I64d,\"a_idx\":%d,\"b_idx\":%d},%s,%s}",
      m_current_idx, m_total_ticks, m_virtual_current_msc,
      (m_is_playing ? "true" : "false"),
      speed_mode_str, DoubleToString(m_time_multiplier, 1), m_tick_step_count,
      bid, ask, spread, dmm_bid, dmm_ask, dmm_spread, max_bars, m_history_revision,
      session_json,
      loop_active_str, m_loop_a_msc, m_loop_b_msc, loop_a_idx, loop_b_idx,
      sub_feed_json,
      trade_json
   );
   WritePipeStatus(msg);
   m_status_dirty = false;
}

//+------------------------------------------------------------------+
//| READYステータスの書き込み（セッション境界インデックス計算を含む）  |
//+------------------------------------------------------------------+
void WriteReadyStatus()
{
   CalculateSessionBoundaries(g_tyo_json, g_ldn_json, g_ny_json);
   
   string speed_mode_str = (m_speed_mode == REPLAY_MODE_TEMPORAL) ? "TEMPORAL" : "COUNT";
   string trade_json = SerializePositionsAndHistoryToJson(true);
   
   double bid = 0.0;
   double ask = 0.0;
   double spread = 0.0;
   double dmm_bid = 0.0;
   double dmm_ask = 0.0;
   double dmm_spread = 0.0;
   if(m_total_ticks > 0 && m_current_idx > 0 && m_current_idx <= m_total_ticks)
   {
      int idx = m_current_idx - 1;
      bid = m_all_ticks[idx].bid;
      ask = m_all_ticks[idx].ask;
      if(bid <= 0) bid = m_all_ticks[idx].last;
      if(ask <= 0) ask = m_all_ticks[idx].last;
      if(ask > bid)
      {
         double pt = SymbolInfoDouble(m_source_symbol, SYMBOL_POINT);
         int dig = (int)SymbolInfoInteger(m_source_symbol, SYMBOL_DIGITS);
         if(dig == 0) dig = (StringFind(m_source_symbol, "JPY") >= 0) ? 3 : 5;
         double pip_unit = (dig == 3 || dig == 5) ? pt * 10.0 : pt;
         if(pip_unit > 0) spread = (ask - bid) / pip_unit;
      }
      
      GetPseudoRateAtIndex(idx, dmm_bid, dmm_ask, dmm_spread);
      if(dmm_ask > dmm_bid)
      {
         double pt = SymbolInfoDouble(m_source_symbol, SYMBOL_POINT);
         int dig = (int)SymbolInfoInteger(m_source_symbol, SYMBOL_DIGITS);
         if(dig == 0) dig = (StringFind(m_source_symbol, "JPY") >= 0) ? 3 : 5;
         double pip_unit = (dig == 3 || dig == 5) ? pt * 10.0 : pt;
         if(pip_unit > 0) dmm_spread = (dmm_ask - dmm_bid) / pip_unit;
      }
   }
   
   string sub_feed_json = "\"dual_feed\":false";
   if(m_enable_dual_feed && m_source_symbol_sub != "")
   {
      double s_bid = 0.0, s_ask = 0.0, s_spread = 0.0;
      if(m_total_ticks_sub > 0 && m_current_idx_sub > 0 && m_current_idx_sub <= m_total_ticks_sub)
      {
         s_bid = m_all_ticks_sub[m_current_idx_sub - 1].bid;
         s_ask = m_all_ticks_sub[m_current_idx_sub - 1].ask;
         if(s_bid <= 0) s_bid = m_all_ticks_sub[m_current_idx_sub - 1].last;
         if(s_ask <= 0) s_ask = m_all_ticks_sub[m_current_idx_sub - 1].last;
         if(s_ask > s_bid)
         {
            double pt = SymbolInfoDouble(m_source_symbol_sub, SYMBOL_POINT);
            int dig = (int)SymbolInfoInteger(m_source_symbol_sub, SYMBOL_DIGITS);
            if(dig == 0) dig = (StringFind(m_source_symbol_sub, "JPY") >= 0) ? 3 : 5;
            double pip_unit = (dig == 3 || dig == 5) ? pt * 10.0 : pt;
            if(pip_unit > 0) s_spread = (s_ask - s_bid) / pip_unit;
         }
      }
      sub_feed_json = StringFormat(
         "\"dual_feed\":true,\"sub_symbol\":\"%s\",\"sub_bid\":%.5f,\"sub_ask\":%.5f,\"sub_spread\":%.2f,\"sub_idx\":%d,\"sub_total\":%d",
         m_source_symbol_sub, s_bid, s_ask, s_spread, m_current_idx_sub, m_total_ticks_sub
      );
   }
   
   int max_bars = (int)TerminalInfoInteger(TERMINAL_MAXBARS);
   string msg = StringFormat(
      "{\"status\":\"READY\",\"total_ticks\":%d,\"current_idx\":%d,\"virtual_time_msc\":%I64d,\"speed_mode\":\"%s\",\"multiplier\":%s,\"tick_step\":%d,\"bid\":%.5f,\"ask\":%.5f,\"spread\":%.2f,\"dmm_bid\":%.5f,\"dmm_ask\":%.5f,\"dmm_spread\":%.2f,\"max_bars\":%d,\"history_revision\":%d,\"session_boundaries\":{\"TYO\":%s,\"LDN\":%s,\"NY\":%s},%s,%s}",
      m_total_ticks, m_current_idx, m_virtual_current_msc,
      speed_mode_str, DoubleToString(m_time_multiplier, 1), m_tick_step_count,
      bid, ask, spread, dmm_bid, dmm_ask, dmm_spread, max_bars, m_history_revision,
      g_tyo_json, g_ldn_json, g_ny_json,
      sub_feed_json,
      trade_json
   );
   WritePipeStatus(msg);
   m_session_boundaries_sent = true;
   m_last_sent_history_rev = m_history_revision;
   m_status_dirty = false;
}

//+------------------------------------------------------------------+
//| ERRORステータスの書き込み                                        |
//+------------------------------------------------------------------+
void WriteErrorStatus(string message)
{
   string msg = StringFormat("{\"status\":\"ERROR\",\"message\":\"%s\"}", message);
   WritePipeStatus(msg);
   Print("[Error] ", message);
}

//+------------------------------------------------------------------+
//| 全期間内のセッション開始位置（ティックインデックス）の一括算出     |
//+------------------------------------------------------------------+
void CalculateSessionBoundaries(string &out_tyo_json, string &out_ldn_json, string &out_ny_json)
{
   out_tyo_json = "[";
   out_ldn_json = "[";
   out_ny_json  = "[";
   
   if(m_total_ticks <= 0)
   {
      out_tyo_json += "]";
      out_ldn_json += "]";
      out_ny_json  += "]";
      return;
   }
   
   datetime start_jst = ConvertServerToJST(m_server_start_time);
   datetime end_jst = ConvertServerToJST(m_server_end_time);
   
   datetime current_day_jst = start_jst - (start_jst % 86400);
   datetime end_day_jst = end_jst - (end_jst % 86400);
   
   bool first_tyo = true, first_ldn = true, first_ny = true;
   
   for(datetime day = current_day_jst; day <= end_day_jst; day = AddDays(day, 1))
   {
      MqlDateTime mdt;
      TimeToStruct(day, mdt);
      if(mdt.day_of_week == 0 || mdt.day_of_week == 6) continue; // 土日除外
      
      // 東京
      datetime tyo_start_jst = GetSessionStartForDate(day, "TYO");
      datetime tyo_start_server = ConvertJSTToServer(tyo_start_jst);
      int tyo_idx = FindTickIndexForward(tyo_start_server);
      if(tyo_idx >= 0 && tyo_idx < m_total_ticks)
      {
         if(!first_tyo) out_tyo_json += ",";
         out_tyo_json += IntegerToString(tyo_idx);
         first_tyo = false;
      }
      
      // ロンドン
      datetime ldn_start_jst = GetSessionStartForDate(day, "LDN");
      datetime ldn_start_server = ConvertJSTToServer(ldn_start_jst);
      int ldn_idx = FindTickIndexForward(ldn_start_server);
      if(ldn_idx >= 0 && ldn_idx < m_total_ticks)
      {
         if(!first_ldn) out_ldn_json += ",";
         out_ldn_json += IntegerToString(ldn_idx);
         first_ldn = false;
      }
      
      // NY
      datetime ny_start_jst = GetSessionStartForDate(day, "NY");
      datetime ny_start_server = ConvertJSTToServer(ny_start_jst);
      int ny_idx = FindTickIndexForward(ny_start_server);
      if(ny_idx >= 0 && ny_idx < m_total_ticks)
      {
         if(!first_ny) out_ny_json += ",";
         out_ny_json += IntegerToString(ny_idx);
         first_ny = false;
      }
   }
   
   out_tyo_json += "]";
   out_ldn_json += "]";
   out_ny_json  += "]";
}

//+------------------------------------------------------------------+
//| 日付パースヘルパー                                               |
//+------------------------------------------------------------------+
datetime ParseDateTime(string dt_str)
{
   // YYYY-MM-DD HH:MM:SS または YYYY-MM-DDTHH:MM:SS を MQL5 の時間値にパース
   StringReplace(dt_str, "-", ".");
   StringReplace(dt_str, "T", " ");
   return StringToTime(dt_str);
}

//+------------------------------------------------------------------+
//| ソース銘柄からベース通貨ペア名を抽出するヘルパー                |
//+------------------------------------------------------------------+
string ExtractBaseSymbol(string source_symbol)
{
   string sym = source_symbol;
   int pos = StringFind(sym, "_");
   if(pos > 0)
   {
      sym = StringSubstr(sym, 0, pos);
   }
   pos = StringFind(sym, ".");
   if(pos > 0)
   {
      sym = StringSubstr(sym, 0, pos);
   }
   if(StringLen(sym) >= 6)
   {
      return sym;
   }
   return "USDJPY"; // フォールバック
}

//+------------------------------------------------------------------+
//| カスタムシンボルの作成・初期化                                   |
//+------------------------------------------------------------------+
bool InitializeReplaySymbol(string replay_symbol, string source_symbol)
{
   bool is_custom = false;
   bool exist = SymbolExist(replay_symbol, is_custom);
   
   if(!exist)
   {
      ResetLastError();
      bool created = CustomSymbolCreate(replay_symbol, "Replay", source_symbol);
      
      if(!created)
      {
         int err = GetLastError();
         Print("[Warning] source_symbol ('", source_symbol, "') での CustomSymbolCreate 失敗。Code: ", err, "。ベース銘柄での作成を試みます。");
         
         string base_symbol = ExtractBaseSymbol(source_symbol);
         if(SymbolExist(base_symbol, is_custom))
         {
            created = CustomSymbolCreate(replay_symbol, "Replay", base_symbol);
         }
         
         if(!created)
         {
            Print("[Warning] ベース銘柄 ('", base_symbol, "') での CustomSymbolCreate 失敗。原銘柄なしで作成を試みます。");
            created = CustomSymbolCreate(replay_symbol, "Replay", "");
         }
         
         if(!created)
         {
            Print("[Error] カスタムシンボルの作成に最終失敗しました: ", replay_symbol, " Code: ", GetLastError());
            return false;
         }
      }
   }
   
   // ソース銘柄およびベース銘柄から重要プロパティを修正・設定（既存シンボルの場合も毎回検証・更新）
   string base_sym = ExtractBaseSymbol(source_symbol);
   bool is_jpy = (StringFind(source_symbol, "JPY") >= 0);
   
   long digits = SymbolInfoInteger(source_symbol, SYMBOL_DIGITS);
   if(digits <= 0 || (is_jpy && digits != 2 && digits != 3) || (!is_jpy && digits != 4 && digits != 5))
   {
      long base_digits = SymbolInfoInteger(base_sym, SYMBOL_DIGITS);
      if(base_digits > 0) digits = base_digits;
      else digits = is_jpy ? 3 : 5;
   }
   CustomSymbolSetInteger(replay_symbol, SYMBOL_DIGITS, digits);
   
   double point = SymbolInfoDouble(source_symbol, SYMBOL_POINT);
   if(point <= 0.0 || (is_jpy && point > 0.01) || (!is_jpy && point > 0.001))
   {
      double base_point = SymbolInfoDouble(base_sym, SYMBOL_POINT);
      if(base_point > 0.0) point = base_point;
      else point = (digits == 3 || digits == 2) ? 0.001 : 0.00001;
   }
   CustomSymbolSetDouble(replay_symbol, SYMBOL_POINT, point);
   
   double contract_size = SymbolInfoDouble(source_symbol, SYMBOL_TRADE_CONTRACT_SIZE);
   if(contract_size <= 0) contract_size = SymbolInfoDouble(base_sym, SYMBOL_TRADE_CONTRACT_SIZE);
   if(contract_size <= 0) contract_size = 100000.0;
   CustomSymbolSetDouble(replay_symbol, SYMBOL_TRADE_CONTRACT_SIZE, contract_size);
   
   string base_curr = SymbolInfoString(source_symbol, SYMBOL_CURRENCY_BASE);
   if(base_curr == "") base_curr = SymbolInfoString(base_sym, SYMBOL_CURRENCY_BASE);
   if(base_curr != "") CustomSymbolSetString(replay_symbol, SYMBOL_CURRENCY_BASE, base_curr);
   
   string profit_curr = SymbolInfoString(source_symbol, SYMBOL_CURRENCY_PROFIT);
   if(profit_curr == "") profit_curr = SymbolInfoString(base_sym, SYMBOL_CURRENCY_PROFIT);
   if(profit_curr != "") CustomSymbolSetString(replay_symbol, SYMBOL_CURRENCY_PROFIT, profit_curr);
   
   if(!SymbolSelect(replay_symbol, true))
   {
      Print("[Error] カスタムシンボルの気配値登録に失敗しました。Code: ", GetLastError());
      return false;
   }
   
   ResetLastError();
   int deleted_ticks = CustomTicksDelete(replay_symbol, 0, LONG_MAX);
   int deleted_rates = CustomRatesDelete(replay_symbol, 0, LONG_MAX);
   
   if(deleted_ticks < 0 || deleted_rates < 0)
   {
      Print("[Warning] 既存データクリア中の警告。Ticks: ", deleted_ticks, ", Rates: ", deleted_rates, ", Code: ", GetLastError());
   }
   return true;
}

//+------------------------------------------------------------------+
//| M1バーから 4つのティック (Open, Low/High, High/Low, Close) を生成する |
//+------------------------------------------------------------------+
int GenerateTicksFromRates(string symbol, const MqlRates &rates[], MqlTick &out_ticks[])
{
   int rates_count = ArraySize(rates);
   if(rates_count <= 0) return 0;
   
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   // 1バーあたり最大30ティック程度生成
   ArrayResize(out_ticks, rates_count * 30);
   int tick_idx = 0;
   
   double point_val = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point_val <= 0) point_val = 0.001;
   
   for(int i = 0; i < rates_count; i++)
   {
      MqlRates r = rates[i];
      long base_msc = (long)r.time * 1000;
      double spread_val = (r.spread > 0) ? (r.spread * point_val) : (20.0 * point_val);
      
      int ticks_in_bar = (int)MathMax(12, MathMin((int)r.tick_volume, 30));
      
      // 4つの主要価格ポイント (Open -> Low/High -> High/Low -> Close)
      double p0 = r.open;
      double p1 = (r.close >= r.open) ? r.low  : r.high;
      double p2 = (r.close >= r.open) ? r.high : r.low;
      double p3 = r.close;
      
      for(int k = 0; k < ticks_in_bar; k++)
      {
         double ratio = (ticks_in_bar > 1) ? ((double)k / (double)(ticks_in_bar - 1)) : 0.0;
         long offset_msc = (long)(ratio * 58000.0); // 0〜58秒に分散
         
         double current_price = p0;
         if(ratio < 0.333)
         {
            double local_t = ratio / 0.333;
            current_price = p0 + (p1 - p0) * local_t;
         }
         else if(ratio < 0.666)
         {
            double local_t = (ratio - 0.333) / 0.333;
            current_price = p1 + (p2 - p1) * local_t;
         }
         else
         {
            double local_t = (ratio - 0.666) / 0.334;
            current_price = p2 + (p3 - p2) * local_t;
         }
         
         out_ticks[tick_idx].time = r.time + (datetime)(offset_msc / 1000);
         out_ticks[tick_idx].time_msc = base_msc + offset_msc;
         out_ticks[tick_idx].bid = RoundHalfUp(current_price, digits);
         out_ticks[tick_idx].ask = RoundHalfUp(current_price + spread_val, digits);
         out_ticks[tick_idx].last = 0;
         out_ticks[tick_idx].volume = 1;
         out_ticks[tick_idx].flags = 6;
         tick_idx++;
      }
   }
   
   ArrayResize(out_ticks, tick_idx);
   return tick_idx;
}

//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| 過去ティックデータの汎用読み込み関数                             |
//+------------------------------------------------------------------+
bool LoadHistoricalTicksEx(string source_symbol, datetime start, datetime end, MqlTick &out_ticks[], int &out_total)
{
   ulong from_msc = (ulong)start * 1000;
   ulong to_msc   = (ulong)end * 1000;
   
   // ソースシンボルを気配値表示に追加して活性化
   SymbolSelect(source_symbol, true);
   
   ArrayFree(out_ticks);
   out_total = 0;
   
   // 1. まず CopyTicksRange で生のティックデータの取得を試みる (最大 10 回リトライ = 2.5秒)
   int retries = 0;
   while(retries < 10)
   {
      ResetLastError();
      out_total = CopyTicksRange(source_symbol, out_ticks, COPY_TICKS_ALL, from_msc, to_msc);
      
      if(out_total > 0)
      {
         break;
      }
      
      int err = GetLastError();
      Print("[Info] Ticksデータロード待機中 (試行 ", retries + 1, "/10): ", source_symbol, " Code: ", err);
      Sleep(250);
      retries++;
   }
   
   // 2. 生のティックデータが0件の場合、M1バー (CopyRates) からの疑似ティック生成を試みる
   if(out_total <= 0)
   {
      Print("[Info] 生ティックデータが0件のため、M1バーからの疑似ティック生成を試みます: ", source_symbol);
      MqlRates rates[];
      ArrayFree(rates);
      int copied_rates = CopyRates(source_symbol, PERIOD_M1, start, end, rates);
      
      if(copied_rates > 0)
      {
         out_total = GenerateTicksFromRates(source_symbol, rates, out_ticks);
         Print("[Info] M1バー ", copied_rates, " 件から ", out_total, " 件の疑似ティックデータを正常生成しました。");
      }
      else
      {
         Print("[Warning] M1バーの取得にも失敗しました。Code: ", GetLastError());
      }
   }
   
   if(out_total <= 0)
   {
      int last_err = GetLastError();
      Print("[Error] ティックおよびM1バーデータが0件です。Symbol: ", source_symbol, " Code: ", last_err);
      return false;
   }
   
   Print("[Info] ", source_symbol, " から ", out_total, " 件のティックデータをメモリにロードしました。");
   return true;
}

//+------------------------------------------------------------------+
//| 過去ティックデータの読み込み (Main シンボル用フォールバック)     |
//+------------------------------------------------------------------+
bool LoadHistoricalTicks(string source_symbol, datetime start, datetime end)
{
   bool ok = LoadHistoricalTicksEx(source_symbol, start, end, m_all_ticks, m_total_ticks);
   if(ok && m_total_ticks > 0)
   {
      m_current_idx = 0;
      m_virtual_current_msc = m_all_ticks[0].time_msc;
      PrecalculatePseudoRates();
   }
   return ok;
}

//+------------------------------------------------------------------+
//| 既存の同一シンボル・時間軸のチャートを検索する                   |
//+------------------------------------------------------------------+
long FindExistingViewerChart(string symbol, ENUM_TIMEFRAMES period, long &exclude_ids[])
{
   long chart_id = ChartFirst();
   while(chart_id >= 0)
   {
      if(ChartSymbol(chart_id) == symbol && ChartPeriod(chart_id) == period)
      {
         bool already_used = false;
         int size = ArraySize(exclude_ids);
         for(int i = 0; i < size; i++)
         {
            if(exclude_ids[i] == chart_id)
            {
               already_used = true;
               break;
            }
         }
         if(!already_used)
         {
            return chart_id;
         }
      }
      chart_id = ChartNext(chart_id);
   }
   return 0;
}

//+------------------------------------------------------------------+
//| 文字列からENUM_TIMEFRAMESへの変換                               |
//+------------------------------------------------------------------+
ENUM_TIMEFRAMES StringToTimeframe(string tf_str)
{
   StringToUpper(tf_str);
   StringTrimLeft(tf_str);
   StringTrimRight(tf_str);
   
   if(tf_str == "M1")  return(PERIOD_M1);
   if(tf_str == "M2")  return(PERIOD_M2);
   if(tf_str == "M3")  return(PERIOD_M3);
   if(tf_str == "M4")  return(PERIOD_M4);
   if(tf_str == "M5")  return(PERIOD_M5);
   if(tf_str == "M6")  return(PERIOD_M6);
   if(tf_str == "M10") return(PERIOD_M10);
   if(tf_str == "M12") return(PERIOD_M12);
   if(tf_str == "M15") return(PERIOD_M15);
   if(tf_str == "M20") return(PERIOD_M20);
   if(tf_str == "M30") return(PERIOD_M30);
   if(tf_str == "H1")  return(PERIOD_H1);
   if(tf_str == "H2")  return(PERIOD_H2);
   if(tf_str == "H3")  return(PERIOD_H3);
   if(tf_str == "H4")  return(PERIOD_H4);
   if(tf_str == "H6")  return(PERIOD_H6);
   if(tf_str == "H8")  return(PERIOD_H8);
   if(tf_str == "H12") return(PERIOD_H12);
   if(tf_str == "D1")  return(PERIOD_D1);
   if(tf_str == "W1")  return(PERIOD_W1);
   if(tf_str == "MN1") return(PERIOD_MN1);
   
   return(PERIOD_M1);
}

//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| .chr ファイルのエンコーディング (UTF-16LE / UTF-8 / ANSI) 自動判別オープン |
//+------------------------------------------------------------------+
int OpenChrFileForReading(string profile_file_path)
{
   int file_bin = FileOpen(profile_file_path, FILE_READ | FILE_BIN);
   if(file_bin == INVALID_HANDLE)
   {
      return INVALID_HANDLE;
   }
   
   uchar b0 = 0, b1 = 0, b2 = 0;
   ulong fsize = FileSize(file_bin);
   if(fsize >= 2)
   {
      b0 = (uchar)FileReadInteger(file_bin, CHAR_VALUE);
      b1 = (uchar)FileReadInteger(file_bin, CHAR_VALUE);
      if(fsize >= 3)
      {
         b2 = (uchar)FileReadInteger(file_bin, CHAR_VALUE);
      }
   }
   FileClose(file_bin);
   
   // 1. UTF-16LE with BOM (0xFF, 0xFE)
   if(b0 == 0xFF && b1 == 0xFE)
   {
      return FileOpen(profile_file_path, FILE_READ | FILE_TXT | FILE_UNICODE);
   }
   // 2. UTF-8 with BOM (0xEF, 0xBB, 0xBF)
   if(b0 == 0xEF && b1 == 0xBB && b2 == 0xBF)
   {
      return FileOpen(profile_file_path, FILE_READ | FILE_TXT | FILE_ANSI);
   }
   // 3. UTF-16LE without BOM (byte 1 == 0x00 and byte 0 != 0x00)
   if(b1 == 0x00 && b0 != 0x00 && fsize >= 4)
   {
      return FileOpen(profile_file_path, FILE_READ | FILE_TXT | FILE_UNICODE);
   }
   // 4. ANSI / UTF-8 without BOM (標準テキスト)
   return FileOpen(profile_file_path, FILE_READ | FILE_TXT | FILE_ANSI);
}

//+------------------------------------------------------------------+
//| プロファイル解析とテンプレートのテンポラリ出力                    |
//+------------------------------------------------------------------+
bool ProcessProfile(string profile_name, string main_symbol, string sub_symbol, bool enable_dual, ChartLayoutInfo &out_layouts[])
{
   ArrayFree(out_layouts);
   
   string search_mask = profile_name + "\\*.chr";
   string filename;
   long search_handle = FileFindFirst(search_mask, filename);
   
   if(search_handle == INVALID_HANDLE)
   {
      Print("[Error] プロファイルフォルダが見つからないか、.chr が存在しません: ", profile_name);
      return false;
   }
   
   FolderCreate("replay-chart-temp");
   
   int chart_count = 0;
   do
   {
      string profile_file_path = profile_name + "\\" + filename;
      int file_in = OpenChrFileForReading(profile_file_path);
      if(file_in == INVALID_HANDLE)
      {
         Print("[Warning] プロファイルファイルが開けません: ", profile_file_path);
         continue;
      }
      
      string file_content = "";
      string line = "";
      string original_symbol = "";
      int period_type = -1;
      int period_size = -1;
      int floating = 0;
      int win_left = 0, win_top = 0, win_right = 0, win_bottom = 0;
      int float_left = 0, float_top = 0, float_right = 0, float_bottom = 0;
      int show_grid = 1; // グリッド表示フラグのデフォルト値 (1 = 表示)
      
      while(!FileIsEnding(file_in))
      {
         line = FileReadString(file_in);
         string trimmed = line;
         StringTrimLeft(trimmed);
         StringTrimRight(trimmed);
         
         if(original_symbol == "" && StringFind(trimmed, "symbol=") == 0)
         {
            original_symbol = StringSubstr(trimmed, 7);
            StringTrimLeft(original_symbol);
            StringTrimRight(original_symbol);
            StringReplace(original_symbol, "\"", "");
         }
         
         if(period_type == -1 && StringFind(trimmed, "period_type=") == 0)
         {
            period_type = (int)StringToInteger(StringSubstr(trimmed, 12));
         }
         
         if(period_size == -1 && StringFind(trimmed, "period_size=") == 0)
         {
            period_size = (int)StringToInteger(StringSubstr(trimmed, 12));
         }

         if(StringFind(trimmed, "floating=") == 0)
         {
            floating = (int)StringToInteger(StringSubstr(trimmed, 9));
         }
         else if(StringFind(trimmed, "window_left=") == 0)
         {
            win_left = (int)StringToInteger(StringSubstr(trimmed, 12));
         }
         else if(StringFind(trimmed, "window_top=") == 0)
         {
            win_top = (int)StringToInteger(StringSubstr(trimmed, 11));
         }
         else if(StringFind(trimmed, "window_right=") == 0)
         {
            win_right = (int)StringToInteger(StringSubstr(trimmed, 13));
         }
         else if(StringFind(trimmed, "window_bottom=") == 0)
         {
            win_bottom = (int)StringToInteger(StringSubstr(trimmed, 14));
         }
         else if(StringFind(trimmed, "floating_left=") == 0)
         {
            float_left = (int)StringToInteger(StringSubstr(trimmed, 14));
         }
         else if(StringFind(trimmed, "floating_top=") == 0)
         {
            float_top = (int)StringToInteger(StringSubstr(trimmed, 13));
         }
         else if(StringFind(trimmed, "floating_right=") == 0)
         {
            float_right = (int)StringToInteger(StringSubstr(trimmed, 15));
         }
         else if(StringFind(trimmed, "floating_bottom=") == 0)
         {
            float_bottom = (int)StringToInteger(StringSubstr(trimmed, 16));
         }
         else if(StringFind(trimmed, "grid=") == 0)
         {
            show_grid = (int)StringToInteger(StringSubstr(trimmed, 5));
         }
         
         file_content += line + "\r\n";
      }
      FileClose(file_in);
      
      // 目印インジケーター TickReplayRoleMarker (または SUB ロール指定) の検出
      bool is_sub_chart = false;
      if(enable_dual && sub_symbol != "")
      {
         string lower_content = file_content;
         StringToLower(lower_content);
         
         if(StringFind(lower_content, "tickreplayrolemarker") >= 0 ||
            StringFind(lower_content, "rolemarker") >= 0 ||
            StringFind(lower_content, "role_sub") >= 0 ||
            StringFind(lower_content, "inprolename=sub") >= 0 ||
            StringFind(lower_content, "inprolename=\"sub") >= 0 ||
            StringFind(lower_content, "sub (reference)") >= 0 ||
            StringFind(lower_content, "sub(reference)") >= 0 ||
            StringFind(lower_content, "sub_chart") >= 0 ||
            StringFind(lower_content, "sub_feed") >= 0)
         {
            is_sub_chart = true;
         }
      }
      
      string target_symbol = is_sub_chart ? sub_symbol : main_symbol;
      
      if(original_symbol != "" && original_symbol != target_symbol)
      {
         StringReplace(file_content, original_symbol, target_symbol);
      }
      
      if(is_sub_chart)
      {
         if(main_symbol != "" && main_symbol != target_symbol)
         {
            StringReplace(file_content, main_symbol, target_symbol);
         }
      }
      else
      {
         if(sub_symbol != "" && sub_symbol != target_symbol)
         {
            StringReplace(file_content, sub_symbol, target_symbol);
         }
      }
      
      // symbol= 行の確実な置換（大文字小文字や空白の差異を吸収）
      int sym_header_pos = StringFind(file_content, "symbol=");
      if(sym_header_pos >= 0)
      {
         int line_end = StringFind(file_content, "\r\n", sym_header_pos);
         if(line_end > sym_header_pos)
         {
            string before = StringSubstr(file_content, 0, sym_header_pos);
            string after = StringSubstr(file_content, line_end);
            file_content = before + "symbol=" + target_symbol + after;
         }
      }
      
      // id= 行を id=0 に初期化 (MT5テンプレートとして新規適用可能にする)
      int id_pos = StringFind(file_content, "id=");
      if(id_pos >= 0 && id_pos < 100)
      {
         int id_end = StringFind(file_content, "\r\n", id_pos);
         if(id_end > id_pos)
         {
            string before = StringSubstr(file_content, 0, id_pos);
            string after = StringSubstr(file_content, id_end);
            file_content = before + "id=0" + after;
         }
      }
      
      string filename_no_ext = filename;
      int ext_pos = StringFind(filename, ".chr");
      if(ext_pos >= 0)
      {
         filename_no_ext = StringSubstr(filename, 0, ext_pos);
      }
      
      string temp_tpl_name = filename_no_ext + ".tpl";
      string temp_tpl_path = "replay-chart-temp\\" + temp_tpl_name;
      
      int file_out = FileOpen(temp_tpl_path, FILE_WRITE | FILE_TXT | FILE_UNICODE);
      if(file_out == INVALID_HANDLE)
      {
         Print("[Warning] テンポラリテンプレート作成失敗: ", temp_tpl_path);
         continue;
      }
      FileWriteString(file_out, file_content);
      FileClose(file_out);
      
      ENUM_TIMEFRAMES period = (period_type >= 0 && period_size >= 0) ? GetTimeframeFromPeriod(period_type, period_size) : PERIOD_M1;
      
      chart_count++;
      ArrayResize(out_layouts, chart_count);
      
      out_layouts[chart_count - 1].tpl_path = "\\Files\\replay-chart-temp\\" + temp_tpl_name;
      out_layouts[chart_count - 1].target_symbol = target_symbol;
      out_layouts[chart_count - 1].period = period;
      out_layouts[chart_count - 1].floating = floating;
      out_layouts[chart_count - 1].win_left = win_left;
      out_layouts[chart_count - 1].win_top = win_top;
      out_layouts[chart_count - 1].win_right = win_right;
      out_layouts[chart_count - 1].win_bottom = win_bottom;
      out_layouts[chart_count - 1].float_left = float_left;
      out_layouts[chart_count - 1].float_top = float_top;
      out_layouts[chart_count - 1].float_right = float_right;
      out_layouts[chart_count - 1].float_bottom = float_bottom;
      out_layouts[chart_count - 1].show_grid = (show_grid != 0);
      
      Print(StringFormat("[Info] プロファイル解析 チャート #%d (%s): 元シンボル='%s' -> 割当シンボル='%s' (役割: %s, 時間足: %s)",
         chart_count, filename, original_symbol, target_symbol, (is_sub_chart ? "SUB [デュアル比較]" : "MAIN [主フィード]"), EnumToString(period)));
      
   } while(FileFindNext(search_handle, filename));
   
   FileFindClose(search_handle);
   return (chart_count > 0);
}

//+------------------------------------------------------------------+
//| period_type と period_size から ENUM_TIMEFRAMES へ変換             |
//+------------------------------------------------------------------+
ENUM_TIMEFRAMES GetTimeframeFromPeriod(int p_type, int p_size)
{
   if(p_type == 0)
   {
      switch(p_size)
      {
         case 1:  return(PERIOD_M1);
         case 2:  return(PERIOD_M2);
         case 3:  return(PERIOD_M3);
         case 4:  return(PERIOD_M4);
         case 5:  return(PERIOD_M5);
         case 6:  return(PERIOD_M6);
         case 10: return(PERIOD_M10);
         case 12: return(PERIOD_M12);
         case 15: return(PERIOD_M15);
         case 20: return(PERIOD_M20);
         case 30: return(PERIOD_M30);
      }
   }
   else if(p_type == 1)
   {
      switch(p_size)
      {
         case 1:  return(PERIOD_H1);
         case 2:  return(PERIOD_H2);
         case 3:  return(PERIOD_H3);
         case 4:  return(PERIOD_H4);
         case 6:  return(PERIOD_H6);
         case 8:  return(PERIOD_H8);
         case 12: return(PERIOD_H12);
         case 24: return(PERIOD_D1);
      }
   }
   else if(p_type == 2)
   {
      if(p_size == 1) return(PERIOD_W1);
   }
   else if(p_type == 3)
   {
      if(p_size == 1) return(PERIOD_MN1);
   }
   return(PERIOD_M1);
}

//+------------------------------------------------------------------+
//| 秒数からENUM_TIMEFRAMESへの変換                                  |
//+------------------------------------------------------------------+
ENUM_TIMEFRAMES SecondsToTimeframe(int seconds)
{
   if(seconds >= 2592000) return(PERIOD_MN1);
   if(seconds >= 604800)  return(PERIOD_W1);
   if(seconds >= 86400)   return(PERIOD_D1);
   if(seconds >= 43200)   return(PERIOD_H12);
   if(seconds >= 28800)   return(PERIOD_H8);
   if(seconds >= 21600)   return(PERIOD_H6);
   if(seconds >= 14400)   return(PERIOD_H4);
   if(seconds >= 10800)   return(PERIOD_H3);
   if(seconds >= 7200)    return(PERIOD_H2);
   if(seconds >= 3600)    return(PERIOD_H1);
   if(seconds >= 1800)    return(PERIOD_M30);
   if(seconds >= 1200)    return(PERIOD_M20);
   if(seconds >= 900)     return(PERIOD_M15);
   if(seconds >= 720)     return(PERIOD_M12);
   if(seconds >= 600)     return(PERIOD_M10);
   if(seconds >= 360)     return(PERIOD_M6);
   if(seconds >= 300)     return(PERIOD_M5);
   if(seconds >= 240)     return(PERIOD_M4);
   if(seconds >= 180)     return(PERIOD_M3);
   if(seconds >= 120)     return(PERIOD_M2);
   return(PERIOD_M1);
}

//+------------------------------------------------------------------+
//| テンポラリテンプレートの削除                                     |
//+------------------------------------------------------------------+
void CleanTempTemplates()
{
   string filename;
   long search_handle = FileFindFirst("replay-chart-temp\\*", filename);
   if(search_handle == INVALID_HANDLE) return;
   FileFindClose(search_handle);
   
   search_handle = FileFindFirst("replay-chart-temp\\*.tpl", filename);
   if(search_handle != INVALID_HANDLE)
   {
      do
      {
         string temp_tpl_path = "replay-chart-temp\\" + filename;
         FileDelete(temp_tpl_path);
      } while(FileFindNext(search_handle, filename));
      FileFindClose(search_handle);
   }
   FolderDelete("replay-chart-temp");
}

//+------------------------------------------------------------------+
//| 指定時間足で指定バー数分過去の実取引バー開始日時を取得            |
//| （土日・祝日・休場時間を自動的にスキップして実バー数を担保）      |
//+------------------------------------------------------------------+
datetime GetBarHistoryStartTime(string symbol, ENUM_TIMEFRAMES tf, datetime ref_time, int bar_count)
{
   if(bar_count <= 0) return ref_time;
   
   MqlRates rates[];
   ArrayFree(rates);
   // ref_time - 1 から過去方向に bar_count 本のバーを取得
   int copied = CopyRates(symbol, tf, ref_time - 1, bar_count, rates);
   if(copied > 0)
   {
      datetime min_time = rates[0].time;
      for(int i = 1; i < copied; i++)
      {
         if(rates[i].time < min_time)
         {
            min_time = rates[i].time;
         }
      }
      
      // ヒストリー不足時は、不足バー数を単純秒数換算で遡る
      if(copied < bar_count)
      {
         int missing_bars = bar_count - copied;
         min_time = min_time - (PeriodSeconds(tf) * missing_bars);
      }
      return min_time;
   }
   
   // CopyRates取得失敗時のフォールバック（単純秒数換算）
   int period_sec = PeriodSeconds(tf);
   return ref_time - (period_sec * bar_count);
}

//+------------------------------------------------------------------+
//| 歴史データの事前書き込み（プリロード）                            |
//+------------------------------------------------------------------+
bool PreloadHistoricalRates(string source_symbol, string replay_symbol, datetime start_time, int max_period_sec)
{
   SymbolSelect(source_symbol, true);
   datetime preload_start = 0;
   datetime preload_end = start_time - 1;

   if(m_preload_mode == "DATE")
   {
      if(m_preload_start_time <= 0)
      {
         Print("[Warning] プリロード開始日付が不正です。バー数指定モードにフォールバックします。");
         m_preload_mode = "BARS";
      }
      else
      {
         preload_start = ConvertJSTToServer(m_preload_start_time);
      }
   }

   if(m_preload_mode == "BARS")
   {
      if(InpPreloadedBars <= 0) return true;
      ENUM_TIMEFRAMES tf = PERIOD_M1;
      if(m_preload_timeframe != "AUTO" && m_preload_timeframe != "")
      {
         tf = StringToTimeframe(m_preload_timeframe);
      }
      else
      {
         tf = SecondsToTimeframe(max_period_sec);
      }
      
      preload_start = GetBarHistoryStartTime(source_symbol, tf, start_time, InpPreloadedBars);
      Print("[Info] CopyRatesにより算出されたプリロード開始日時: ", TimeToString(preload_start, TIME_DATE|TIME_SECONDS), " (基準時間足: ", EnumToString(tf), ", 本数: ", InpPreloadedBars, ")");
   }
   
   //--- 過去ティックデータのプリロード開始日時の算出（土日・休場時間をスキップして実バー数で計算）
   datetime tick_preload_start = preload_start;
   if(m_limit_tick_history)
   {
      tick_preload_start = GetBarHistoryStartTime(source_symbol, m_tick_history_timeframe, start_time, m_max_history_bars);
      
      // ティック保持期間がバーのプリロード範囲よりも過去まで必要な場合は、
      // MT5カスタムシンボルの同期不整合（バー切り詰め）を防ぐためにバーのプリロード範囲も拡張する
      if(tick_preload_start < preload_start)
      {
         preload_start = tick_preload_start;
      }
   }
   else
   {
      // 履歴制限オフの場合、DATEモード等での過大な取得を防ぐため最大3日間に制限
      int max_seconds = 3 * 24 * 3600;
      if(start_time - tick_preload_start > max_seconds)
      {
         tick_preload_start = start_time - max_seconds;
      }
   }
   
   if(preload_start >= start_time)
   {
      Print("[Info] プリロード範囲が存在しません（開始日がリプレイ開始日以降です）。");
      return true;
   }
   
   Print("[Info] 歴史データプリロード取得範囲: ", TimeToString(preload_start, TIME_DATE|TIME_SECONDS), " 〜 ", TimeToString(preload_end, TIME_DATE|TIME_SECONDS));
   
   MqlRates preload_rates[];
   ArrayFree(preload_rates);
   
   int copied = CopyRates(source_symbol, PERIOD_M1, preload_start, preload_end, preload_rates);
   if(copied <= 0)
   {
      Print("[Warning] CopyRatesでのプリロード歴史M1バー取得失敗。メモリ内ティックデータからの自動生成を試みます: ", source_symbol);
      bool is_sub = (m_enable_dual_feed && source_symbol == m_source_symbol_sub);
      int src_tick_count = is_sub ? m_total_ticks_sub : m_total_ticks;
      
      if(src_tick_count > 0)
      {
         int sample_count = (src_tick_count > 200000) ? 200000 : src_tick_count;
         MqlRates generated[];
         ArrayResize(generated, sample_count);
         int gen_rates_count = 0;
         
         datetime last_bar_time = 0;
         for(int i = 0; i < sample_count; i++)
         {
            datetime t = is_sub ? (datetime)(m_all_ticks_sub[i].time_msc / 1000) : (datetime)(m_all_ticks[i].time_msc / 1000);
            datetime bar_time = t - (t % 60);
            double bid = is_sub ? m_all_ticks_sub[i].bid : m_all_ticks[i].bid;
            
            if(gen_rates_count == 0 || bar_time != last_bar_time)
            {
               if(gen_rates_count > 0 && gen_rates_count >= 3000) break;
               gen_rates_count++;
               generated[gen_rates_count - 1].time = bar_time;
               generated[gen_rates_count - 1].open = bid;
               generated[gen_rates_count - 1].high = bid;
               generated[gen_rates_count - 1].low = bid;
               generated[gen_rates_count - 1].close = bid;
               generated[gen_rates_count - 1].tick_volume = 1;
               generated[gen_rates_count - 1].spread = 20;
               last_bar_time = bar_time;
            }
            else
            {
               if(bid > generated[gen_rates_count - 1].high) generated[gen_rates_count - 1].high = bid;
               if(bid < generated[gen_rates_count - 1].low) generated[gen_rates_count - 1].low = bid;
               generated[gen_rates_count - 1].close = bid;
               generated[gen_rates_count - 1].tick_volume++;
            }
         }
         
         if(gen_rates_count > 0)
         {
            ArrayResize(generated, gen_rates_count);
            CustomRatesUpdate(replay_symbol, generated);
            Print("[Info] メモリ内ティックデータから ", gen_rates_count, " 件のM1バーを代替プリロード生成しました: ", replay_symbol);
         }
      }
      return true;
   }
   
   int updated = CustomRatesUpdate(replay_symbol, preload_rates);
   if(updated < 0)
   {
      Print("[Error] プリロードデータのシンボル適用に失敗。Code: ", GetLastError());
      return false;
   }
   Print("[Info] ", copied, " 件のM1バーを事前描画データとして適用しました。");
   
   if(tick_preload_start < start_time)
   {
      ulong preload_start_msc = (ulong)tick_preload_start * 1000;
      ulong preload_end_msc = (ulong)preload_end * 1000 + 999;
      
      Print("[Info] 歴史ティックプリロード取得範囲: ", TimeToString(tick_preload_start, TIME_DATE|TIME_SECONDS), " 〜 ", TimeToString(preload_end, TIME_DATE|TIME_SECONDS));
      
      MqlTick preload_ticks[];
      ArrayFree(preload_ticks);
      
      ResetLastError();
      int copied_ticks = CopyTicksRange(source_symbol, preload_ticks, COPY_TICKS_ALL, preload_start_msc, preload_end_msc);
      if(copied_ticks > 0)
      {
         int added = CustomTicksAdd(replay_symbol, preload_ticks);
         if(added < 0)
         {
            Print("[Warning] 過去ティックのプリロード適用に失敗。Code: ", GetLastError());
         }
         else
         {
            Print("[Info] ", added, " 件の過去ティックを事前描画データとして適用しました。");
         }
      }
      else if(copied_ticks < 0)
      {
         Print("[Warning] 過去ティックのプリロード取得に失敗。Code: ", GetLastError());
      }
      else
      {
         Print("[Info] 過去ティックのプリロードデータがありませんでした。");
      }
   }

   return true;
}

//+------------------------------------------------------------------+
//| 同期他通貨シンボルのデータ事前同期                               |
//+------------------------------------------------------------------+
void PrepareAdditionalSymbol(string sym, datetime start_time, datetime end_time, int max_period_sec = 60)
{
   string actual_sym = sym;
   bool is_custom = false;
   if(!SymbolExist(actual_sym, is_custom))
   {
      // 大文字・小文字の表記揺れ（例: EURJPY.CL -> EURJPY.cl）を全銘柄リストから吸収
      int total = SymbolsTotal(false);
      for(int i = 0; i < total; i++)
      {
         string sname = SymbolName(i, false);
         if(StringCompare(sname, sym, false) == 0)
         {
            actual_sym = sname;
            break;
         }
      }
   }
   
   if(SymbolSelect(actual_sym, true))
   {
      // プリロード開始時刻の計算
      int history_sec = MathMax(2000 * 60, InpPreloadedBars * max_period_sec);
      if(m_preload_mode == "DATE" && m_preload_start_time > 0)
      {
         datetime date_start = ConvertJSTToServer(m_preload_start_time);
         if(date_start < start_time)
         {
            history_sec = MathMax(history_sec, (int)(start_time - date_start));
         }
      }
      datetime preload_start = start_time - history_sec;
      
      // MT5がブローカーサーバーからヒストリーデータを事前ロードするまで試行
      int total_copied = 0;
      datetime temp[];
      ENUM_TIMEFRAMES tfs[] = { PERIOD_M1, PERIOD_M5, PERIOD_M15, PERIOD_H1 };
      int total_tfs = ArraySize(tfs);
      
      for(int t = 0; t < total_tfs; t++)
      {
         ENUM_TIMEFRAMES current_tf = tfs[t];
         int retries = 0;
         while(retries < 5)
         {
            ArrayFree(temp);
            ResetLastError();
            int copied = CopyTime(actual_sym, current_tf, preload_start, end_time, temp);
            if(copied > 0)
            {
               if(current_tf == PERIOD_M1) total_copied = copied;
               break;
            }
            Sleep(100);
            retries++;
         }
      }
      
      if(total_copied > 0)
      {
         Print("[Info] 他通貨シンボル '", actual_sym, "' の同期を完了しました。M1取得バー数: ", total_copied);
      }
      else
      {
         Print("[Info] 他通貨シンボル '", actual_sym, "' を気配値表示に追加しました。");
      }
   }
   else
   {
      Print("[Error] 他通貨シンボル '", sym, "' を気配値に追加できません。");
   }
}

//+------------------------------------------------------------------+
//| シーク処理（高速巻き戻し・早送り）                               |
//+------------------------------------------------------------------+
void SeekToPosition(int target_index)
{
   if(m_total_ticks <= 0) return;
   
   if(target_index < 0) target_index = 0;
   if(target_index >= m_total_ticks) target_index = m_total_ticks - 1;
   
   // 1. 進捗0%へのシーク（RESET）時の特別処理
   if(target_index == 0)
   {
      // 過去プリロードデータを破壊せず、0%地点（最初のティック）以降の未来ティック・バーのみを削除
      long del_msc = (long)m_all_ticks[0].time_msc + 1;
      int deleted = CustomTicksDelete(m_replay_symbol, del_msc, LONG_MAX);
      if(deleted < 0) Print("[Error] CustomTicksDelete 失敗 (RESET)。Code: ", GetLastError());
      
      datetime del_time = (datetime)(m_all_ticks[0].time_msc / 1000) + 1;
      int deleted_rates = CustomRatesDelete(m_replay_symbol, del_time, D'3000.01.01 00:00:00');
      if(deleted_rates < 0) Print("[Error] CustomRatesDelete 失敗 (RESET)。Code: ", GetLastError());
      
      m_current_idx = 1;
      m_virtual_current_msc = (long)m_all_ticks[0].time_msc;
      m_virtual_current_msc_acc = (double)m_virtual_current_msc;
      
      // Sub シンボルのリセット
      if(m_enable_dual_feed && m_replay_symbol_sub != "")
      {
         if(m_total_ticks_sub > 0)
         {
            long del_sub_msc = (long)m_all_ticks_sub[0].time_msc + 1;
            CustomTicksDelete(m_replay_symbol_sub, del_sub_msc, LONG_MAX);
            datetime del_sub_time = (datetime)(m_all_ticks_sub[0].time_msc / 1000) + 1;
            CustomRatesDelete(m_replay_symbol_sub, del_sub_time, D'3000.01.01 00:00:00');
            m_current_idx_sub = 1;
         }
      }
   }
   else
   {
      // 同一タイムスタンプを持つティック群の境界を跨がないよう、ターゲットインデックスをグループの末尾に調整
      int adjusted_index = target_index;
      while(adjusted_index + 1 < m_total_ticks && 
            m_all_ticks[adjusted_index + 1].time_msc == m_all_ticks[target_index].time_msc)
      {
         adjusted_index++;
      }
      target_index = adjusted_index;
      
      long target_msc = (long)m_all_ticks[target_index].time_msc;
      
      // Subシンボルの同期インデックスを二分探索で高速特定
      int target_idx_sub = 0;
      if(m_enable_dual_feed && m_total_ticks_sub > 0)
      {
         int low = 0, high = m_total_ticks_sub - 1;
         while(low <= high)
         {
            int mid = low + (high - low) / 2;
            if(m_all_ticks_sub[mid].time_msc <= target_msc)
            {
               target_idx_sub = mid;
               low = mid + 1;
            }
            else
            {
               high = mid - 1;
            }
         }
      }
      
      if(target_index != m_current_idx - 1)
      {
         int current_last_idx = m_current_idx - 1;
         
         // A) 巻き戻し (Rewind): 未来のティックおよびレートのみを差分削除（過去データは100%維持）
         if(target_index < current_last_idx)
         {
            long delete_start_msc = (long)m_all_ticks[target_index].time_msc + 1;
            int deleted = CustomTicksDelete(m_replay_symbol, delete_start_msc, LONG_MAX);
            if(deleted < 0) Print("[Error] CustomTicksDelete 失敗。Code: ", GetLastError());
            
            datetime delete_start_time = (datetime)(m_all_ticks[target_index].time_msc / 1000) + 1;
            int deleted_rates = CustomRatesDelete(m_replay_symbol, delete_start_time, D'3000.01.01 00:00:00');
            if(deleted_rates < 0) Print("[Error] CustomRatesDelete 失敗。Code: ", GetLastError());
         }
         // B) 早送り (Fast Forward): 差分ティックのみを一括追加
         else if(target_index > current_last_idx)
         {
            int start_add_idx = m_current_idx;
            int count_to_add = target_index - start_add_idx + 1;
            if(count_to_add > 0)
            {
               static MqlTick s_seek_add_buffer[];
               if(ArrayResize(s_seek_add_buffer, count_to_add, 50000) >= 0)
               {
                  ArrayCopy(s_seek_add_buffer, m_all_ticks, 0, start_add_idx, count_to_add);
                  int added = CustomTicksAdd(m_replay_symbol, s_seek_add_buffer);
                  if(added < 0) Print("[Error] CustomTicksAdd 失敗。Code: ", GetLastError());
               }
            }
         }
         
         // Sub シンボルの差分シーク同期
         if(m_enable_dual_feed && m_total_ticks_sub > 0 && m_replay_symbol_sub != "")
         {
            int current_last_sub = m_current_idx_sub - 1;
            if(target_idx_sub < current_last_sub)
            {
               long del_msc = (long)m_all_ticks_sub[target_idx_sub].time_msc + 1;
               CustomTicksDelete(m_replay_symbol_sub, del_msc, LONG_MAX);
               datetime del_time = (datetime)(m_all_ticks_sub[target_idx_sub].time_msc / 1000) + 1;
               CustomRatesDelete(m_replay_symbol_sub, del_time, D'3000.01.01 00:00:00');
            }
            else if(target_idx_sub > current_last_sub)
            {
               int start_add_sub = m_current_idx_sub;
               int count_sub = target_idx_sub - start_add_sub + 1;
               if(count_sub > 0)
               {
                  static MqlTick s_seek_add_sub[];
                  if(ArrayResize(s_seek_add_sub, count_sub, 50000) >= 0)
                  {
                     ArrayCopy(s_seek_add_sub, m_all_ticks_sub, 0, start_add_sub, count_sub);
                     CustomTicksAdd(m_replay_symbol_sub, s_seek_add_sub);
                  }
               }
            }
            m_current_idx_sub = target_idx_sub + 1;
         }
         
         m_current_idx = target_index + 1;
         m_virtual_current_msc = (long)m_all_ticks[target_index].time_msc;
         m_virtual_current_msc_acc = (double)m_virtual_current_msc;
      }
   }
   
   m_last_real_timer_us = 0; // タイマ基準時間のリセット
   
   // シーク先の正確なターゲット価格を判定し、グローバル変数に設定
   double target_price = 0;
   if(target_index >= 0 && target_index < m_total_ticks)
   {
      target_price = m_all_ticks[target_index].bid;
      if(target_price <= 0) target_price = m_all_ticks[target_index].last;
   }
   if(target_price <= 0)
   {
      target_price = SymbolInfoDouble(m_replay_symbol, SYMBOL_BID);
   }
    GlobalVariableSet("Replay_Jump_Time", (double)m_virtual_current_msc);
    GlobalVariableSet("Replay_Jump_Price", target_price);
    UpdateReplayGeneration();
   
   // 各チャートを強制再計算・リフレッシュ（シーク時は即時再描画）
   int total_charts = ArraySize(m_viewer_chart_ids);
   for(int i = 0; i < total_charts; i++)
   {
      long cid = m_viewer_chart_ids[i];
      if(cid > 0)
      {
         ENUM_TIMEFRAMES period = m_viewer_periods[i];
         
         // オートスクロールを一時オフにしてから時間軸を設定しなおす
         ChartSetInteger(cid, CHART_AUTOSCROLL, false);
         string chart_sym = ChartSymbol(cid);
         if(chart_sym != "" && ChartPeriod(cid) != period)
             ChartSetSymbolPeriod(cid, chart_sym, period);
         
         if(InpAutoScrollSync)
         {
            ChartSetInteger(cid, CHART_AUTOSCROLL, true);
            ChartNavigate(cid, CHART_END, 0);
         }
         // センタリングのカスタムイベントを送信 (最新価格基準で強制センタリング指示)
         EventChartCustom(cid, 1001, 0, target_price, "");
         
         ChartRedraw(cid);
      }
   }
   
   // シークに合わせたポジション・履歴状態の同期
   SyncVirtualTradesOnSeek(m_virtual_current_msc);
   m_tick_accumulator = 0.0;
   m_main_fail_count = 0;
   
   // 即座に最新状態を書き込み
   WriteStatusFile();
}

//+------------------------------------------------------------------+
//| 夏時間（欧州）の判定                                             |
//+------------------------------------------------------------------+
bool IsSummerTimeEurope(datetime dt)
{
   MqlDateTime mdt;
   TimeToStruct(dt, mdt);
   
   if(mdt.mon < 3 || mdt.mon > 10) return false;
   if(mdt.mon > 3 && mdt.mon < 10) return true;
   
   if(mdt.mon == 3)
   {
      MqlDateTime t31 = mdt;
      t31.day = 31; t31.hour = 0; t31.min = 0; t31.sec = 0;
      datetime t31_time = StructToTime(t31);
      MqlDateTime t31_struct;
      TimeToStruct(t31_time, t31_struct);
      int last_sunday = 31 - t31_struct.day_of_week;
      return (mdt.day >= last_sunday);
   }
   if(mdt.mon == 10)
   {
      MqlDateTime t31 = mdt;
      t31.day = 31; t31.hour = 0; t31.min = 0; t31.sec = 0;
      datetime t31_time = StructToTime(t31);
      MqlDateTime t31_struct;
      TimeToStruct(t31_time, t31_struct);
      int last_sunday = 31 - t31_struct.day_of_week;
      return (mdt.day < last_sunday);
   }
   return false;
}

//+------------------------------------------------------------------+
//| 夏時間（米国）の判定                                             |
//+------------------------------------------------------------------+
bool IsSummerTimeUS(datetime dt)
{
   MqlDateTime mdt;
   TimeToStruct(dt, mdt);
   
   if(mdt.mon < 3 || mdt.mon > 11) return false;
   if(mdt.mon > 3 && mdt.mon < 11) return true;
   
   if(mdt.mon == 3)
   {
      MqlDateTime t1 = mdt;
      t1.day = 1; t1.hour = 0; t1.min = 0; t1.sec = 0;
      datetime t1_time = StructToTime(t1);
      MqlDateTime t1_struct;
      TimeToStruct(t1_time, t1_struct);
      int first_sunday = 1 + (7 - t1_struct.day_of_week) % 7;
      int second_sunday = first_sunday + 7;
      return (mdt.day >= second_sunday);
   }
   if(mdt.mon == 11)
   {
      MqlDateTime t1 = mdt;
      t1.day = 1; t1.hour = 0; t1.min = 0; t1.sec = 0;
      datetime t1_time = StructToTime(t1);
      MqlDateTime t1_struct;
      TimeToStruct(t1_time, t1_struct);
      int first_sunday = 1 + (7 - t1_struct.day_of_week) % 7;
      return (mdt.day < first_sunday);
   }
   return false;
}

//+------------------------------------------------------------------+
//| 時間パース                                                       |
//+------------------------------------------------------------------+
void ParseTimeStrings(string time_str, int &out_hour, int &out_min)
{
   string parts[];
   int count = StringSplit(time_str, ':', parts);
   if(count >= 2)
   {
      out_hour = (int)StringToInteger(parts[0]);
      out_min  = (int)StringToInteger(parts[1]);
   }
   else
   {
      out_hour = 0; out_min = 0;
   }
}

//+------------------------------------------------------------------+
//| 安全な日加算                                                     |
//+------------------------------------------------------------------+
datetime AddDays(datetime time_val, int days)
{
   MqlDateTime mdt;
   TimeToStruct(time_val, mdt);
   mdt.day += days;
   mdt.hour = 0; mdt.min = 0; mdt.sec = 0;
   return StructToTime(mdt);
}

//+------------------------------------------------------------------+
//| セッション開始サーバー時間の取得                                 |
//+------------------------------------------------------------------+
datetime GetSessionStartForDate(datetime date_val, string session)
{
   MqlDateTime mdt;
   TimeToStruct(date_val, mdt);
   
   int target_hour = 0;
   int target_min = 0;
   
   if(session == "TYO")
   {
      ParseTimeStrings(InpTokyoCoreTime, target_hour, target_min);
   }
   else if(session == "LDN")
   {
      if(IsSummerTimeEurope(date_val))
         ParseTimeStrings(InpLondonCoreSummer, target_hour, target_min);
      else
         ParseTimeStrings(InpLondonCoreWinter, target_hour, target_min);
   }
   else if(session == "NY")
   {
      if(IsSummerTimeUS(date_val))
         ParseTimeStrings(InpNYCoreSummer, target_hour, target_min);
      else
         ParseTimeStrings(InpNYCoreWinter, target_hour, target_min);
   }
   
   mdt.hour = target_hour;
   mdt.min = target_min;
   mdt.sec = 0;
   return StructToTime(mdt);
}

//+------------------------------------------------------------------+
//| 直前セッション検索                                               |
//+------------------------------------------------------------------+
datetime FindPreviousSessionStart(datetime current_time, string session)
{
   datetime current_jst = ConvertServerToJST(current_time);
   for(int i = 0; i < 10; i++)
   {
      datetime test_date_jst = AddDays(current_jst, -i);
      datetime S_jst = GetSessionStartForDate(test_date_jst, session);
      datetime S_server = ConvertJSTToServer(S_jst);
      if(S_server < current_time)
      {
         MqlDateTime s_mdt;
         TimeToStruct(S_server, s_mdt);
         if(s_mdt.day_of_week != 0 && s_mdt.day_of_week != 6)
         {
            return S_server;
         }
      }
   }
   return m_server_start_time;
}

//+------------------------------------------------------------------+
//| 直後セッション検索                                               |
//+------------------------------------------------------------------+
datetime FindNextSessionStart(datetime current_time, string session)
{
   datetime current_jst = ConvertServerToJST(current_time);
   for(int i = 0; i < 10; i++)
   {
      datetime test_date_jst = AddDays(current_jst, i);
      datetime S_jst = GetSessionStartForDate(test_date_jst, session);
      datetime S_server = ConvertJSTToServer(S_jst);
      if(S_server > current_time)
      {
         MqlDateTime s_mdt;
         TimeToStruct(S_server, s_mdt);
         if(s_mdt.day_of_week != 0 && s_mdt.day_of_week != 6)
         {
            return S_server;
         }
      }
   }
   return m_server_end_time;
}

//+------------------------------------------------------------------+
//| 順方向二分探索                                                   |
//+------------------------------------------------------------------+
int FindTickIndexForward(datetime target_time)
{
   if(m_total_ticks <= 0) return -1;
   long target_msc = (long)target_time * 1000;
   int low = 0;
   int high = m_total_ticks - 1;
   int ans = -1;
   while(low <= high)
   {
      int mid = low + (high - low) / 2;
      if(m_all_ticks[mid].time_msc >= target_msc)
      {
         ans = mid;
         high = mid - 1;
      }
      else
      {
         low = mid + 1;
      }
   }
   return ans;
}

//+------------------------------------------------------------------+
//| 逆方向二分探索                                                   |
//+------------------------------------------------------------------+
int FindTickIndexBackward(datetime target_time)
{
   if(m_total_ticks <= 0) return -1;
   long target_msc = (long)target_time * 1000 + 999;
   int low = 0;
   int high = m_total_ticks - 1;
   int ans = -1;
   while(low <= high)
   {
      int mid = low + (high - low) / 2;
      if(m_all_ticks[mid].time_msc <= target_msc)
      {
         ans = mid;
         low = mid + 1;
      }
      else
      {
         high = mid - 1;
      }
   }
   return ans;
}

//+------------------------------------------------------------------+
//| ミリ秒タイムスタンプ指定の高速二分探索                            |
//+------------------------------------------------------------------+
int FindTickIndexByMsc(long target_msc)
{
   if(m_total_ticks <= 0) return -1;
   if(target_msc > (long)m_all_ticks[m_total_ticks - 1].time_msc) return m_total_ticks - 1;
   int low = 0;
   int high = m_total_ticks - 1;
   int ans = -1;
   while(low <= high)
   {
      int mid = low + (high - low) / 2;
      if((long)m_all_ticks[mid].time_msc >= target_msc)
      {
         ans = mid;
         high = mid - 1;
      }
      else
      {
         low = mid + 1;
      }
   }
   return ans;
}

//+------------------------------------------------------------------+
//| セッションジャンプ実行                                           |
//+------------------------------------------------------------------+
void JumpToSessionStart(string session, bool is_advance)
{
   if(m_total_ticks <= 0) return;
   
   datetime current_v_time = (datetime)(m_virtual_current_msc / 1000);
   datetime target_time;
   int target_idx;
   
   if(session == "ANY")
   {
      if(is_advance)
      {
         datetime tyo = FindNextSessionStart(current_v_time, "TYO");
         datetime ldn = FindNextSessionStart(current_v_time, "LDN");
         datetime ny  = FindNextSessionStart(current_v_time, "NY");
         target_time = tyo;
         if(ldn < target_time) target_time = ldn;
         if(ny < target_time) target_time = ny;
         
         if(target_time > (datetime)(m_all_ticks[m_total_ticks - 1].time_msc/1000)) 
            target_time = (datetime)(m_all_ticks[m_total_ticks - 1].time_msc/1000);
         target_idx = FindTickIndexForward(target_time);
      }
      else
      {
         datetime tyo = FindPreviousSessionStart(current_v_time, "TYO");
         datetime ldn = FindPreviousSessionStart(current_v_time, "LDN");
         datetime ny  = FindPreviousSessionStart(current_v_time, "NY");
         target_time = tyo;
         if(ldn > target_time) target_time = ldn;
         if(ny > target_time) target_time = ny;
         
         if(target_time < (datetime)(m_all_ticks[0].time_msc/1000))
            target_time = (datetime)(m_all_ticks[0].time_msc/1000);
         target_idx = FindTickIndexBackward(target_time);
      }
   }
   else
   {
      if(is_advance)
      {
         target_time = FindNextSessionStart(current_v_time, session);
         if(target_time > (datetime)(m_all_ticks[m_total_ticks - 1].time_msc/1000)) 
            target_time = (datetime)(m_all_ticks[m_total_ticks - 1].time_msc/1000);
         target_idx = FindTickIndexForward(target_time);
      }
      else
      {
         target_time = FindPreviousSessionStart(current_v_time, session);
         if(target_time < (datetime)(m_all_ticks[0].time_msc/1000))
            target_time = (datetime)(m_all_ticks[0].time_msc/1000);
         target_idx = FindTickIndexBackward(target_time);
      }
   }
   
   if(target_idx >= 0 && target_idx < m_total_ticks)
   {
      SeekToPosition(target_idx);
      Print("[Info] Session Jump: ", session, (is_advance ? " NEXT" : " PREV"), " -> ", TimeToString((datetime)(m_all_ticks[target_idx].time_msc/1000), TIME_DATE|TIME_SECONDS));
   }
}

//+------------------------------------------------------------------+
//| サーバー時間 -> JST 変換                                         |
//+------------------------------------------------------------------+
datetime ConvertServerToJST(datetime server_time)
{
   if(IsSummerTimeUS(server_time))
   {
      return server_time + 6 * 3600;
   }
   else
   {
      return server_time + 7 * 3600;
   }
}

//+------------------------------------------------------------------+
//| JST -> サーバー時間 変換                                         |
//+------------------------------------------------------------------+
datetime ConvertJSTToServer(datetime jst_time)
{
   if(IsSummerTimeUS(jst_time))
   {
      return jst_time - 6 * 3600;
   }
   else
   {
      return jst_time - 7 * 3600;
   }
}

//+------------------------------------------------------------------+
//| JSONパース補助関数：汎用値抽出（文字列・数値・真偽値対応）         |
//+------------------------------------------------------------------+
string GetJsonKeyValue(string json, string key)
{
   string search_key = "\"" + key + "\"";
   int pos = StringFind(json, search_key);
   if(pos < 0) return "";
   
   int val_pos = StringFind(json, ":", pos + StringLen(search_key));
   if(val_pos < 0) return "";
   
   int len = StringLen(json);
   int start = val_pos + 1;
   
   // 空白文字をスキップ
   while(start < len)
   {
      ushort c = StringGetCharacter(json, start);
      if(c == ' ' || c == '\t' || c == '\r' || c == '\n')
         start++;
      else
         break;
   }
   
   if(start >= len) return "";
   
   ushort first_char = StringGetCharacter(json, start);
   string result = "";
   
   if(first_char == '\"')
   {
      // 文字列値の場合：次のダブルクォーテーションまで読み取る
      int end = start + 1;
      while(end < len)
      {
         ushort c = StringGetCharacter(json, end);
         if(c == '\"')
            break;
         result += ShortToString(c);
         end++;
      }
   }
   else
   {
      // 数値・真偽値などの場合：カンマ、波括弧、角括弧、または空白まで読み取る
      int end = start;
      while(end < len)
      {
         ushort c = StringGetCharacter(json, end);
         if(c == ',' || c == '}' || c == ']' || c == ' ' || c == '\t' || c == '\r' || c == '\n')
            break;
         result += ShortToString(c);
         end++;
      }
   }
   
   StringTrimLeft(result);
   StringTrimRight(result);
   return result;
}

//+------------------------------------------------------------------+
//| JSONパース補助関数：文字列値抽出                                  |
//+------------------------------------------------------------------+
string GetJsonString(string json, string key)
{
   return GetJsonKeyValue(json, key);
}

//+------------------------------------------------------------------+
//| JSONパース補助関数：数値値抽出                                    |
//+------------------------------------------------------------------+
double GetJsonDouble(string json, string key)
{
   string val = GetJsonKeyValue(json, key);
   return StringToDouble(val);
}

//+------------------------------------------------------------------+
//| JSONパース補助関数：真偽値値抽出                                  |
//+------------------------------------------------------------------+
bool GetJsonBool(string json, string key)
{
   string val = GetJsonKeyValue(json, key);
   StringToLower(val);
   return (val == "true" || val == "1");
}

//+------------------------------------------------------------------+
//| 複数ビューアーチャートの起動と表示プロパティ設定 (MTF・デュアル対応)|
//+------------------------------------------------------------------+
void CreateMTFCharts(string main_symbol, string sub_symbol = "", bool enable_dual = false)
{
   bool profile_mode = false;
   ChartLayoutInfo layouts[];
   
   if(m_profile_name != "")
   {
      Print("[Info] プロファイルモードを有効にします。フォルダ名: ", m_profile_name);
      if(ProcessProfile(m_profile_name, main_symbol, sub_symbol, enable_dual, layouts))
      {
         profile_mode = true;
         Print("[Info] プロファイル解析に成功しました。チャート数: ", ArraySize(layouts));
      }
      else
      {
         Print("[Warning] プロファイル解析に失敗したため、従来の時間軸リスト設定フォールバックを使用します。");
      }
   }
   
   // 要求された時間軸リストの決定
   if(!profile_mode)
   {
      ArrayResize(layouts, 1);
      layouts[0].period = PERIOD_M1;
      layouts[0].target_symbol = main_symbol;
      layouts[0].tpl_path = "";
      layouts[0].floating = 0;
      layouts[0].win_left = 0;
      layouts[0].win_top = 0;
      layouts[0].win_right = 0;
      layouts[0].win_bottom = 0;
      layouts[0].float_left = 0;
      layouts[0].float_top = 0;
      layouts[0].float_right = 0;
      layouts[0].float_bottom = 0;
      layouts[0].show_grid = true; // デフォルトではグリッドを表示
   }
   
   // 既存のリプレイ用チャートをすべて閉じてクリーンな状態から開始
   long chart_id = ChartFirst();
   bool any_closed = false;
   while(chart_id >= 0)
   {
      long next_chart_id = ChartNext(chart_id);
      string csym = ChartSymbol(chart_id);
      if(csym == main_symbol || (sub_symbol != "" && csym == sub_symbol))
      {
         Print("[Info] 既存のビューアーチャートをクローズします: ID = ", chart_id, " (", csym, ")");
         ChartClose(chart_id);
         any_closed = true;
      }
      chart_id = next_chart_id;
   }
   if(any_closed)
   {
      Sleep(100); // チャートウィンドウ破棄の完了を待機
   }
   
   int total_req = ArraySize(layouts);
   ArrayResize(m_viewer_chart_ids, total_req);
   ArrayResize(m_viewer_periods, total_req);
   
   long matched_ids[];
   ArrayResize(matched_ids, 0);
   
   for(int i = 0; i < total_req; i++)
   {
      m_viewer_periods[i] = layouts[i].period;
      m_viewer_chart_ids[i] = 0;
      
      // 新規作成 (Main または Sub)
      string sym_to_open = (layouts[i].target_symbol != "") ? layouts[i].target_symbol : main_symbol;
      long cid = ChartOpen(sym_to_open, layouts[i].period);
      if(cid > 0)
      {
         m_viewer_chart_ids[i] = cid;
         
         int m_size = ArraySize(matched_ids);
         ArrayResize(matched_ids, m_size + 1);
         matched_ids[m_size] = cid;
         
         if(profile_mode)
         {
            if(!ChartApplyTemplate(cid, layouts[i].tpl_path))
            {
               Print("[Error] テンプレートの適用に失敗しました: ", layouts[i].tpl_path, " Code: ", GetLastError());
            }
            else
            {
               Print("[Info] テンプレートを適用しました: ", layouts[i].tpl_path, " (銘柄: ", sym_to_open, ")");
            }
            
            // テンプレート適用による意図しない銘柄リセットを防ぐため、確定銘柄と時間足を明示的に強制再設定
            ChartSetSymbolPeriod(cid, sym_to_open, layouts[i].period);
            
            // 明示的にグリッド表示設定を適用 (テンプレート適用時の非同期適用での上書き対策)
            ChartSetInteger(cid, CHART_SHOW_GRID, layouts[i].show_grid);
            
            // レイアウト・ドッキング状態の適用
            if(layouts[i].floating == 1)
            {
               // フローティング（ドッキング解除）
               ChartSetInteger(cid, CHART_IS_DOCKED, false);
               ChartSetInteger(cid, CHART_FLOAT_LEFT, layouts[i].float_left);
               ChartSetInteger(cid, CHART_FLOAT_TOP, layouts[i].float_top);
               ChartSetInteger(cid, CHART_FLOAT_RIGHT, layouts[i].float_right);
               ChartSetInteger(cid, CHART_FLOAT_BOTTOM, layouts[i].float_bottom);
               Print("[Info] フローティング状態を設定: L=", layouts[i].float_left, ", T=", layouts[i].float_top, ", R=", layouts[i].float_right, ", B=", layouts[i].float_bottom);
            }
            else
            {
               // ドッキング状態にして位置・サイズを調整
               ChartSetInteger(cid, CHART_IS_DOCKED, true);
               
               long c_hwnd = 0;
               long p_hwnd = 0;
               // ウィンドウハンドルが初期化されるまでウェイトを挟んで取得試行
               for(int r = 0; r < 10; r++)
               {
                  c_hwnd = ChartGetInteger(cid, CHART_WINDOW_HANDLE);
                  if(c_hwnd > 0)
                  {
                     p_hwnd = GetParent(c_hwnd);
                     if(p_hwnd > 0) break;
                  }
                  Sleep(10);
               }
               
               if(p_hwnd > 0)
               {
                  // 最小化/最大化を通常サイズへ復元
                  ShowWindow(p_hwnd, SW_SHOWNORMAL);
                  
                  int x = layouts[i].win_left;
                  int y = layouts[i].win_top;
                  int w = layouts[i].win_right - layouts[i].win_left;
                  int h = layouts[i].win_bottom - layouts[i].win_top;
                  MoveWindow(p_hwnd, x, y, w, h, true);
                  Print("[Info] ドッキング位置を設定: X=", x, ", Y=", y, ", W=", w, ", H=", h);
               }
               else
               {
                  Print("[Warning] ウィンドウハンドルが取得できなかったため、ドッキング配置を設定できませんでした。");
               }
            }
         }
         else
         {
            ChartSetInteger(cid, CHART_AUTOSCROLL, InpAutoScrollSync);
            ChartSetInteger(cid, CHART_SHIFT, true);
            ChartSetInteger(cid, CHART_SHOW_GRID, layouts[i].show_grid);
         }
         
         ChartRedraw(cid);
         Print("[Info] チャートを開きました: ID = ", cid, ", 設定銘柄 = ", sym_to_open, ", 確定ChartSymbol = ", ChartSymbol(cid), ", 時間軸 = ", EnumToString(ChartPeriod(cid)));
      }
      else
      {
         Print("[Error] チャートオープンに失敗しました。時間軸: ", EnumToString(layouts[i].period), " Code: ", GetLastError());
      }
   }
   
   if(profile_mode)
   {
      Print("[Info] プロファイルのレイアウトとドッキング状態を復元しました。");
   }
   else
   {
      Print("[Info] チャートの自動整列を行うには、MT5のメニューから「ウィンドウ」->「水平分割/垂直分割」を選択するか、Alt+Rキーを押してください。");
   }
}

//+------------------------------------------------------------------+
//| 生成するチャートの中から最大の時間軸（秒数）を取得する           |
//+------------------------------------------------------------------+
int GetMaxPeriodSeconds(string profile_name)
{
   int max_sec = 60; // 最小でもM1 (60秒)
   
   if(profile_name != "")
   {
      string search_mask = profile_name + "\\*.chr";
      string filename;
      long search_handle = FileFindFirst(search_mask, filename);
      if(search_handle != INVALID_HANDLE)
      {
         do
         {
            string profile_file_path = profile_name + "\\" + filename;
            int file_in = OpenChrFileForReading(profile_file_path);
            if(file_in != INVALID_HANDLE)
            {
               int period_type = -1;
               int period_size = -1;
               while(!FileIsEnding(file_in))
               {
                  string line = FileReadString(file_in);
                  string trimmed = line;
                  StringTrimLeft(trimmed);
                  StringTrimRight(trimmed);
                  
                  if(period_type == -1 && StringFind(trimmed, "period_type=") == 0)
                  {
                     period_type = (int)StringToInteger(StringSubstr(trimmed, 12));
                  }
                  if(period_size == -1 && StringFind(trimmed, "period_size=") == 0)
                  {
                     period_size = (int)StringToInteger(StringSubstr(trimmed, 12));
                  }
                  if(period_type != -1 && period_size != -1)
                     break;
               }
               FileClose(file_in);
               
               if(period_type != -1 && period_size != -1)
               {
                  ENUM_TIMEFRAMES period = GetTimeframeFromPeriod(period_type, period_size);
                  max_sec = MathMax(max_sec, PeriodSeconds(period));
               }
            }
         } while(FileFindNext(search_handle, filename));
         FileFindClose(search_handle);
      }
   }
   return max_sec;
}

//+------------------------------------------------------------------+
//| 同期ボタンオブジェクトの作成                                     |
//+------------------------------------------------------------------+
void CreateSyncButton()
{
   ObjectDelete(0, "ReplaySyncButton");
   
   if(!ObjectCreate(0, "ReplaySyncButton", OBJ_BUTTON, 0, 0, 0))
   {
      Print("[Error] 同期ボタンの作成に失敗しました。Code: ", GetLastError());
      return;
   }
   
   ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_XDISTANCE, 10);
   ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_YDISTANCE, 10);
   ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_XSIZE, 220); // 文字幅に合わせて広めに設定
   ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_YSIZE, 30);
   ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_SELECTABLE, false);
   
   UpdateSyncButtonUI();
}

//+------------------------------------------------------------------+
//| 同期ボタンUI表示の更新                                           |
//+------------------------------------------------------------------+
void UpdateSyncButtonUI()
{
   if(ObjectFind(0, "ReplaySyncButton") < 0) return;
   
   if(!m_sync_enabled)
   {
      ObjectSetString(0, "ReplaySyncButton", OBJPROP_TEXT, "Start Replay Sync");
      ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_BGCOLOR, C'70,70,70');
      ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_COLOR, C'240,240,240');
      ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_STATE, false);
   }
   else
   {
      if(hReplayPipe != INVALID_HANDLE_VALUE)
      {
         ObjectSetString(0, "ReplaySyncButton", OBJPROP_TEXT, "Sync Active (Click to Stop)");
         ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_BGCOLOR, C'46,204,113'); // 緑色
         ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_COLOR, C'255,255,255');
         ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_STATE, true);
      }
      else
      {
         ObjectSetString(0, "ReplaySyncButton", OBJPROP_TEXT, "Connecting... (Click to Stop)");
         ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_BGCOLOR, C'230,126,34'); // オレンジ色
         ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_COLOR, C'255,255,255');
         ObjectSetInteger(0, "ReplaySyncButton", OBJPROP_STATE, true);
      }
   }
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| 同期ボタンオブジェクトの削除                                     |
//+------------------------------------------------------------------+
void DeleteSyncButton()
{
   ObjectDelete(0, "ReplaySyncButton");
}

//+------------------------------------------------------------------+
//| チャートイベントハンドラ（ボタンクリックイベントの捕捉）          |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id == CHARTEVENT_OBJECT_CLICK && sparam == "ReplaySyncButton")
   {
      m_sync_enabled = !m_sync_enabled;
      if(!m_sync_enabled)
      {
         ClosePipes();
         Print("[Info] 同期処理を手動で停止しました。");
      }
      else
      {
         Print("[Info] 同期処理を開始しました。Tauri アプリの接続を試行します。");
         m_last_connect_attempt = TimeLocal();
         ConnectPipes(true); // ボタン押下時に即時接続を試行
      }
      UpdateSyncButtonUI();
   }
}

//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| リプレイのタイムライン世代（TR_Gen）を更新                       |
//+------------------------------------------------------------------+
void UpdateReplayGeneration()
{
   double now_gen = (double)GetTickCount64();
   if(m_replay_symbol != "")
   {
      string var_name = "TR_Gen_" + m_replay_symbol;
      GlobalVariableSet(var_name, now_gen);
   }
   if(m_enable_dual_feed && m_replay_symbol_sub != "")
   {
      string var_name_sub = "TR_Gen_" + m_replay_symbol_sub;
      GlobalVariableSet(var_name_sub, now_gen);
   }
}

//+------------------------------------------------------------------+
//| 仮想成行注文発注                                                 |
//+------------------------------------------------------------------+
void VirtualOrderOpen(string type_str, double volume, double sl_points, double tp_points)
{
   if(!m_initialized || m_total_ticks <= 0 || m_current_idx <= 0)
   {
      WriteErrorStatus("Replay is not initialized or tick data empty.");
      return;
   }
   
   // 現在ティックから疑似レートを取得
   double bid = 0.0;
   double ask = 0.0;
   double spread = 0.0;
   if(!GetPseudoRateAtIndex(m_current_idx - 1, bid, ask, spread))
   {
      GetPseudoRates(m_all_ticks[m_current_idx - 1], bid, ask, spread);
   }
   if(bid <= 0) bid = m_all_ticks[m_current_idx - 1].last;
   if(ask <= 0) ask = m_all_ticks[m_current_idx - 1].last;
   if(bid <= 0) bid = SymbolInfoDouble(m_replay_symbol, SYMBOL_BID);
   if(ask <= 0) ask = SymbolInfoDouble(m_replay_symbol, SYMBOL_ASK);
   
   if(bid <= 0 || ask <= 0)
   {
      WriteErrorStatus("Failed to obtain current Bid/Ask prices.");
      return;
   }
   
   ENUM_POSITION_TYPE type = (type_str == "BUY") ? POSITION_TYPE_BUY : POSITION_TYPE_SELL;
   double open_price = (type == POSITION_TYPE_BUY) ? ask : bid;
   
   // 両建てOFF時の逆ポジション優先決済処理
   if(!m_hedging)
   {
      ENUM_POSITION_TYPE opposite_type = (type == POSITION_TYPE_BUY) ? POSITION_TYPE_SELL : POSITION_TYPE_BUY;
      double settle_price = (type == POSITION_TYPE_BUY) ? ask : bid;
      double remaining_volume = volume;
      
      int i = 0;
      while(i < ArraySize(m_virtual_positions) && remaining_volume > 0.0001)
      {
         if(m_virtual_positions[i].type == opposite_type)
         {
            double pos_vol = m_virtual_positions[i].volume;
            double close_vol = (pos_vol <= remaining_volume) ? pos_vol : remaining_volume;
            int ticket_to_close = m_virtual_positions[i].ticket;
            
            VirtualOrderCloseEx(ticket_to_close, close_vol, "SETTLEMENT", settle_price, m_virtual_current_msc, m_current_idx - 1, false);
            remaining_volume -= close_vol;
            
            // 全決済された場合は配列要素が詰められているためインデックスを進めない
            if(i < ArraySize(m_virtual_positions) && m_virtual_positions[i].ticket == ticket_to_close)
            {
               i++;
            }
         }
         else
         {
            i++;
         }
      }
      volume = remaining_volume;
   }
   
   if(volume <= 0.0001)
   {
      WriteStatusFile();
      return;
   }
   
   // 必要証拠金チェック
   double required_margin = volume * m_contract_size * open_price / m_account_leverage;
   if(m_account_free_margin < required_margin)
   {
      WriteErrorStatus("Margin is insufficient to open position.");
      return;
   }
   
   // SL/TP価格の計算
   double sl = 0.0;
   double tp = 0.0;
   double point = SymbolInfoDouble(m_replay_symbol, SYMBOL_POINT);
   if(point <= 0) point = 0.01; // JPYペアなどのデフォルトフォールバック
   
   if(sl_points > 0)
   {
      sl = (type == POSITION_TYPE_BUY) ? (open_price - sl_points * point) : (open_price + sl_points * point);
   }
   if(tp_points > 0)
   {
      tp = (type == POSITION_TYPE_BUY) ? (open_price + tp_points * point) : (open_price - tp_points * point);
   }
   
   // ポジション配列の拡張と格納
   int size = ArraySize(m_virtual_positions);
   ArrayResize(m_virtual_positions, size + 1);
   
   double one_pip = (StringFind(m_replay_symbol, "JPY") >= 0) ? 0.01 : 0.0001;
   double volatility_pips = 0.0;
   ulong vol_60s = 0;
   CalculateVolatilityAndVolume(m_current_idx, volatility_pips, vol_60s);
   
   m_virtual_positions[size].ticket = m_next_ticket++;
   m_virtual_positions[size].symbol = m_replay_symbol;
   m_virtual_positions[size].type = type;
   m_virtual_positions[size].volume = volume;
   m_virtual_positions[size].open_price = open_price;
   m_virtual_positions[size].current_price = open_price;
   m_virtual_positions[size].open_time = (datetime)(m_virtual_current_msc / 1000);
   m_virtual_positions[size].open_time_msc = m_virtual_current_msc;
   m_virtual_positions[size].close_price = 0;
   m_virtual_positions[size].close_time = 0;
   m_virtual_positions[size].close_time_msc = 0;
   m_virtual_positions[size].sl = sl;
   m_virtual_positions[size].tp = tp;
   m_virtual_positions[size].commission = 0;
   m_virtual_positions[size].swap = 0;
   m_virtual_positions[size].profit = 0;
   m_virtual_positions[size].close_reason = "";
   m_virtual_positions[size].mfe_pips = 0.0;
   m_virtual_positions[size].mae_pips = 0.0;
   m_virtual_positions[size].spread_entry = spread / one_pip;
   m_virtual_positions[size].volatility = volatility_pips;
   m_virtual_positions[size].volume_60s = vol_60s;
   
   Print(StringFormat("[Info] Virtual Position opened: #%d %s %.2f @ %.5f", 
      m_virtual_positions[size].ticket, type_str, volume, open_price));
      
   // チャート上にエントリーを示す矢印をスタンプ
   int total_charts = ArraySize(m_viewer_chart_ids);
   string arrow_name = StringFormat("TradeEntry_%d", m_virtual_positions[size].ticket);
   for(int c = 0; c < total_charts; c++)
   {
      long cid = m_viewer_chart_ids[c];
      if(cid > 0)
      {
         if(ObjectCreate(cid, arrow_name, OBJ_ARROW, 0, m_virtual_positions[size].open_time, open_price))
         {
            ObjectSetInteger(cid, arrow_name, OBJPROP_ARROWCODE, (type == POSITION_TYPE_BUY ? 241 : 242)); // 矢印上向き/下向き
            ObjectSetInteger(cid, arrow_name, OBJPROP_COLOR, (type == POSITION_TYPE_BUY ? clrDodgerBlue : clrTomato));
            ObjectSetInteger(cid, arrow_name, OBJPROP_WIDTH, 2);
         }
      }
   }
   
   // ポジションラインを描画・更新
   UpdateChartObjects();
   
   // 証拠金・P&Lの再計算
   int current_tick_idx = (m_current_idx > 0) ? (m_current_idx - 1) : 0;
   if(m_total_ticks > 0 && current_tick_idx < m_total_ticks)
   {
      EvaluatePositionsByTick(m_all_ticks[current_tick_idx], current_tick_idx);
   }
   else
   {
      MqlTick tick;
      tick.bid = bid;
      tick.ask = ask;
      tick.time_msc = m_virtual_current_msc;
      EvaluatePositionsByTick(tick, -1);
   }
   
   // 即座にステータスを書き出し
   WriteStatusFile();
}

//+------------------------------------------------------------------+
//| 仮想ポジション決済                                               |
//+------------------------------------------------------------------+
void VirtualOrderClose(int ticket, double volume, string reason, bool trigger_reeval = true)
{
   if(!m_initialized || m_total_ticks <= 0 || m_current_idx <= 0) return;
   
   int current_tick_idx = m_current_idx - 1;
   double bid = 0.0;
   double ask = 0.0;
   double spread = 0.0;
   if(!GetPseudoRateAtIndex(current_tick_idx, bid, ask, spread))
   {
      GetPseudoRates(m_all_ticks[current_tick_idx], bid, ask, spread);
   }
   if(bid <= 0) bid = m_all_ticks[current_tick_idx].last;
   if(ask <= 0) ask = m_all_ticks[current_tick_idx].last;
   if(bid <= 0) bid = SymbolInfoDouble(m_replay_symbol, SYMBOL_BID);
   if(ask <= 0) ask = SymbolInfoDouble(m_replay_symbol, SYMBOL_ASK);
   
   int pos_idx = -1;
   int pos_size = ArraySize(m_virtual_positions);
   for(int i = 0; i < pos_size; i++)
   {
      if(m_virtual_positions[i].ticket == ticket)
      {
         pos_idx = i;
         break;
      }
   }
   
   if(pos_idx >= 0)
   {
      double close_price = (m_virtual_positions[pos_idx].type == POSITION_TYPE_BUY) ? bid : ask;
      VirtualOrderCloseEx(ticket, volume, reason, close_price, m_virtual_current_msc, current_tick_idx, trigger_reeval);
   }
}

//+------------------------------------------------------------------+
//| 仮想ポジション決済 (価格指定内部用)                              |
//+------------------------------------------------------------------+
void VirtualOrderCloseEx(int ticket, double volume, string reason, double closePrice, long closeTimeMsc, int tick_idx = -1, bool trigger_reeval = true)
{
   int pos_idx = -1;
   int pos_size = ArraySize(m_virtual_positions);
   for(int i = 0; i < pos_size; i++)
   {
      if(m_virtual_positions[i].ticket == ticket)
      {
         pos_idx = i;
         break;
      }
   }
   if(pos_idx < 0) return;
   
   VirtualPosition pos = m_virtual_positions[pos_idx];
   double close_vol = (volume > 0 && volume < pos.volume) ? volume : pos.volume;
   
   double realized_profit = CalculateVirtualProfit(m_replay_symbol, pos.type, close_vol, pos.open_price, closePrice);
   
   // 履歴配列への退避
   int hist_size = ArraySize(m_virtual_history);
   ArrayResize(m_virtual_history, hist_size + 1);
   m_virtual_history[hist_size] = pos;
   m_virtual_history[hist_size].volume = close_vol;
   m_virtual_history[hist_size].close_price = closePrice;
   m_virtual_history[hist_size].close_time = (datetime)(closeTimeMsc / 1000);
   m_virtual_history[hist_size].close_time_msc = closeTimeMsc;
   m_virtual_history[hist_size].profit = realized_profit;
   m_virtual_history[hist_size].close_reason = reason;
   MarkTradeHistoryDirty();
   
   // 口座残高を更新
   m_account_balance += realized_profit;
   
   // 保有ポジションの更新または削除
   if(close_vol < pos.volume)
   {
      // 部分決済
      m_virtual_positions[pos_idx].volume = pos.volume - close_vol;
      Print(StringFormat("[Info] Virtual Position partially closed: #%d %s %.2f @ %.5f, remaining: %.2f, profit: %.2f (%s)", 
         pos.ticket, (pos.type == POSITION_TYPE_BUY ? "BUY" : "SELL"), close_vol, closePrice, m_virtual_positions[pos_idx].volume, realized_profit, reason));
   }
   else
   {
      // 全決済（保有ポジション配列から削除）
      for(int i = pos_idx; i < pos_size - 1; i++)
      {
         m_virtual_positions[i] = m_virtual_positions[i+1];
      }
      ArrayResize(m_virtual_positions, pos_size - 1);
      
      Print(StringFormat("[Info] Virtual Position closed: #%d %s %.2f @ %.5f, profit: %.2f (%s)", 
         pos.ticket, (pos.type == POSITION_TYPE_BUY ? "BUY" : "SELL"), pos.volume, closePrice, realized_profit, reason));
   }
   
   // チャート上に決済履歴矢印とコネクタを結ぶ
   int total_charts = ArraySize(m_viewer_chart_ids);
   string link_name = StringFormat("TradeLink_%d_%.2f", pos.ticket, close_vol);
   string arrow_name = StringFormat("TradeExit_%d_%.2f", pos.ticket, close_vol);
   
   for(int c = 0; c < total_charts; c++)
   {
      long cid = m_viewer_chart_ids[c];
      if(cid <= 0) continue;
      if(!m_show_history) continue;
      
      // エントリーから決済への接続線
      if(ObjectCreate(cid, link_name, OBJ_TREND, 0, pos.open_time, pos.open_price, (datetime)(closeTimeMsc / 1000), closePrice))
      {
         ObjectSetInteger(cid, link_name, OBJPROP_COLOR, (pos.type == POSITION_TYPE_BUY ? clrDodgerBlue : clrTomato));
         ObjectSetInteger(cid, link_name, OBJPROP_STYLE, STYLE_SOLID);
         ObjectSetInteger(cid, link_name, OBJPROP_WIDTH, 1);
         ObjectSetInteger(cid, link_name, OBJPROP_RAY_RIGHT, false);
      }
      // 決済クロス印/矢印
      if(ObjectCreate(cid, arrow_name, OBJ_ARROW, 0, (datetime)(closeTimeMsc / 1000), closePrice))
      {
         ObjectSetInteger(cid, arrow_name, OBJPROP_ARROWCODE, 252);
         ObjectSetInteger(cid, arrow_name, OBJPROP_COLOR, (pos.type == POSITION_TYPE_BUY ? clrDodgerBlue : clrTomato));
         ObjectSetInteger(cid, arrow_name, OBJPROP_WIDTH, 2);
      }
   }
   
   // ポジション表示オブジェクトの削除または更新
   string obj_prefix = StringFormat("TradePos_%d", pos.ticket);
   string arrow_entry_name = StringFormat("TradeEntry_%d", pos.ticket);
   if(close_vol >= pos.volume)
   {
      for(int c = 0; c < total_charts; c++)
      {
         long cid = m_viewer_chart_ids[c];
         if(cid > 0)
         {
            ObjectDelete(cid, obj_prefix + "_line");
            ObjectDelete(cid, obj_prefix + "_sl");
            ObjectDelete(cid, obj_prefix + "_tp");
            if(!m_show_history)
            {
               ObjectDelete(cid, arrow_entry_name);
            }
         }
      }
   }
   
   // 他ポジション含めた口座ステータス更新（再評価が要求された場合のみ）
   if(trigger_reeval)
   {
      int eval_idx = (tick_idx >= 0) ? tick_idx : ((m_current_idx > 0) ? (m_current_idx - 1) : 0);
      if(m_total_ticks > 0 && eval_idx >= 0 && eval_idx < m_total_ticks)
      {
         EvaluatePositionsByTick(m_all_ticks[eval_idx], eval_idx);
      }
      else
      {
         MqlTick dummy;
         dummy.bid = closePrice;
         dummy.ask = closePrice;
         dummy.time_msc = closeTimeMsc;
         EvaluatePositionsByTick(dummy, -1);
      }
      
      // 即座にステータス書き出し
      WriteStatusFile();
   }
}

//+------------------------------------------------------------------+
//| 全ポジションの一括決済                                           |
//+------------------------------------------------------------------+
void VirtualOrderCloseAll(string reason)
{
   int pos_size = ArraySize(m_virtual_positions);
   for(int i = pos_size - 1; i >= 0; i--)
   {
      VirtualOrderClose(m_virtual_positions[i].ticket, m_virtual_positions[i].volume, reason, false);
   }
   if(m_total_ticks > 0 && m_current_idx > 0 && m_current_idx <= m_total_ticks)
   {
      EvaluatePositionsByTick(m_all_ticks[m_current_idx - 1], m_current_idx - 1);
   }
   WriteStatusFile();
}

//+------------------------------------------------------------------+
//| 買いポジションの一括決済                                         |
//+------------------------------------------------------------------+
void VirtualOrderCloseBuy(string reason)
{
   int pos_size = ArraySize(m_virtual_positions);
   for(int i = pos_size - 1; i >= 0; i--)
   {
      if(m_virtual_positions[i].type == POSITION_TYPE_BUY)
      {
         VirtualOrderClose(m_virtual_positions[i].ticket, m_virtual_positions[i].volume, reason, false);
      }
   }
   if(m_total_ticks > 0 && m_current_idx > 0 && m_current_idx <= m_total_ticks)
   {
      EvaluatePositionsByTick(m_all_ticks[m_current_idx - 1], m_current_idx - 1);
   }
   MarkTradeHistoryDirty();
   WriteStatusFile();
}

//+------------------------------------------------------------------+
//| 売りポジションの一括決済                                         |
//+------------------------------------------------------------------+
void VirtualOrderCloseSell(string reason)
{
   int pos_size = ArraySize(m_virtual_positions);
   for(int i = pos_size - 1; i >= 0; i--)
   {
      if(m_virtual_positions[i].type == POSITION_TYPE_SELL)
      {
         VirtualOrderClose(m_virtual_positions[i].ticket, m_virtual_positions[i].volume, reason, false);
      }
   }
   if(m_total_ticks > 0 && m_current_idx > 0 && m_current_idx <= m_total_ticks)
   {
      EvaluatePositionsByTick(m_all_ticks[m_current_idx - 1], m_current_idx - 1);
   }
   MarkTradeHistoryDirty();
   WriteStatusFile();
}

//+------------------------------------------------------------------+
//| ストップロス/テイクプロフィットの変更                            |
//+------------------------------------------------------------------+
void VirtualOrderModify(int ticket, double sl_price, double tp_price)
{
   int pos_size = ArraySize(m_virtual_positions);
   for(int i = 0; i < pos_size; i++)
   {
      if(m_virtual_positions[i].ticket == ticket)
      {
         m_virtual_positions[i].sl = sl_price;
         m_virtual_positions[i].tp = tp_price;
         Print(StringFormat("[Info] Virtual Position Modified: #%d SL: %.5f, TP: %.5f", ticket, sl_price, tp_price));
         break;
      }
   }
   // チャートの表示線を移動
   UpdateChartObjects();
   // 即座にステータス書き出し
   WriteStatusFile();
}

//+------------------------------------------------------------------+
//| 1ティックずつの仮想口座・ポジション評価（SL/TP約定含む）           |
//+------------------------------------------------------------------+
void EvaluatePositionsByTick(MqlTick &tick, int tick_idx = -1)
{
   double bid = 0.0;
   double ask = 0.0;
   double spread = 0.0;
   if(tick_idx >= 0 && tick_idx < ArraySize(m_pseudo_rates))
   {
      bid = m_pseudo_rates[tick_idx].bid;
      ask = m_pseudo_rates[tick_idx].ask;
      spread = m_pseudo_rates[tick_idx].spread;
   }
   else
   {
      GetPseudoRates(tick, bid, ask, spread);
   }

   int pos_size = ArraySize(m_virtual_positions);
   if(pos_size == 0)
   {
      // ポジションがない間は価格換算・SL/TP判定を行う必要がない。
      // 口座値だけ正規化して、通常再生時の毎ティック処理を早期終了する。
      m_account_equity = m_account_balance;
      m_account_margin = 0.0;
      m_account_free_margin = m_account_balance;
      m_account_margin_level = 0.0;
      return;
   }

   double profit_conversion_rate = GetProfitConversionRate(m_replay_symbol);
   double one_pip = (StringFind(m_replay_symbol, "JPY") >= 0) ? 0.01 : 0.0001;
   
   // 1. 各ポジションの含み損益計算およびSL/TP到達チェック
   for(int i = pos_size - 1; i >= 0; i--)
   {
      double current_price = (m_virtual_positions[i].type == POSITION_TYPE_BUY) ? bid : ask;
      m_virtual_positions[i].current_price = current_price;
      
      // 含み損益更新
      m_virtual_positions[i].profit = CalculateVirtualProfitWithRate(
         m_virtual_positions[i].type,
         m_virtual_positions[i].volume,
         m_virtual_positions[i].open_price,
         current_price,
         profit_conversion_rate
      );
      
      // MFE / MAE の更新 (pips単位)
      double diff_pips = (m_virtual_positions[i].type == POSITION_TYPE_BUY) ? 
                         (current_price - m_virtual_positions[i].open_price) : 
                         (m_virtual_positions[i].open_price - current_price);
      diff_pips = diff_pips / one_pip;
      
      if(diff_pips > m_virtual_positions[i].mfe_pips)
      {
         m_virtual_positions[i].mfe_pips = diff_pips;
      }
      
      double adverse_pips = -diff_pips; // 含み損 (pips)
      if(adverse_pips > m_virtual_positions[i].mae_pips)
      {
         m_virtual_positions[i].mae_pips = adverse_pips;
      }
      
      // ストップロス(SL)到達判定
      if(m_virtual_positions[i].sl > 0)
      {
         bool sl_hit = false;
         if(m_virtual_positions[i].type == POSITION_TYPE_BUY && bid <= m_virtual_positions[i].sl) sl_hit = true;
         if(m_virtual_positions[i].type == POSITION_TYPE_SELL && ask >= m_virtual_positions[i].sl) sl_hit = true;
         
         if(sl_hit)
         {
            VirtualOrderCloseEx(m_virtual_positions[i].ticket, m_virtual_positions[i].volume, "SL", m_virtual_positions[i].sl, tick.time_msc, tick_idx, false);
            pos_size = ArraySize(m_virtual_positions); // 配列サイズ再取得
            continue;
         }
      }
      
      // テイクプロフィット(TP)到達判定
      if(m_virtual_positions[i].tp > 0)
      {
         bool tp_hit = false;
         if(m_virtual_positions[i].type == POSITION_TYPE_BUY && bid >= m_virtual_positions[i].tp) tp_hit = true;
         if(m_virtual_positions[i].type == POSITION_TYPE_SELL && ask <= m_virtual_positions[i].tp) tp_hit = true;
         
         if(tp_hit)
         {
            VirtualOrderCloseEx(m_virtual_positions[i].ticket, m_virtual_positions[i].volume, "TP", m_virtual_positions[i].tp, tick.time_msc, tick_idx, false);
            pos_size = ArraySize(m_virtual_positions); // 配列サイズ再取得
            continue;
         }
      }
   }
   
   // 2. 口座ステータス全体の再計算
   double total_unrealized_profit = 0.0;
   double total_margin = 0.0;
   int current_pos_size = ArraySize(m_virtual_positions);
   
   for(int i = 0; i < current_pos_size; i++)
   {
      total_unrealized_profit += m_virtual_positions[i].profit;
      total_margin += m_virtual_positions[i].volume * m_contract_size * m_virtual_positions[i].open_price / m_account_leverage;
   }
   
   m_account_equity = m_account_balance + total_unrealized_profit;
   m_account_margin = total_margin;
   m_account_free_margin = m_account_equity - m_account_margin;
   if(m_account_margin > 0)
   {
      m_account_margin_level = (m_account_equity / m_account_margin) * 100.0;
   }
   else
   {
      m_account_margin_level = 0.0;
   }
}

//+------------------------------------------------------------------+
//| 仮想評価損益の算出                                               |
//+------------------------------------------------------------------+
double CalculateVirtualProfit(string symbol, ENUM_POSITION_TYPE type, double volume, double openPrice, double currentPrice)
{
   double profit_val = 0.0;
   double contract_size = m_contract_size; // 1ロットあたりの通貨数
   
   if(type == POSITION_TYPE_BUY)
   {
      profit_val = (currentPrice - openPrice) * volume * contract_size;
   }
   else
   {
      profit_val = (openPrice - currentPrice) * volume * contract_size;
   }
   
   // 対価通貨が JPY でない場合、簡易的に円に換算
   string sym_upper = symbol;
   StringToUpper(sym_upper);
   if(StringFind(sym_upper, "JPY") < 0)
   {
      double usdjpy_rate = 150.0;
      MqlTick tick;
      if(SymbolInfoTick("USDJPY", tick))
      {
         usdjpy_rate = tick.bid;
      }
      else if(SymbolInfoTick("USDJPY.cl", tick))
      {
         usdjpy_rate = tick.bid;
      }
      profit_val = profit_val * usdjpy_rate;
   }
   
   return profit_val;
}

//+------------------------------------------------------------------+
//| チャート上へのポジションライン描画・更新                           |
//+------------------------------------------------------------------+
// 同一ティック内の全ポジションで共通の換算レートを使う軽量な損益計算。
double CalculateVirtualProfitWithRate(ENUM_POSITION_TYPE type, double volume, double openPrice, double currentPrice, double conversion_rate)
{
   double profit_val = (type == POSITION_TYPE_BUY)
      ? (currentPrice - openPrice) * volume * m_contract_size
      : (openPrice - currentPrice) * volume * m_contract_size;
   return profit_val * conversion_rate;
}

double GetProfitConversionRate(string symbol)
{
   string sym_upper = symbol;
   StringToUpper(sym_upper);
   if(StringFind(sym_upper, "JPY") >= 0)
      return 1.0;

   double usdjpy_rate = 150.0;
   MqlTick tick;
   if(SymbolInfoTick("USDJPY", tick) && tick.bid > 0)
      usdjpy_rate = tick.bid;
   else if(SymbolInfoTick("USDJPY.cl", tick) && tick.bid > 0)
      usdjpy_rate = tick.bid;
   return usdjpy_rate;
}

void UpdateChartObjects()
{
   int pos_size = ArraySize(m_virtual_positions);
   int total_charts = ArraySize(m_viewer_chart_ids);
   
   for(int i = 0; i < pos_size; i++)
   {
      VirtualPosition pos = m_virtual_positions[i];
      string obj_prefix = StringFormat("TradePos_%d", pos.ticket);
      color line_color = (pos.type == POSITION_TYPE_BUY) ? clrDodgerBlue : clrTomato;
      
      for(int c = 0; c < total_charts; c++)
      {
         long cid = m_viewer_chart_ids[c];
         if(cid <= 0) continue;         // エントリー価格表示（水平線）
         string line_name = obj_prefix + "_line";
         if(ObjectFind(cid, line_name) < 0)
         {
            ObjectCreate(cid, line_name, OBJ_HLINE, 0, 0, pos.open_price);
            ObjectSetInteger(cid, line_name, OBJPROP_COLOR, line_color);
            ObjectSetInteger(cid, line_name, OBJPROP_STYLE, STYLE_DASH);
            ObjectSetInteger(cid, line_name, OBJPROP_WIDTH, 1);
            string desc = StringFormat("Virtual Pos #%d (%s %.2f @ %.5f)", 
               pos.ticket, (pos.type == POSITION_TYPE_BUY ? "BUY" : "SELL"), pos.volume, pos.open_price);
            ObjectSetString(cid, line_name, OBJPROP_TEXT, desc);
         }
         else
         {
            ObjectMove(cid, line_name, 0, 0, pos.open_price);
            string desc = StringFormat("Virtual Pos #%d (%s %.2f @ %.5f)", 
               pos.ticket, (pos.type == POSITION_TYPE_BUY ? "BUY" : "SELL"), pos.volume, pos.open_price);
            ObjectSetString(cid, line_name, OBJPROP_TEXT, desc);
         }
         
         // ストップロス表示
         string sl_name = obj_prefix + "_sl";
         if(pos.sl > 0)
         {
            if(ObjectFind(cid, sl_name) < 0)
            {
               ObjectCreate(cid, sl_name, OBJ_HLINE, 0, 0, pos.sl);
               ObjectSetInteger(cid, sl_name, OBJPROP_COLOR, clrCrimson);
               ObjectSetInteger(cid, sl_name, OBJPROP_STYLE, STYLE_DOT);
               ObjectSetInteger(cid, sl_name, OBJPROP_WIDTH, 1);
               ObjectSetString(cid, sl_name, OBJPROP_TEXT, StringFormat("Pos #%d SL (%.5f)", pos.ticket, pos.sl));
            }
            else
            {
               ObjectMove(cid, sl_name, 0, 0, pos.sl);
            }
         }
         else
         {
            ObjectDelete(cid, sl_name);
         }
         
         // テイクプロフィット表示
         string tp_name = obj_prefix + "_tp";
         if(pos.tp > 0)
         {
            if(ObjectFind(cid, tp_name) < 0)
            {
               ObjectCreate(cid, tp_name, OBJ_HLINE, 0, 0, pos.tp);
               ObjectSetInteger(cid, tp_name, OBJPROP_COLOR, clrMediumSeaGreen);
               ObjectSetInteger(cid, tp_name, OBJPROP_STYLE, STYLE_DOT);
               ObjectSetInteger(cid, tp_name, OBJPROP_WIDTH, 1);
               ObjectSetString(cid, tp_name, OBJPROP_TEXT, StringFormat("Pos #%d TP (%.5f)", pos.ticket, pos.tp));
            }
            else
            {
               ObjectMove(cid, tp_name, 0, 0, pos.tp);
            }
         }
         else
         {
            ObjectDelete(cid, tp_name);
         }
          
          // エントリー矢印の描画・更新（シーク等のクリーニング後に再描画するため）
          string entry_arrow_name = StringFormat("TradeEntry_%d", pos.ticket);
          if(ObjectFind(cid, entry_arrow_name) < 0)
          {
             if(ObjectCreate(cid, entry_arrow_name, OBJ_ARROW, 0, pos.open_time, pos.open_price))
             {
                ObjectSetInteger(cid, entry_arrow_name, OBJPROP_ARROWCODE, (pos.type == POSITION_TYPE_BUY ? 241 : 242));
                ObjectSetInteger(cid, entry_arrow_name, OBJPROP_COLOR, (pos.type == POSITION_TYPE_BUY ? clrDodgerBlue : clrTomato));
                ObjectSetInteger(cid, entry_arrow_name, OBJPROP_WIDTH, 2);
             }
          }
      }
   }
}

//+------------------------------------------------------------------+
//| チャート上の全仮想取引オブジェクトの消去                           |
//+------------------------------------------------------------------+
void ClearChartTradeObjects()
{
   int total_charts = ArraySize(m_viewer_chart_ids);
   for(int c = 0; c < total_charts; c++)
   {
      long cid = m_viewer_chart_ids[c];
      if(cid <= 0) continue;
      
      int total_objs = ObjectsTotal(cid);
      for(int i = total_objs - 1; i >= 0; i--)
      {
         string name = ObjectName(cid, i);
         if(StringSubstr(name, 0, 9) == "TradePos_" || 
            StringSubstr(name, 0, 10) == "TradeLink_" || 
            StringSubstr(name, 0, 10) == "TradeExit_" ||
            StringSubstr(name, 0, 11) == "TradeEntry_")
         {
            ObjectDelete(cid, name);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| 仮想口座・レバレッジのリセット設定                               |
//+------------------------------------------------------------------+
void ResetAccount(double initial_balance, double leverage)
{
   if(initial_balance <= 0) initial_balance = 1000000.0;
   if(leverage <= 0) leverage = 25.0;
   
   m_account_initial_balance = initial_balance;
   m_account_balance = initial_balance;
   m_account_equity = initial_balance;
   m_account_leverage = leverage;
   m_account_margin = 0;
   m_account_free_margin = initial_balance;
   m_account_margin_level = 0;
   
   ArrayFree(m_virtual_positions);
   ArrayFree(m_virtual_history);
   ClearChartTradeObjects();
   MarkTradeHistoryDirty();
   
   Print(StringFormat("[Info] Virtual Account Reset. Balance: %.2f JPY, Leverage: %.1fx", initial_balance, leverage));
   WriteStatusFile();
}

//+------------------------------------------------------------------+
//| 取引情報および履歴情報のJSONシリアライズ                         |
//+------------------------------------------------------------------+
static string m_cached_history_json = "";

void MarkTradeHistoryDirty()
{
   m_history_json_dirty = true;
   m_history_revision++;
}

string SerializePositionsAndHistoryToJson(bool include_history = true)
{
   int pos_size = ArraySize(m_virtual_positions);
   string json = "";
   
   // 口座残高
   json += StringFormat("\"account\":{\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"free_margin\":%.2f,\"margin_level\":%.2f,\"total_profit\":%.2f,\"leverage\":%.2f}",
      m_account_balance, m_account_equity, m_account_margin, m_account_free_margin, m_account_margin_level, (m_account_equity - m_account_balance), m_account_leverage);
   
   // 保有ポジション配列のシリアライズ（保有ポジションは価格変動に応じて毎ステータス構築）
   json += ",\"positions\":[";
   for(int i = 0; i < pos_size; i++)
   {
      if(i > 0) json += ",";
      string type_str = (m_virtual_positions[i].type == POSITION_TYPE_BUY) ? "BUY" : "SELL";
      json += StringFormat("{\"ticket\":%d,\"type\":\"%s\",\"volume\":%.2f,\"open_price\":%.5f,\"open_time\":\"%s\",\"open_time_msc\":%I64d,\"current_price\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"profit\":%.2f,\"mfe_pips\":%.2f,\"mae_pips\":%.2f,\"spread_entry\":%.2f,\"volatility\":%.2f,\"volume_60s\":%I64u}",
         m_virtual_positions[i].ticket,
         type_str,
         m_virtual_positions[i].volume,
         m_virtual_positions[i].open_price,
         TimeToString(m_virtual_positions[i].open_time, TIME_DATE|TIME_SECONDS),
         m_virtual_positions[i].open_time_msc,
         m_virtual_positions[i].current_price,
         m_virtual_positions[i].sl,
         m_virtual_positions[i].tp,
         m_virtual_positions[i].profit,
         m_virtual_positions[i].mfe_pips,
         m_virtual_positions[i].mae_pips,
         m_virtual_positions[i].spread_entry,
         m_virtual_positions[i].volatility,
         m_virtual_positions[i].volume_60s
      );
   }
   json += "]";
   
   // 取引履歴配列のシリアライズ（指定された場合のみ。決済・復元等の変更時のみ再構築してキャッシュ）
   if(include_history)
   {
      if(m_history_json_dirty || m_cached_history_json == "")
      {
         string hist_str = ",\"history\":[";
         int hist_size = ArraySize(m_virtual_history);
         for(int i = 0; i < hist_size; i++)
         {
            if(i > 0) hist_str += ",";
            string type_str = (m_virtual_history[i].type == POSITION_TYPE_BUY) ? "BUY" : "SELL";
            hist_str += StringFormat("{\"ticket\":%d,\"type\":\"%s\",\"volume\":%.2f,\"open_price\":%.5f,\"open_time\":\"%s\",\"open_time_msc\":%I64d,\"close_price\":%.5f,\"close_time\":\"%s\",\"close_time_msc\":%I64d,\"sl\":%.5f,\"tp\":%.5f,\"profit\":%.2f,\"close_reason\":\"%s\",\"mfe_pips\":%.2f,\"mae_pips\":%.2f,\"spread_entry\":%.2f,\"volatility\":%.2f,\"volume_60s\":%I64u}",
               m_virtual_history[i].ticket,
               type_str,
               m_virtual_history[i].volume,
               m_virtual_history[i].open_price,
               TimeToString(m_virtual_history[i].open_time, TIME_DATE|TIME_SECONDS),
               m_virtual_history[i].open_time_msc,
               m_virtual_history[i].close_price,
               TimeToString(m_virtual_history[i].close_time, TIME_DATE|TIME_SECONDS),
               m_virtual_history[i].close_time_msc,
               m_virtual_history[i].sl,
               m_virtual_history[i].tp,
               m_virtual_history[i].profit,
               m_virtual_history[i].close_reason,
               m_virtual_history[i].mfe_pips,
               m_virtual_history[i].mae_pips,
               m_virtual_history[i].spread_entry,
               m_virtual_history[i].volatility,
               m_virtual_history[i].volume_60s
            );
         }
         hist_str += "]";
         m_cached_history_json = hist_str;
      }
      json += m_cached_history_json;
      
      // 履歴キャッシュは有効のまま維持
      m_history_json_dirty = false;
   }
   
   return json;
}

//+------------------------------------------------------------------+
//| リプレイ巻き戻し（シーク）時の取引データの整合性同期             |
//+------------------------------------------------------------------+
void SyncVirtualTradesOnSeek(long target_msc)
{
   // 1. 保有中ポジションの巻き戻し判定
   int pos_size = ArraySize(m_virtual_positions);
   for(int i = pos_size - 1; i >= 0; i--)
   {
      if(m_virtual_positions[i].open_time_msc > target_msc)
      {
         // シーク先より未来にオープンされたポジションは消去
         for(int j = i; j < pos_size - 1; j++)
         {
            m_virtual_positions[j] = m_virtual_positions[j+1];
         }
         pos_size--;
         ArrayResize(m_virtual_positions, pos_size);
      }
   }
   
   // 2. 取引履歴の巻き戻し判定
   int hist_size = ArraySize(m_virtual_history);
   for(int i = hist_size - 1; i >= 0; i--)
   {
      if(m_virtual_history[i].close_time_msc > target_msc)
      {
         VirtualPosition trade = m_virtual_history[i];
         
         // 実現した損益を巻き戻して口座残高から差し引く
         m_account_balance -= trade.profit;
         
         // 履歴から削除
         for(int j = i; j < hist_size - 1; j++)
         {
            m_virtual_history[j] = m_virtual_history[j+1];
         }
         hist_size--;
         ArrayResize(m_virtual_history, hist_size);
         
         // エントリー時刻がシーク先以前であれば、未決済保有ポジションとして復活させる
         if(trade.open_time_msc <= target_msc)
         {
            trade.close_price = 0;
            trade.close_time = 0;
            trade.close_time_msc = 0;
            trade.profit = 0;
            trade.close_reason = "";
            
            int new_pos_size = ArraySize(m_virtual_positions);
            ArrayResize(m_virtual_positions, new_pos_size + 1);
            m_virtual_positions[new_pos_size] = trade;
         }
      }
   }
   
   // 3. チャート表示オブジェクトの完全クリーンアップと再描写
   ClearChartTradeObjects();
   UpdateChartObjects();
   
   // 履歴内のオブジェクトを再描画
   int current_hist_size = ArraySize(m_virtual_history);
   int total_charts = ArraySize(m_viewer_chart_ids);
   for(int i = 0; i < current_hist_size && m_show_history; i++)
   {
      VirtualPosition pos = m_virtual_history[i];
      string link_name = StringFormat("TradeLink_%d", pos.ticket);
      string arrow_exit_name = StringFormat("TradeExit_%d", pos.ticket);
      string arrow_entry_name = StringFormat("TradeEntry_%d", pos.ticket);
      
      for(int c = 0; c < total_charts; c++)
      {
         long cid = m_viewer_chart_ids[c];
         if(cid <= 0) continue;
         
         // エントリー矢印再描画
         if(ObjectCreate(cid, arrow_entry_name, OBJ_ARROW, 0, pos.open_time, pos.open_price))
         {
            ObjectSetInteger(cid, arrow_entry_name, OBJPROP_ARROWCODE, (pos.type == POSITION_TYPE_BUY ? 241 : 242));
            ObjectSetInteger(cid, arrow_entry_name, OBJPROP_COLOR, (pos.type == POSITION_TYPE_BUY ? clrDodgerBlue : clrTomato));
            ObjectSetInteger(cid, arrow_entry_name, OBJPROP_WIDTH, 2);
         }
         
         // コネクタトレンドライン再描画
         if(ObjectCreate(cid, link_name, OBJ_TREND, 0, pos.open_time, pos.open_price, pos.close_time, pos.close_price))
         {
            ObjectSetInteger(cid, link_name, OBJPROP_COLOR, (pos.type == POSITION_TYPE_BUY ? clrDodgerBlue : clrTomato));
            ObjectSetInteger(cid, link_name, OBJPROP_STYLE, STYLE_SOLID);
            ObjectSetInteger(cid, link_name, OBJPROP_WIDTH, 1);
            ObjectSetInteger(cid, link_name, OBJPROP_RAY_RIGHT, false);
         }
         
         // 決済矢印再描画
         if(ObjectCreate(cid, arrow_exit_name, OBJ_ARROW, 0, pos.close_time, pos.close_price))
         {
            ObjectSetInteger(cid, arrow_exit_name, OBJPROP_ARROWCODE, 252);
            ObjectSetInteger(cid, arrow_exit_name, OBJPROP_COLOR, (pos.type == POSITION_TYPE_BUY ? clrDodgerBlue : clrTomato));
            ObjectSetInteger(cid, arrow_exit_name, OBJPROP_WIDTH, 2);
         }
      }
   }
   
   // 口座状態の再計算
   int last_idx = (m_current_idx > 0 && m_current_idx <= m_total_ticks) ? (m_current_idx - 1) : 0;
   if(m_total_ticks > 0)
   {
      EvaluatePositionsByTick(m_all_ticks[last_idx], last_idx);
   }
   MarkTradeHistoryDirty();
}

//+------------------------------------------------------------------+
//| 過去取引履歴オブジェクトの再描画                                 |
//+------------------------------------------------------------------+
void RedrawHistoryObjects()
{
   if(!m_show_history) return;
   
   int current_hist_size = ArraySize(m_virtual_history);
   int total_charts = ArraySize(m_viewer_chart_ids);
   for(int i = 0; i < current_hist_size; i++)
   {
      VirtualPosition pos = m_virtual_history[i];
      string link_name = StringFormat("TradeLink_%d", pos.ticket);
      string arrow_exit_name = StringFormat("TradeExit_%d", pos.ticket);
      string arrow_entry_name = StringFormat("TradeEntry_%d", pos.ticket);
      
      for(int c = 0; c < total_charts; c++)
      {
         long cid = m_viewer_chart_ids[c];
         if(cid <= 0) continue;
         
         // エントリー矢印再描画
         if(ObjectFind(cid, arrow_entry_name) < 0)
         {
            if(ObjectCreate(cid, arrow_entry_name, OBJ_ARROW, 0, pos.open_time, pos.open_price))
            {
               ObjectSetInteger(cid, arrow_entry_name, OBJPROP_ARROWCODE, (pos.type == POSITION_TYPE_BUY ? 241 : 242));
               ObjectSetInteger(cid, arrow_entry_name, OBJPROP_COLOR, (pos.type == POSITION_TYPE_BUY ? clrDodgerBlue : clrTomato));
               ObjectSetInteger(cid, arrow_entry_name, OBJPROP_WIDTH, 2);
            }
         }
         
         // コネクタトレンドライン再描画
         if(ObjectFind(cid, link_name) < 0)
         {
            if(ObjectCreate(cid, link_name, OBJ_TREND, 0, pos.open_time, pos.open_price, pos.close_time, pos.close_price))
            {
               ObjectSetInteger(cid, link_name, OBJPROP_COLOR, (pos.type == POSITION_TYPE_BUY ? clrDodgerBlue : clrTomato));
               ObjectSetInteger(cid, link_name, OBJPROP_STYLE, STYLE_SOLID);
               ObjectSetInteger(cid, link_name, OBJPROP_WIDTH, 1);
               ObjectSetInteger(cid, link_name, OBJPROP_RAY_RIGHT, false);
            }
         }
         
         // 決済矢印再描画
         if(ObjectFind(cid, arrow_exit_name) < 0)
         {
            if(ObjectCreate(cid, arrow_exit_name, OBJ_ARROW, 0, pos.close_time, pos.close_price))
            {
               ObjectSetInteger(cid, arrow_exit_name, OBJPROP_ARROWCODE, 252);
               ObjectSetInteger(cid, arrow_exit_name, OBJPROP_COLOR, (pos.type == POSITION_TYPE_BUY ? clrDodgerBlue : clrTomato));
               ObjectSetInteger(cid, arrow_exit_name, OBJPROP_WIDTH, 2);
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| 過去取引履歴の表示・非表示の切り替え                             |
//+------------------------------------------------------------------+
void SetHistoryVisibility(bool show)
{
   m_show_history = show;
   if(!m_show_history)
   {
      // 履歴オブジェクトを一括削除
      int total_charts = ArraySize(m_viewer_chart_ids);
      for(int c = 0; c < total_charts; c++)
      {
         long cid = m_viewer_chart_ids[c];
         if(cid <= 0) continue;
         
         int total_objs = ObjectsTotal(cid);
         for(int i = total_objs - 1; i >= 0; i--)
         {
            string name = ObjectName(cid, i);
            bool should_delete = false;
            
            if(StringSubstr(name, 0, 10) == "TradeLink_" || StringSubstr(name, 0, 10) == "TradeExit_")
            {
               should_delete = true;
            }
            else if(StringSubstr(name, 0, 11) == "TradeEntry_")
            {
               // 保有ポジションの中にないチケットのTradeEntryのみ削除する
               int ticket = (int)StringToInteger(StringSubstr(name, 11));
               bool is_active = false;
               int pos_size = ArraySize(m_virtual_positions);
               for(int p = 0; p < pos_size; p++)
               {
                  if(m_virtual_positions[p].ticket == ticket)
                  {
                     is_active = true;
                     break;
                  }
               }
               if(!is_active)
               {
                  should_delete = true;
               }
            }
            
            if(should_delete)
            {
               ObjectDelete(cid, name);
            }
         }
      }
   }
   else
   {
      // 履歴オブジェクトを再描画
      RedrawHistoryObjects();
   }
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| 現在のミリ秒ローカル時刻を取得する                                |
//+------------------------------------------------------------------+
long GetCurrentUnixMsc()
{
   return gl_start_time_msc + (long)(GetMicrosecondCount() / 1000 - gl_start_tick_count); // 【修正: (long)へのキャストを追加】
}

//+------------------------------------------------------------------+
//| 直近60秒間のボラティリティと出来高を計算する                         |
//+------------------------------------------------------------------+
void CalculateVolatilityAndVolume(int current_idx, double &out_volatility, ulong &out_volume)
{
   out_volatility = 0.0;
   out_volume = 0;
   if(current_idx <= 1 || m_total_ticks <= 0) return;
   
   long current_time_msc = m_all_ticks[current_idx - 1].time_msc;
   long start_time_msc = current_time_msc - 60000; // 60秒前
   
   double max_price = -1.0;
   double min_price = 999999.0;
   ulong vol_sum = 0;
   ulong tick_count = 0;
   
   for(int i = current_idx - 1; i >= 0; i--)
   {
      if(m_all_ticks[i].time_msc < start_time_msc)
         break;
         
      double price = m_all_ticks[i].bid;
      if(price > 0)
      {
         if(max_price < 0 || price > max_price) max_price = price;
         if(price < min_price) min_price = price;
      }
      
      vol_sum += m_all_ticks[i].volume;
      tick_count++;
   }
   
   // ボラティリティの算出 (pips単位)
   if(max_price > 0 && min_price < 999999 && max_price > min_price)
   {
      double diff = max_price - min_price;
      double one_pip = (StringFind(m_replay_symbol, "JPY") >= 0) ? 0.01 : 0.0001;
      out_volatility = diff / one_pip;
   }
   
   // 出来高は、volumeの積算が0ならティック件数をフォールバックとする
   out_volume = (vol_sum > 0) ? vol_sum : tick_count;
}

//+------------------------------------------------------------------+
//| 厳密な四捨五入（ハーフアップ）を行うヘルパー関数                     |
//+------------------------------------------------------------------+
double RoundHalfUp(double value, int digits)
{
   double multiplier = MathPow(10.0, digits);
   return MathRound(value * multiplier + 1e-9) / multiplier;
}

//+------------------------------------------------------------------+
//| 価格を整数Unit（0.001単位等）に変換するヘルパー関数               |
//+------------------------------------------------------------------+
int ToUnit(double price, double unit)
{
   if(unit <= 0.0) return 0;
   return (int)MathRound(price / unit);
}

//+------------------------------------------------------------------+
//| 整数Unitから実価格（正規化済み）に変換するヘルパー関数            |
//+------------------------------------------------------------------+
double ToPrice(int units, double unit, int digits)
{
   return NormalizeDouble((double)units * unit, digits);
}

//+------------------------------------------------------------------+
//| インデックス指定で事前計算済み疑似DMMレートを取得                 |
//+------------------------------------------------------------------+
bool GetPseudoRateAtIndex(int index, double &bid, double &ask, double &spread)
{
   if(index < 0 || index >= ArraySize(m_pseudo_rates))
   {
      if(index >= 0 && index < m_total_ticks)
      {
         GetPseudoRates(m_all_ticks[index], bid, ask, spread);
         return true;
      }
      return false;
   }
   bid = m_pseudo_rates[index].bid;
   ask = m_pseudo_rates[index].ask;
   spread = m_pseudo_rates[index].spread;
   return true;
}

//+------------------------------------------------------------------+
//| 実質ゴトー日判定（平日5の倍数、週末前倒し金曜日、月末営業日）      |
//+------------------------------------------------------------------+
bool IsEffectiveGotobi(datetime jst_time)
{
   MqlDateTime dt;
   TimeToStruct(jst_time, dt);
   int day = dt.day;
   int dow = dt.day_of_week;
   int mon = dt.mon;
   int year = dt.year;

   // 1. 平日の5, 10, 15, 20, 25, 30日
   if(day % 5 == 0 && dow >= 1 && dow <= 5) return true;

   // 2. 金曜日の前倒しゴトー日（土曜が5の倍数、または日曜が5の倍数）
   if(dow == 5)
   {
      int sat_day = day + 1;
      int sun_day = day + 2;
      if(sat_day % 5 == 0 || sun_day % 5 == 0) return true;

      // 月末金曜日（土日が月末跨ぎ）
      int days_in_mon = 30;
      if(mon==1 || mon==3 || mon==5 || mon==7 || mon==8 || mon==10 || mon==12) days_in_mon = 31;
      else if(mon==2) days_in_mon = ((year%4==0 && year%100!=0) || year%400==0) ? 29 : 28;

      if(day == days_in_mon || day + 1 == days_in_mon || day + 2 == days_in_mon) return true;
   }

   // 3. 平日の月末最終営業日
   int days_in_mon = 30;
   if(mon==1 || mon==3 || mon==5 || mon==7 || mon==8 || mon==10 || mon==12) days_in_mon = 31;
   else if(mon==2) days_in_mon = ((year%4==0 && year%100!=0) || year%400==0) ? 29 : 28;

   if(day == days_in_mon && dow >= 1 && dow <= 5) return true;

   return false;
}

//+------------------------------------------------------------------+
//| ロード時に全ティックの疑似DMMレートを一括事前計算する             |
//+------------------------------------------------------------------+
void PrecalculatePseudoRates()
{
   if(m_total_ticks <= 0)
   {
      ArrayFree(m_pseudo_rates);
      return;
   }
   
   ArrayResize(m_pseudo_rates, m_total_ticks);
   
   string sym = (m_source_symbol != "") ? m_source_symbol : _Symbol;
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   if(digits <= 0) digits = (StringFind(sym, "JPY") >= 0) ? 3 : 5;
   double price_unit = MathPow(10.0, -digits);
   
   int base_spread_unit = MathMax(1, ToUnit(m_domestic_base_spread, price_unit));
   int threshold_unit = MathMax(1, ToUnit(m_mt5_threshold, price_unit));
   int rollover_base_unit = (m_pseudo_rollover_spread > 0) ? ToUnit(m_pseudo_rollover_spread, price_unit) : (int)MathRound(base_spread_unit * 17.5);
   
   int prev_bid_unit = 0;
   int prev_ask_unit = 0;
   int prev_spread_unit = 0;
   ENUM_PSEUDO_STATE prev_state = PSEUDO_STATE_NORMAL;
   
   for(int i = 0; i < m_total_ticks; i++)
   {
      if(!m_pseudo_rate_enabled)
      {
         m_pseudo_rates[i].bid = m_all_ticks[i].bid;
         m_pseudo_rates[i].ask = m_all_ticks[i].ask;
         m_pseudo_rates[i].spread = m_pseudo_rates[i].ask - m_pseudo_rates[i].bid;
         continue;
      }
      
      double orig_bid = m_all_ticks[i].bid;
      double orig_ask = m_all_ticks[i].ask;
      if(orig_bid <= 0) orig_bid = m_all_ticks[i].last;
      if(orig_ask <= 0) orig_ask = m_all_ticks[i].last;
      
      if(orig_bid <= 0 || orig_ask <= 0 || orig_bid == orig_ask)
      {
         // 直前の有効な疑似レートがあれば引き継ぐ（無効ティックによるキャッシュ破壊防止）
         if(i > 0 && m_pseudo_rates[i - 1].bid > 0 && m_pseudo_rates[i - 1].ask > m_pseudo_rates[i - 1].bid)
         {
            m_pseudo_rates[i] = m_pseudo_rates[i - 1];
         }
         else
         {
            m_pseudo_rates[i].bid = orig_bid;
            m_pseudo_rates[i].ask = orig_ask;
            m_pseudo_rates[i].spread = orig_ask - orig_bid;
         }
         continue;
      }
      
      int oanda_bid_unit = ToUnit(orig_bid, price_unit);
      int oanda_ask_unit = ToUnit(orig_ask, price_unit);
      int oanda_spread_unit = oanda_ask_unit - oanda_bid_unit;
      if(oanda_spread_unit <= 0) oanda_spread_unit = 1;
      
      int oanda_mid_unit = (int)MathRound((oanda_bid_unit + oanda_ask_unit) / 2.0);
      
      // ティック時刻（サーバー時間）を JST に変換して時・分を取得
      datetime jst_time = ConvertServerToJST(m_all_ticks[i].time);
      MqlDateTime dt;
      TimeToStruct(jst_time, dt);
      int hour = dt.hour;
      int min  = dt.min;
      int day  = dt.day;
      int dow  = dt.day_of_week;
      
      ENUM_PSEUDO_STATE current_state = PSEUDO_STATE_NORMAL;
      int spread_unit = base_spread_unit;
      
      // 仲値制御 (平日 9:53〜09:55:30 JST / 実測データ準拠)
      if(dow >= 1 && dow <= 5 && hour == 9)
      {
         bool is_gotobi = IsEffectiveGotobi(jst_time);
         double fix_spread = 0.0;
         if(min == 54)
         {
            fix_spread = is_gotobi ? 0.010 : 0.008; // 09:54 ピーク: 0.8銭 / 実質ゴトー日 1.0銭
         }
         else if(min == 55 && dt.sec < 30)
         {
            fix_spread = is_gotobi ? 0.007 : 0.005; // 09:55:00〜29 収束帯: 0.5銭 / 実質ゴトー日 0.7銭
         }
         else if(min == 53 && dt.sec < 30)
         {
            fix_spread = 0.004; // 09:53 事前動意: 0.4銭
         }
         
         if(fix_spread > 0.0)
         {
            current_state = PSEUDO_STATE_STRESS;
            spread_unit = MathMax(spread_unit, ToUnit(fix_spread, price_unit));
         }
      }
      // 早朝ロールオーバー時間帯判定（実測データ準拠: 夏 05:50〜07:14 / 冬 06:50〜08:14 JST）
      else if(m_pseudo_rollover_enabled)
      {
         int roll_hour = IsSummerTimeUS(m_all_ticks[i].time) ? 6 : 7;
         int pre_hour = roll_hour - 1;
         
         if(hour == pre_hour && min >= 50)
         {
            current_state = PSEUDO_STATE_STRESS;
            double prog = (double)(min - 50) / 10.0;
            spread_unit = ToUnit(0.005 + 0.010 * prog, price_unit); // 05:50〜: 0.5〜1.5銭
         }
         else if(hour == roll_hour)
         {
            if(min <= 5)
            {
               current_state = PSEUDO_STATE_ROLLOVER_EXTREME;
               spread_unit = ToUnit(0.065, price_unit); // ロールオーバー直後スパイク (平均6.5銭)
            }
            else
            {
               current_state = PSEUDO_STATE_ROLLOVER_WIDE;
               spread_unit = ToUnit(0.035, price_unit); // 早朝ワイド帯 (3.5銭)
            }
         }
         else if(hour == roll_hour + 1 && min < 10)
         {
            current_state = PSEUDO_STATE_ROLLOVER_WIDE;
            spread_unit = ToUnit(0.035, price_unit); // 07:00〜07:09: 3.5銭維持
         }
         else if(hour == roll_hour + 1 && min < 15)
         {
            current_state = PSEUDO_STATE_RECOVERY;
            double prog = (double)(min - 10) / 5.0;
            spread_unit = ToUnit(0.035 - (0.035 - 0.002) * prog, price_unit); // 07:10〜07:14: 3.5銭から急減衰
         }
         else
         {
            current_state = PSEUDO_STATE_NORMAL;
         }
      }

      
      // 通常時間帯 または ロールオーバー時のOANDAスプレッド急拡大（STRESS）判定
      if(current_state == PSEUDO_STATE_NORMAL)
      {
         if(oanda_spread_unit > threshold_unit)
         {
            current_state = PSEUDO_STATE_STRESS;
            spread_unit = base_spread_unit + (int)MathRound(m_sensitivity_coeff * (double)(oanda_spread_unit - threshold_unit));
         }
         else
         {
            spread_unit = base_spread_unit;
         }
      }
      else if(current_state == PSEUDO_STATE_ROLLOVER_WIDE)
      {
         int roll_thresh_unit = (int)MathRound(threshold_unit * 3.0);
         if(oanda_spread_unit > roll_thresh_unit)
         {
            spread_unit = rollover_base_unit + (int)MathRound(m_sensitivity_coeff * (double)(oanda_spread_unit - roll_thresh_unit));
         }
      }
      
      // 上限・下限ガード
      int max_limit_unit = base_spread_unit * 80;
      if(spread_unit > max_limit_unit) spread_unit = max_limit_unit;
      if(spread_unit < base_spread_unit) spread_unit = base_spread_unit;
      
      int target_mid_unit = oanda_mid_unit;
      int candidate_bid_unit = (int)MathRound((double)target_mid_unit - (double)spread_unit / 2.0);
      int candidate_ask_unit = candidate_bid_unit + spread_unit;
      
      // クォート保持判定 (Quote Stickiness)
      bool update_quote = true;
      if(i > 0 && prev_state == current_state && prev_spread_unit == spread_unit)
      {
         if(candidate_bid_unit == prev_bid_unit && candidate_ask_unit == prev_ask_unit)
         {
            update_quote = false;
         }
      }
      
      if(update_quote || i == 0)
      {
         prev_bid_unit = candidate_bid_unit;
         prev_ask_unit = candidate_ask_unit;
         prev_spread_unit = spread_unit;
         prev_state = current_state;
         
         m_pseudo_rates[i].bid = ToPrice(candidate_bid_unit, price_unit, digits);
         m_pseudo_rates[i].ask = ToPrice(candidate_ask_unit, price_unit, digits);
         m_pseudo_rates[i].spread = ToPrice(spread_unit, price_unit, digits);
      }
      else
      {
         m_pseudo_rates[i] = m_pseudo_rates[i - 1];
      }
   }
   
   Print(StringFormat("[Info] Precalculated pseudo rates for %d ticks. Unit=%.5f, BaseUnit=%d, Digits=%d", 
      m_total_ticks, price_unit, base_spread_unit, digits));
}

//+------------------------------------------------------------------+
//| 単一ティック用疑似レート取得関数（後方互換フォールバック）        |
//+------------------------------------------------------------------+
void GetPseudoRates(MqlTick &src_tick, double &out_bid, double &out_ask, double &out_spread)
{
   if(!m_pseudo_rate_enabled)
   {
      out_bid = src_tick.bid;
      out_ask = src_tick.ask;
      out_spread = out_ask - out_bid;
      return;
   }

   double bid = src_tick.bid;
   double ask = src_tick.ask;
   if(bid <= 0) bid = src_tick.last;
   if(ask <= 0) ask = src_tick.last;

   if(bid <= 0 || ask <= 0 || bid == ask)
   {
      out_bid = bid;
      out_ask = ask;
      out_spread = out_ask - out_bid;
      return;
   }

   string sym = (m_source_symbol != "") ? m_source_symbol : _Symbol;
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   if(digits <= 0) digits = (StringFind(sym, "JPY") >= 0) ? 3 : 5;
   double price_unit = MathPow(10.0, -digits);

   int base_spread_unit = MathMax(1, ToUnit(m_domestic_base_spread, price_unit));
   int threshold_unit = MathMax(1, ToUnit(m_mt5_threshold, price_unit));
   int rollover_base_unit = (m_pseudo_rollover_spread > 0) ? ToUnit(m_pseudo_rollover_spread, price_unit) : (int)MathRound(base_spread_unit * 17.5);

   int oanda_bid_unit = ToUnit(bid, price_unit);
   int oanda_ask_unit = ToUnit(ask, price_unit);
   int oanda_spread_unit = oanda_ask_unit - oanda_bid_unit;
   if(oanda_spread_unit <= 0) oanda_spread_unit = 1;
   int oanda_mid_unit = (int)MathRound((oanda_bid_unit + oanda_ask_unit) / 2.0);

   datetime jst_time = ConvertServerToJST(src_tick.time);
   MqlDateTime dt;
   TimeToStruct(jst_time, dt);
   int hour = dt.hour;
   int min  = dt.min;
   int day  = dt.day;
   int dow  = dt.day_of_week;

   ENUM_PSEUDO_STATE current_state = PSEUDO_STATE_NORMAL;
   int spread_unit = base_spread_unit;

   // 仲値制御 (平日 9:53〜09:55:30 JST / 実測データ準拠)
   if(dow >= 1 && dow <= 5 && hour == 9)
   {
      bool is_gotobi = IsEffectiveGotobi(jst_time);
      double fix_spread = 0.0;
      if(min == 54)
      {
         fix_spread = is_gotobi ? 0.010 : 0.008; // 09:54 ピーク: 0.8銭 / 実質ゴトー日 1.0銭
      }
      else if(min == 55 && dt.sec < 30)
      {
         fix_spread = is_gotobi ? 0.007 : 0.005; // 09:55:00〜29 収束帯: 0.5銭 / 実質ゴトー日 0.7銭
      }
      else if(min == 53 && dt.sec < 30)
      {
         fix_spread = 0.004; // 09:53 事前動意: 0.4銭
      }
      
      if(fix_spread > 0.0)
      {
         current_state = PSEUDO_STATE_STRESS;
         spread_unit = MathMax(spread_unit, ToUnit(fix_spread, price_unit));
      }
   }
   // 早朝ロールオーバー時間帯判定（実測データ準拠: 夏 05:50〜07:14 / 冬 06:50〜08:14 JST）
   else if(m_pseudo_rollover_enabled)
   {
      int roll_hour = IsSummerTimeUS(src_tick.time) ? 6 : 7;
      int pre_hour = roll_hour - 1;
      
      if(hour == pre_hour && min >= 50)
      {
         current_state = PSEUDO_STATE_STRESS;
         double prog = (double)(min - 50) / 10.0;
         spread_unit = ToUnit(0.005 + 0.010 * prog, price_unit); // 05:50〜: 0.5〜1.5銭
      }
      else if(hour == roll_hour)
      {
         if(min <= 5)
         {
            current_state = PSEUDO_STATE_ROLLOVER_EXTREME;
            spread_unit = ToUnit(0.065, price_unit); // ロールオーバー直後スパイク (平均6.5銭)
         }
         else
         {
            current_state = PSEUDO_STATE_ROLLOVER_WIDE;
            spread_unit = ToUnit(0.035, price_unit); // 早朝ワイド帯 (3.5銭)
         }
      }
      else if(hour == roll_hour + 1 && min < 10)
      {
         current_state = PSEUDO_STATE_ROLLOVER_WIDE;
         spread_unit = ToUnit(0.035, price_unit); // 07:00〜07:09: 3.5銭維持
      }
      else if(hour == roll_hour + 1 && min < 15)
      {
         current_state = PSEUDO_STATE_RECOVERY;
         double prog = (double)(min - 10) / 5.0;
         spread_unit = ToUnit(0.035 - (0.035 - 0.002) * prog, price_unit); // 07:10〜07:14: 3.5銭から急減衰
      }
      else
      {
         current_state = PSEUDO_STATE_NORMAL;
      }
   }

   if(current_state == PSEUDO_STATE_NORMAL)
   {
      if(oanda_spread_unit > threshold_unit)
      {
         spread_unit = base_spread_unit + (int)MathRound(m_sensitivity_coeff * (double)(oanda_spread_unit - threshold_unit));
      }
   }
   else if(current_state == PSEUDO_STATE_ROLLOVER_WIDE)
   {
      int roll_thresh_unit = (int)MathRound(threshold_unit * 3.0);
      if(oanda_spread_unit > roll_thresh_unit)
      {
         spread_unit = rollover_base_unit + (int)MathRound(m_sensitivity_coeff * (double)(oanda_spread_unit - roll_thresh_unit));
      }
   }

   int max_limit_unit = base_spread_unit * 80;
   if(spread_unit > max_limit_unit) spread_unit = max_limit_unit;
   if(spread_unit < base_spread_unit) spread_unit = base_spread_unit;

   int candidate_bid_unit = (int)MathRound((double)oanda_mid_unit - (double)spread_unit / 2.0);
   int candidate_ask_unit = candidate_bid_unit + spread_unit;

   out_bid = ToPrice(candidate_bid_unit, price_unit, digits);
   out_ask = ToPrice(candidate_ask_unit, price_unit, digits);
   out_spread = ToPrice(spread_unit, price_unit, digits);
}

//+------------------------------------------------------------------+
//| 特定の取引チケットの全ティック情報をJSONファイルとして出力する      |
//+------------------------------------------------------------------+
void ExportTradeTicksJson(int ticket)
{
   long open_msc = 0;
   long close_msc = 0;
   bool found = false;
   
   // 1. 履歴から検索
   int hist_size = ArraySize(m_virtual_history);
   for(int i = 0; i < hist_size; i++)
   {
      if(m_virtual_history[i].ticket == ticket)
      {
         open_msc = m_virtual_history[i].open_time_msc;
         close_msc = m_virtual_history[i].close_time_msc;
         found = true;
         break;
      }
   }
   
   // 2. 履歴になければ保有ポジションから検索
   if(!found)
   {
      int pos_size = ArraySize(m_virtual_positions);
      for(int i = 0; i < pos_size; i++)
      {
         if(m_virtual_positions[i].ticket == ticket)
         {
            open_msc = m_virtual_positions[i].open_time_msc;
            close_msc = m_virtual_current_msc;
            found = true;
            break;
         }
      }
   }
   
   if(!found)
   {
      Print("[Warning] GET_TRADE_TICKS: Ticket #", ticket, " not found.");
      return;
   }
   
   // 3. ティック配列内での範囲特定
   int start_idx = -1;
   int end_idx = -1;
   for(int i = 0; i < m_total_ticks; i++)
   {
      if(start_idx < 0 && m_all_ticks[i].time_msc >= open_msc)
      {
         start_idx = i;
      }
      if(m_all_ticks[i].time_msc <= close_msc)
      {
         end_idx = i;
      }
      else if(m_all_ticks[i].time_msc > close_msc)
      {
         break;
      }
   }
   
   if(start_idx < 0 || end_idx < 0 || start_idx > end_idx)
   {
      // ティックが見つからない場合は、フォールバックとして現在の1件だけ書き出す
      start_idx = m_current_idx - 1;
      end_idx = m_current_idx - 1;
      if(start_idx < 0) { start_idx = 0; end_idx = 0; }
   }
   
   int raw_count = end_idx - start_idx + 1;
   int step = 1;
   int max_ticks = 1000;
   if(raw_count > max_ticks)
   {
      step = raw_count / max_ticks;
      if(step < 1) step = 1;
   }
   
   // 4. JSONファイルの作成
   string filename = StringFormat("trade_ticks_%d.json", ticket);
   int file_handle = FileOpen(filename, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(file_handle == INVALID_HANDLE)
   {
      Print("[Error] Failed to open file for writing: ", filename, " Error: ", GetLastError());
      return;
   }
   
   FileWriteString(file_handle, "[\n");
   int written = 0;
   for(int i = start_idx; i <= end_idx; i += step)
   {
      if(written > 0)
         FileWriteString(file_handle, ",\n");
         
      double bid = 0.0;
      double ask = 0.0;
      double spread = 0.0;
      if(!GetPseudoRateAtIndex(i, bid, ask, spread))
         GetPseudoRates(m_all_ticks[i], bid, ask, spread);
      if(bid <= 0) bid = m_all_ticks[i].last;
      if(ask <= 0) ask = m_all_ticks[i].last;
      
      string tick_json = StringFormat("  {\"time\":%I64d,\"bid\":%.5f,\"ask\":%.5f}", m_all_ticks[i].time_msc, bid, ask);
      FileWriteString(file_handle, tick_json);
      written++;
   }
   // 最後の1件（Exit時点）は正確にチャートにプロットするために必ず最後に追加
   if(end_idx > start_idx && (end_idx - start_idx) % step != 0)
   {
      FileWriteString(file_handle, ",\n");
      double bid = 0.0;
      double ask = 0.0;
      double spread = 0.0;
      if(!GetPseudoRateAtIndex(end_idx, bid, ask, spread))
         GetPseudoRates(m_all_ticks[end_idx], bid, ask, spread);
      if(bid <= 0) bid = m_all_ticks[end_idx].last;
      if(ask <= 0) ask = m_all_ticks[end_idx].last;
      string tick_json = StringFormat("  {\"time\":%I64d,\"bid\":%.5f,\"ask\":%.5f}", m_all_ticks[end_idx].time_msc, bid, ask);
      FileWriteString(file_handle, tick_json);
   }
   
   FileWriteString(file_handle, "\n]");
   FileClose(file_handle);
   
   // フロントエンドへ完了通知を送る
   string msg = StringFormat("{\"status\":\"TRADE_TICKS_READY\",\"ticket\":%d}", ticket);
   WritePipeStatus(msg);
   
   Print("[Info] GET_TRADE_TICKS: Saved ", written, " ticks for Ticket #", ticket, " to ", filename);
}
