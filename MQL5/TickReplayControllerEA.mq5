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

//--- Win32 API Named Pipe インポート
#import "kernel32.dll"
long CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, long lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, long hTemplateFile);
int WriteFile(long hFile, uchar &lpBuffer[], uint nNumberOfBytesToWrite, uint &lpNumberOfBytesWritten, long lpOverlapped);
int ReadFile(long hFile, uchar &lpBuffer[], uint nNumberOfBytesToRead, uint &lpNumberOfBytesRead, long lpOverlapped);
int PeekNamedPipe(long hNamedPipe, long lpBuffer, uint nBufferSize, long lpBytesRead, uint &lpTotalBytesAvail, long lpBytesLeftThisMessage);
int CloseHandle(long hObject);
#import

//--- Win32 API User32 インポート
#import "user32.dll"
long GetParent(long hWnd);
bool MoveWindow(long hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
bool ShowWindow(long hWnd, int nCmdShow);
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
input int    InpTimerMs  = 30;    // タイマーの周期（ミリ秒）

//--- コントローラーEA内部の状態変数
string                  m_replay_symbol;        // 生成するカスタムシンボルの名前
string                  m_source_symbol;        // 複製元となるリアル銘柄名
MqlTick                 m_all_ticks[];          // ロードした全ティック配列
int                     m_total_ticks = 0;      // ロードした総ティック数
int                     m_current_idx = 0;      // 現在再生中のティックの配列インデックス
bool                    m_is_playing = false;   // 再生中フラグ
ENUM_REPLAY_SPEED_MODE  m_speed_mode = REPLAY_MODE_TEMPORAL; // 再生速度制御のモード
double                  m_time_multiplier = 1.0;// 時間比率モード時の倍速 (1.0 = 等倍)
int                     m_tick_step_count = 1;  // ティック枚数モード時の1タイマーあたりの配信数
long                    m_virtual_current_msc = 0; // リプレイ内の仮想現在時刻（ミリ秒）
uint                    m_last_real_timer_msc = 0; // 前回タイマー実行時のPCローカル時刻（ミリ秒カウンタ）
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
long                    hCommandPipe = INVALID_HANDLE_VALUE;    // コマンドパイプハンドル
long                    hStatusPipe = INVALID_HANDLE_VALUE;     // ステータスパイプハンドル
string                  m_accumulated_commands = "";            // 受信バッファ（コマンド分割用）
datetime                m_last_connect_attempt = 0;             // 前回の接続試行時刻
uint                    m_last_status_write = 0;                // 前回ステータス書き込み時刻
bool                    m_sync_enabled = false;                 // 同期処理の有効化フラグ
bool                    m_auto_skip_weekend = true;             // 週末などの休場期間を自動スキップするフラグ
bool                    m_initialized = false;                  // リプレイ初期化完了フラグ
bool                    m_hedging = false;                      // 両建て許可フラグ（デフォルトOFF）
bool                    m_pseudo_rate_enabled = true;          // 疑似レート生成機能の有効化フラグ
double                  m_domestic_base_spread = 0.002;         // 国内基準スプレッド
double                  m_mt5_threshold = 0.0110;               // MT5側判定閾値
double                  m_sensitivity_coeff = 1.025;            // 拡大感度（係数）

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

VirtualPosition   m_virtual_positions[];         // 保有ポジション的配列
VirtualPosition   m_virtual_history[];           // 決済履歴の動的配列
bool              m_show_history = false;        // 決済履歴の表示有無

//--- ミリ秒時間取得用キャリブレーション変数
long              gl_start_time_msc = 0;        // 起動時のPCローカル時間(ミリ秒)
ulong             gl_start_tick_count = 0;      // 起動時のGetMicrosecondCount(ミリ秒) 【修正: long から ulong へ変更】

//--- 新規追加の仮想取引関数宣言
void VirtualOrderOpen(string type_str, double volume, double sl_points, double tp_points);
void VirtualOrderClose(int ticket, double volume, string reason);
void VirtualOrderCloseEx(int ticket, double volume, string reason, double closePrice, long closeTimeMsc);
void VirtualOrderCloseAll(string reason);
void ExportTradeTicksJson(int ticket);
void VirtualOrderCloseBuy(string reason);
void VirtualOrderCloseSell(string reason);
void VirtualOrderModify(int ticket, double sl_price, double tp_price);
void EvaluatePositionsByTick(MqlTick &tick);
double CalculateVirtualProfit(string symbol, ENUM_POSITION_TYPE type, double volume, double openPrice, double currentPrice);
void SetHistoryVisibility(bool show);
void RedrawHistoryObjects();
void UpdateChartObjects();
void ClearChartTradeObjects();
void ResetAccount(double initial_balance, double leverage);
string SerializePositionsAndHistoryToJson();
void SyncVirtualTradesOnSeek(long target_msc);

//--- 前方宣言
double RoundHalfUp(double value, int digits); // 厳密な四捨五入（ハーフアップ）
void GetPseudoRates(MqlTick &src_tick, double &out_bid, double &out_ask, double &out_spread); // 疑似レート・スプレッド計算
bool InitializeReplaySymbol(string replay_symbol, string source_symbol);
bool LoadHistoricalTicks(string source_symbol, datetime start, datetime end);
void CreateMTFCharts(string symbol);
datetime ConvertServerToJST(datetime server_time);
datetime ConvertJSTToServer(datetime jst_time);
long FindExistingViewerChart(string symbol, ENUM_TIMEFRAMES period, long &exclude_ids[]);
ENUM_TIMEFRAMES StringToTimeframe(string tf_str);
bool ProcessProfile(string profile_name, string replay_symbol, ChartLayoutInfo &out_layouts[]);
ENUM_TIMEFRAMES GetTimeframeFromPeriod(int p_type, int p_size);
ENUM_TIMEFRAMES SecondsToTimeframe(int seconds);
void CleanTempTemplates();
int GetMaxPeriodSeconds(string profile_name);
bool PreloadHistoricalRates(string source_symbol, string replay_symbol, datetime start_time, int max_period_sec);
void PrepareAdditionalSymbol(string sym, datetime start_time, datetime end_time);
void SeekToPosition(int target_index);
bool IsSummerTimeEurope(datetime dt);
bool IsSummerTimeUS(datetime dt);
void ParseTimeStrings(string time_str, int &out_hour, int &out_min);
datetime AddDays(datetime time_val, int days);
datetime GetSessionStartForDate(datetime date_val, string session);
datetime FindPreviousSessionStart(datetime current_time, string session);
datetime FindNextSessionStart(datetime current_time, string session);
int FindTickIndexForward(datetime target_time);
int FindTickIndexBackward(datetime target_time);
void JumpToSessionStart(string session, bool is_advance);
void CalculateSessionBoundaries(string &out_tyo_json, string &out_ldn_json, string &out_ny_json);
void UpdateReplayGeneration();

string FormatCalendarValue(long value, int digits, ENUM_CALENDAR_EVENT_UNIT unit, string currency);
string EscapeJsonString(string str);
bool ExportCalendarHistory(datetime start_time, datetime end_time);

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
   
   // ミリ秒時刻取得のキャリブレーション
   gl_start_time_msc = TimeLocal() * 1000;
   gl_start_tick_count = GetMicrosecondCount() / 1000;
   
   // ミリ秒タイマーの起動
   if(!EventSetMillisecondTimer(InpTimerMs))
   {
      Print("[Error] タイマー設定に失敗しました。");
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
//| Timer function                                                   |
//+------------------------------------------------------------------+
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
      // 経過時間（ミリ秒）の計算
      uint current_real_msc = GetTickCount();
      if(m_last_real_timer_msc == 0)
      {
         m_last_real_timer_msc = current_real_msc;
      }
      else
      {
         uint real_elapsed_msc = current_real_msc - m_last_real_timer_msc;
         m_last_real_timer_msc = current_real_msc;

         int start_idx = m_current_idx;
         int end_idx = m_current_idx;

         //--- 【モードA: 時間比率モード】
         if(m_speed_mode == REPLAY_MODE_TEMPORAL)
         {
            m_virtual_current_msc += (long)(real_elapsed_msc * m_time_multiplier);
            
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
               }
            }
            
            while(end_idx < m_total_ticks && m_all_ticks[end_idx].time_msc <= m_virtual_current_msc)
            {
               end_idx++;
            }
         }
         //--- 【モードB: ティック枚数モード】
         else if(m_speed_mode == REPLAY_MODE_COUNT)
         {
            end_idx = start_idx + m_tick_step_count;
            if(end_idx > m_total_ticks) end_idx = m_total_ticks;
            
            if(end_idx > start_idx)
            {
               m_virtual_current_msc = m_all_ticks[end_idx - 1].time_msc;
            }
         }

         //--- A-Bループ判定: 終了点 B に到達した場合は開始点 A に戻る
         if(m_loop_a_msc != -1 && m_loop_b_msc != -1 && m_virtual_current_msc >= m_loop_b_msc)
         {
            if(m_loop_a_idx >= 0)
            {
               SeekToPosition(m_loop_a_idx);
               m_last_real_timer_msc = GetTickCount(); // シーク後にタイマー基準時間をリセット
            }
         }
         else
         {
            // 抽出されたティックの一括配信
            int count_to_send = end_idx - start_idx;
            if(count_to_send > 0)
            {
               static MqlTick send_array[];
               if(ArrayResize(send_array, count_to_send, 1000) >= 0)
               {
                  if(ArrayCopy(send_array, m_all_ticks, 0, start_idx, count_to_send) >= 0)
                  {
                     int added = CustomTicksAdd(m_replay_symbol, send_array);
                     if(added > 0)
                     {
                        for(int k = 0; k < added; k++) { EvaluatePositionsByTick(send_array[k]); } m_current_idx += added;
                         UpdateChartObjects();
                      }
                     else if(added < 0)
                     {
                        Print("[Warning] CustomTicksAdd failed. Code: ", GetLastError());
                     }
                     
                     static uint last_redraw_time = 0;
                     uint now_time = GetTickCount();
                     if(now_time - last_redraw_time >= 100)
                     {
                        last_redraw_time = now_time;
                        
                        // 各チャートの描画更新 (MTF対応、スクロールはネイティブに委譲)
                        int total_charts = ArraySize(m_viewer_chart_ids);
                        for(int c_idx = 0; c_idx < total_charts; c_idx++)
                        {
                           long cid = m_viewer_chart_ids[c_idx];
                           if(cid > 0)
                              ChartRedraw(cid);
                        }
                     }
                  }
               }
            }
         }
      }
   }
   else if(m_is_playing && m_current_idx >= m_total_ticks)
   {
      m_is_playing = false;
      m_last_real_timer_msc = 0;
      Print("[Info] すべてのリプレイティック配信が完了しました。");
   }
   else if(!m_is_playing)
   {
      // 停止中はタイマーのローカル基準時間をリフレッシュ
      m_last_real_timer_msc = 0;
   }
   
   // 4. 定期的なステータス更新の書き込み (40ms間隔)
   if(m_initialized && m_total_ticks > 0)
   {
      uint now = GetTickCount();
      if(now - m_last_status_write >= 40)
      {
         WriteStatusFile();
         m_last_status_write = now;
      }
   }
}

//+------------------------------------------------------------------+
//| コマンドパイプの監視と処理                                       |
//+------------------------------------------------------------------+
void CheckAndProcessCommand()
{
   if(hCommandPipe == INVALID_HANDLE_VALUE)
      return;

   uint total_bytes_avail = 0;
   if(!PeekNamedPipe(hCommandPipe, 0, 0, 0, total_bytes_avail, 0))
   {
      Print("[Error] Command Pipe Peek 失敗。Code: ", GetLastError());
      ClosePipes();
      return;
   }

   if(total_bytes_avail <= 0)
      return;

   // バッファの確保とデータの読み込み
   uchar buf[];
   ArrayResize(buf, total_bytes_avail);
   uint bytes_read = 0;
   if(!ReadFile(hCommandPipe, buf, total_bytes_avail, bytes_read, 0))
   {
      Print("[Error] Command Pipe 読み取り失敗。Code: ", GetLastError());
      ClosePipes();
      return;
   }

   if(bytes_read <= 0)
      return;

   string new_content = CharArrayToString(buf, 0, (int)bytes_read, CP_UTF8);
   m_accumulated_commands += new_content;

   // 改行コードでコマンドを分割して順次実行
   int next_newline = StringFind(m_accumulated_commands, "\n");
   while(next_newline >= 0)
   {
      string msg = StringSubstr(m_accumulated_commands, 0, next_newline);
      m_accumulated_commands = StringSubstr(m_accumulated_commands, next_newline + 1);

      StringTrimLeft(msg);
      StringTrimRight(msg);
      if(msg != "")
      {
         ProcessCommand(msg);
      }

      next_newline = StringFind(m_accumulated_commands, "\n");
   }
}

//+------------------------------------------------------------------+
//| コマンドプロセッサ                                                |
//+------------------------------------------------------------------+
void ProcessCommand(string line)
{
   string command = GetJsonString(line, "command");
   if(command == "") return;
   
   Print("[Info] コマンド受信: ", line);
   
   if(command == "INIT")
   {
      string source_symbol   = GetJsonString(line, "source_symbol");
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

      string pseudo_rate_val = GetJsonKeyValue(line, "enable_pseudo_rate");
      if(pseudo_rate_val != "")
         m_pseudo_rate_enabled = (pseudo_rate_val == "true" || pseudo_rate_val == "1");
      else
         m_pseudo_rate_enabled = false;

      string base_spread_val = GetJsonKeyValue(line, "pseudo_base_spread");
      if(base_spread_val != "")
         m_domestic_base_spread = StringToDouble(base_spread_val);

      string threshold_val = GetJsonKeyValue(line, "pseudo_threshold");
      if(threshold_val != "")
         m_mt5_threshold = StringToDouble(threshold_val);

      string sensitivity_val = GetJsonKeyValue(line, "pseudo_sensitivity");
      if(sensitivity_val != "")
         m_sensitivity_coeff = StringToDouble(sensitivity_val);
      
      m_source_symbol = (source_symbol != "") ? source_symbol : _Symbol;
      m_replay_symbol = m_source_symbol + "_Replay";
      
      datetime start_time = ParseDateTime(start_time_str);
      datetime end_time   = ParseDateTime(end_time_str);
      
      m_server_start_time = ConvertJSTToServer(start_time);
      m_server_end_time   = ConvertJSTToServer(end_time);
      
      Print("[Info] INITコマンド受信: ", m_source_symbol, " (", start_time_str, " - ", end_time_str, ")");
      
      // 以前の初期化を完全にクリア（再INITに対応）
      if(m_initialized)
      {
         m_is_playing = false;
         m_last_real_timer_msc = 0;
         
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
         
         m_loop_a_msc = -1;
         m_loop_b_msc = -1;
         m_loop_a_idx = -1;
         m_loop_b_idx = -1;
         m_initialized = false;
      }
      
      // カスタムシンボルの作成
      if(!InitializeReplaySymbol(m_replay_symbol, m_source_symbol))
      {
         WriteErrorStatus("カスタムシンボルの初期化に失敗: " + m_replay_symbol);
         return;
      }
      
      // ティックデータのロード
      if(!LoadHistoricalTicks(m_source_symbol, m_server_start_time, m_server_end_time))
      {
         WriteErrorStatus("ティックデータのロードに失敗: " + m_source_symbol);
         return;
      }

      // 同期他通貨シンボルのデータ事前同期
      if(additional_symbols != "")
      {
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
               PrepareAdditionalSymbol(sym, m_server_start_time, m_server_end_time);
            }
         }
      }
      
      // 過去データのプリロード
      int max_period_sec = GetMaxPeriodSeconds(profile_name);
      if(!PreloadHistoricalRates(m_source_symbol, m_replay_symbol, m_server_start_time, max_period_sec))
      {
         WriteErrorStatus("過去データのプリロードに失敗");
         return;
      }
      
      // 初期ティックの書き込み
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
               Print("[Warning] CustomTicksReplace failed. Code: ", GetLastError());
            }
            m_current_idx = 1;
            m_virtual_current_msc = m_all_ticks[0].time_msc;
         }
      }
      
      m_profile_name = profile_name;
      
      // チャート生成
      CreateMTFCharts(m_replay_symbol);
      
      // 経済指標データをエクスポート (サーバー時間基準)
      ExportCalendarHistory(m_server_start_time, m_server_end_time);
      
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
      
      m_last_real_timer_msc = 0; // 基準時間を安全に初期化
   }
   else if(command == "SEEK")
   {
      int target_index = (int)GetJsonDouble(line, "target_index");
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
      m_loop_a_idx = m_current_idx - 1;
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
         m_loop_b_idx = m_current_idx - 1;
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
      m_last_real_timer_msc = 0;
      
      if(m_replay_symbol != "")
      {
         CustomTicksDelete(m_replay_symbol, 0, LONG_MAX);
         CustomRatesDelete(m_replay_symbol, 0, LONG_MAX);
      }
      
      // 取引データの初期化
      ArrayFree(m_virtual_positions);
      ArrayFree(m_virtual_history);
      ClearChartTradeObjects();
      
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
        string pseudo_rate_val = GetJsonKeyValue(line, "enable_pseudo_rate");
        if(pseudo_rate_val != "")
           m_pseudo_rate_enabled = (pseudo_rate_val == "true" || pseudo_rate_val == "1");

        string base_spread_val = GetJsonKeyValue(line, "pseudo_base_spread");
        if(base_spread_val != "")
           m_domestic_base_spread = StringToDouble(base_spread_val);

        string threshold_val = GetJsonKeyValue(line, "pseudo_threshold");
        if(threshold_val != "")
           m_mt5_threshold = StringToDouble(threshold_val);

        string sensitivity_val = GetJsonKeyValue(line, "pseudo_sensitivity");
        if(sensitivity_val != "")
           m_sensitivity_coeff = StringToDouble(sensitivity_val);

        Print(StringFormat("[Info] Pseudo rate updated: Enabled=%s, BaseSpread=%.5f, Threshold=%.5f, Sensitivity=%.2f",
           (m_pseudo_rate_enabled?"ON":"OFF"), m_domestic_base_spread, m_mt5_threshold, m_sensitivity_coeff));

        if(m_total_ticks > 0 && m_current_idx > 0 && m_current_idx <= m_total_ticks)
        {
           EvaluatePositionsByTick(m_all_ticks[m_current_idx - 1]);
        }
        else
        {
           WriteStatusFile();
        }
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
            EvaluatePositionsByTick(m_all_ticks[m_current_idx - 1]);
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
}

//+------------------------------------------------------------------+
//| パイプハンドルのクローズ                                         |
//+------------------------------------------------------------------+
void ClosePipes()
{
   bool was_connected = (hCommandPipe != INVALID_HANDLE_VALUE || hStatusPipe != INVALID_HANDLE_VALUE);
   if(hCommandPipe != INVALID_HANDLE_VALUE)
   {
      CloseHandle(hCommandPipe);
      hCommandPipe = INVALID_HANDLE_VALUE;
   }
   if(hStatusPipe != INVALID_HANDLE_VALUE)
   {
      CloseHandle(hStatusPipe);
      hStatusPipe = INVALID_HANDLE_VALUE;
   }
   if(was_connected)
   {
      UpdateSyncButtonUI();
   }
}

//+------------------------------------------------------------------+
//| パイプへの接続処理                                               |
//+------------------------------------------------------------------+
bool ConnectPipes(bool retry)
{
   ClosePipes(); // 既存の接続があればクローズ

   string cmd_pipe_name = "\\\\.\\pipe\\replay_command";
   string status_pipe_name = "\\\\.\\pipe\\replay_status";

   int attempts = retry ? 10 : 1;
   for(int i = 0; i < attempts; i++)
   {
      hCommandPipe = CreateFileW(cmd_pipe_name, GENERIC_READ, 0, 0, OPEN_EXISTING, 0, 0);
      hStatusPipe = CreateFileW(status_pipe_name, GENERIC_WRITE, 0, 0, OPEN_EXISTING, 0, 0);

      if(hCommandPipe != INVALID_HANDLE_VALUE && hStatusPipe != INVALID_HANDLE_VALUE)
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

      if(hCommandPipe != INVALID_HANDLE_VALUE) { CloseHandle(hCommandPipe); hCommandPipe = INVALID_HANDLE_VALUE; }
      if(hStatusPipe != INVALID_HANDLE_VALUE) { CloseHandle(hStatusPipe); hStatusPipe = INVALID_HANDLE_VALUE; }

      if(retry && i < attempts - 1)
      {
         Print("[Warning] 接続失敗、リトライします (", i + 1, "/10)...");
         Sleep(500);
      }
   }

   return false;
}

//+------------------------------------------------------------------+
//| パイプ接続の確認と再接続                                         |
//+------------------------------------------------------------------+
bool EnsurePipesConnected()
{
   if(!m_sync_enabled)
      return false;

   if(hCommandPipe != INVALID_HANDLE_VALUE && hStatusPipe != INVALID_HANDLE_VALUE)
      return true;

   datetime now = TimeLocal();
   // フリーズ防止のため、再接続の試行は3秒以上の間隔を空ける
   if(now - m_last_connect_attempt < 3)
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
   if(hStatusPipe == INVALID_HANDLE_VALUE)
      return;

   // 改行を追加して送信
   string full_msg = message + "\n";
   uchar buf[];
   int len = StringToCharArray(full_msg, buf, 0, -1, CP_UTF8);
   if(len <= 1) return; // 終端のNULLのみ、または空の場合

   uint bytes_to_write = (uint)len - 1; // 終端NULL文字は書き込まない
   uint bytes_written = 0;

   if(!WriteFile(hStatusPipe, buf, bytes_to_write, bytes_written, 0))
   {
      Print("[Error] Status Pipe 書き込み失敗。Code: ", GetLastError());
      ClosePipes();
   }
}

//+------------------------------------------------------------------+
//| 定期ステータス更新の書き込み                                     |
//+------------------------------------------------------------------+
void WriteStatusFile()
{
   string loop_active_str = (m_loop_a_msc != -1 && m_loop_b_msc != -1) ? "true" : "false";
   int loop_a_idx = m_loop_a_idx;
   int loop_b_idx = m_loop_b_idx;
   
   string speed_mode_str = (m_speed_mode == REPLAY_MODE_TEMPORAL) ? "TEMPORAL" : "COUNT";
   string trade_json = SerializePositionsAndHistoryToJson();
   
   double bid = 0.0;
   double ask = 0.0;
   double spread = 0.0;
   if(m_total_ticks > 0 && m_current_idx > 0 && m_current_idx <= m_total_ticks)
   {
      GetPseudoRates(m_all_ticks[m_current_idx - 1], bid, ask, spread);
   }
   
   string msg = StringFormat(
      "{\"status\":\"ACTIVE\",\"current_idx\":%d,\"total_ticks\":%d,\"virtual_time_msc\":%I64d,\"is_playing\":%s,\"speed_mode\":\"%s\",\"multiplier\":%s,\"tick_step\":%d,\"bid\":%.5f,\"ask\":%.5f,\"loop\":{\"active\":%s,\"a_msc\":%I64d,\"b_msc\":%I64d,\"a_idx\":%d,\"b_idx\":%d},%s}",
      m_current_idx, m_total_ticks, m_virtual_current_msc,
      (m_is_playing ? "true" : "false"),
      speed_mode_str, DoubleToString(m_time_multiplier, 1), m_tick_step_count,
      bid, ask,
      loop_active_str, m_loop_a_msc, m_loop_b_msc, loop_a_idx, loop_b_idx,
      trade_json
   );
   WritePipeStatus(msg);
}

//+------------------------------------------------------------------+
//| READYステータスの書き込み（セッション境界インデックス計算を含む）  |
//+------------------------------------------------------------------+
void WriteReadyStatus()
{
   string tyo_json, ldn_json, ny_json;
   CalculateSessionBoundaries(tyo_json, ldn_json, ny_json);
   
   string speed_mode_str = (m_speed_mode == REPLAY_MODE_TEMPORAL) ? "TEMPORAL" : "COUNT";
   string trade_json = SerializePositionsAndHistoryToJson();
   
   double bid = 0.0;
   double ask = 0.0;
   double spread = 0.0;
   if(m_total_ticks > 0 && m_current_idx > 0 && m_current_idx <= m_total_ticks)
   {
      GetPseudoRates(m_all_ticks[m_current_idx - 1], bid, ask, spread);
   }
   
   string msg = StringFormat(
      "{\"status\":\"READY\",\"total_ticks\":%d,\"current_idx\":%d,\"virtual_time_msc\":%I64d,\"speed_mode\":\"%s\",\"multiplier\":\"%s\",\"tick_step\":%d,\"bid\":%.5f,\"ask\":%.5f,\"session_boundaries\":{\"TYO\":%s,\"LDN\":%s,\"NY\":%s},%s}",
      m_total_ticks, m_current_idx, m_virtual_current_msc,
      speed_mode_str, DoubleToString(m_time_multiplier, 1), m_tick_step_count,
      bid, ask,
      tyo_json, ldn_json, ny_json,
      trade_json
   );
   WritePipeStatus(msg);
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
//| カスタムシンボルの作成・初期化                                   |
//+------------------------------------------------------------------+
bool InitializeReplaySymbol(string replay_symbol, string source_symbol)
{
   bool is_custom = false;
   bool exist = SymbolExist(replay_symbol, is_custom);
   
   if(!exist)
   {
      if(!CustomSymbolCreate(replay_symbol, "Replay", source_symbol))
      {
         Print("[Error] カスタムシンボルの作成に失敗しました。Code: ", GetLastError());
         return false;
      }
   }
   
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
//| 過去ティックデータの読み込み                                     |
//+------------------------------------------------------------------+
bool LoadHistoricalTicks(string source_symbol, datetime start, datetime end)
{
   ulong from_msc = (ulong)start * 1000;
   ulong to_msc   = (ulong)end * 1000;
   
   ArrayFree(m_all_ticks);
   ResetLastError();
   m_total_ticks = CopyTicksRange(source_symbol, m_all_ticks, COPY_TICKS_ALL, from_msc, to_msc);
   
   if(m_total_ticks <= 0)
   {
      Print("[Error] Ticksデータが0件です。Code: ", GetLastError());
      return false;
   }
   
   m_current_idx = 0;
   m_virtual_current_msc = m_all_ticks[0].time_msc;
   Print("[Info] ", source_symbol, " から ", m_total_ticks, " 件のティックデータをメモリにロードしました。");
   return true;
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
//| プロファイル解析とテンプレートのテンポラリ出力                    |
//+------------------------------------------------------------------+
bool ProcessProfile(string profile_name, string replay_symbol, ChartLayoutInfo &out_layouts[])
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
      int file_in = FileOpen(profile_file_path, FILE_READ | FILE_TXT | FILE_UNICODE);
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
         
         if(original_symbol == "" && StringFind(line, "symbol=") == 0)
         {
            original_symbol = StringSubstr(line, 7);
            StringTrimLeft(original_symbol);
            StringTrimRight(original_symbol);
         }
         
         if(period_type == -1 && StringFind(line, "period_type=") == 0)
         {
            period_type = (int)StringToInteger(StringSubstr(line, 12));
         }
         
         if(period_size == -1 && StringFind(line, "period_size=") == 0)
         {
            period_size = (int)StringToInteger(StringSubstr(line, 12));
         }

         if(StringFind(line, "floating=") == 0)
         {
            floating = (int)StringToInteger(StringSubstr(line, 9));
         }
         else if(StringFind(line, "window_left=") == 0)
         {
            win_left = (int)StringToInteger(StringSubstr(line, 12));
         }
         else if(StringFind(line, "window_top=") == 0)
         {
            win_top = (int)StringToInteger(StringSubstr(line, 11));
         }
         else if(StringFind(line, "window_right=") == 0)
         {
            win_right = (int)StringToInteger(StringSubstr(line, 13));
         }
         else if(StringFind(line, "window_bottom=") == 0)
         {
            win_bottom = (int)StringToInteger(StringSubstr(line, 14));
         }
         else if(StringFind(line, "floating_left=") == 0)
         {
            float_left = (int)StringToInteger(StringSubstr(line, 14));
         }
         else if(StringFind(line, "floating_top=") == 0)
         {
            float_top = (int)StringToInteger(StringSubstr(line, 13));
         }
         else if(StringFind(line, "floating_right=") == 0)
         {
            float_right = (int)StringToInteger(StringSubstr(line, 15));
         }
         else if(StringFind(line, "floating_bottom=") == 0)
         {
            float_bottom = (int)StringToInteger(StringSubstr(line, 16));
         }
         else if(StringFind(line, "grid=") == 0)
         {
            show_grid = (int)StringToInteger(StringSubstr(line, 5));
         }
         
         file_content += line + "\r\n";
      }
      FileClose(file_in);
      
      if(original_symbol == "")
      {
         Print("[Warning] シンボルが特定できないためスキップ: ", filename);
         continue;
      }
      
      StringReplace(file_content, original_symbol, replay_symbol);
      
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
      
      ENUM_TIMEFRAMES period = GetTimeframeFromPeriod(period_type, period_size);
      
      chart_count++;
      ArrayResize(out_layouts, chart_count);
      
      out_layouts[chart_count - 1].tpl_path = "\\Files\\replay-chart-temp\\" + temp_tpl_name;
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
//| 歴史データの事前書き込み（プリロード）                            |
//+------------------------------------------------------------------+
bool PreloadHistoricalRates(string source_symbol, string replay_symbol, datetime start_time, int max_period_sec)
{
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
      
      MqlRates temp_rates[];
      ArrayFree(temp_rates);
      int copied_temp = CopyRates(source_symbol, tf, start_time - 1, InpPreloadedBars, temp_rates);
      if(copied_temp > 0)
      {
         datetime min_time = temp_rates[0].time;
         for(int i = 1; i < copied_temp; i++)
         {
            if(temp_rates[i].time < min_time)
            {
               min_time = temp_rates[i].time;
            }
         }
         preload_start = min_time;
         
         // ヒストリー不足時は、不足バー数を単純秒数換算で遡る
         if(copied_temp < InpPreloadedBars)
         {
            int missing_bars = InpPreloadedBars - copied_temp;
            preload_start = preload_start - (PeriodSeconds(tf) * missing_bars);
         }
         Print("[Info] CopyRatesにより算出されたプリロード開始日時: ", TimeToString(preload_start, TIME_DATE|TIME_SECONDS), " (本数: ", copied_temp, "/", InpPreloadedBars, ")");
      }
      else
      {
         int period_sec = PeriodSeconds(tf);
         preload_start = start_time - (period_sec * InpPreloadedBars);
         Print("[Warning] CopyRates取得失敗のため単純秒数で計算したプリロード開始日時: ", TimeToString(preload_start, TIME_DATE|TIME_SECONDS));
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
      Print("[Warning] プリロード歴史M1バーが取得できませんでした。");
      return true;
   }
   
   int updated = CustomRatesUpdate(replay_symbol, preload_rates);
   if(updated < 0)
   {
      Print("[Error] プリロードデータのシンボル適用に失敗。Code: ", GetLastError());
      return false;
   }
   Print("[Info] ", copied, " 件のM1バーを事前描画データとして適用しました。");
   
   //--- 過去ティックデータのプリロードを追加
   datetime tick_preload_start = preload_start;
   if(m_limit_tick_history)
   {
      int history_seconds = m_max_history_bars * PeriodSeconds(m_tick_history_timeframe);
      tick_preload_start = start_time - history_seconds;
      if(tick_preload_start < preload_start)
      {
         tick_preload_start = preload_start;
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
void PrepareAdditionalSymbol(string sym, datetime start_time, datetime end_time)
{
   if(SymbolSelect(sym, true))
   {
      datetime temp[];
      ArrayFree(temp);
      // リプレイ開始時刻の 1000 バー前（M1で約16時間前）から終了時刻までのデータをコピーして、
      // バックグラウンドでのヒストリカルデータロードおよびキャッシュ構築を強制トリガーする
      datetime preload_start = start_time - 1000 * 60;
      int copied = CopyTime(sym, PERIOD_M1, preload_start, end_time, temp);
      if(copied > 0)
      {
         Print("[Info] 他通貨シンボル '", sym, "' の同期を要求しました。取得バー数: ", copied);
      }
      else
      {
         Print("[Warning] 他通貨シンボル '", sym, "' のデータを要求しましたが取得できませんでした（ロード待機中）。");
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
      CustomTicksDelete(m_replay_symbol, 0, LONG_MAX);
      CustomRatesDelete(m_replay_symbol, 0, LONG_MAX);
      
      int max_period_sec = GetMaxPeriodSeconds(m_profile_name);
      PreloadHistoricalRates(m_source_symbol, m_replay_symbol, (datetime)(m_all_ticks[0].time_msc/1000), max_period_sec);
      
      MqlTick init_ticks[];
      if(ArrayResize(init_ticks, 1) >= 0)
      {
         init_ticks[0] = m_all_ticks[0];
         CustomTicksAdd(m_replay_symbol, init_ticks);
      }
      m_current_idx = 1;
      m_virtual_current_msc = (long)m_all_ticks[0].time_msc;
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
      if(target_index != m_current_idx - 1)
      {
         if(m_limit_tick_history)
         {
            datetime target_time = (datetime)(m_all_ticks[target_index].time_msc / 1000);
            int window_seconds = m_max_history_bars * PeriodSeconds(m_tick_history_timeframe);
            datetime cutoff_time = target_time - window_seconds;
            
            // 基準開始時間より前の日付にならないようクランプ
            datetime replay_start_time = (datetime)(m_all_ticks[0].time_msc / 1000);
            if(cutoff_time < replay_start_time)
            {
               cutoff_time = replay_start_time;
            }
            
            // 1. シンボルデータの完全削除
            CustomTicksDelete(m_replay_symbol, 0, LONG_MAX);
            CustomRatesDelete(m_replay_symbol, 0, LONG_MAX);
            
            // 2. 過去バーデータのプリロード
            int max_period_sec = GetMaxPeriodSeconds(m_profile_name);
            PreloadHistoricalRates(m_source_symbol, m_replay_symbol, cutoff_time, max_period_sec);
            
            // 3. cutoff_time 以降のティックを抽出して書き込み
            int start_idx = 0;
            long cutoff_msc = (long)cutoff_time * 1000;
            while(start_idx < target_index && m_all_ticks[start_idx].time_msc < cutoff_msc)
            {
               start_idx++;
            }
            
            int count_to_add = target_index - start_idx + 1;
            if(count_to_add > 0)
            {
               MqlTick add_ticks[];
               if(ArrayResize(add_ticks, count_to_add) >= 0)
               {
                  ArrayCopy(add_ticks, m_all_ticks, 0, start_idx, count_to_add);
                  int added = CustomTicksAdd(m_replay_symbol, add_ticks);
                  if(added < 0)
                  {
                     Print("[Error] CustomTicksAdd 失敗。Code: ", GetLastError());
                  }
               }
            }
         }
         else
         {
            ulong from_msc = m_all_ticks[0].time_msc;
            long delete_start_msc = (long)m_all_ticks[target_index].time_msc + 1;
            
            // 1. 未来のティックデータを削除（巻き戻し、および前進時の重複データ排除）
            int deleted = CustomTicksDelete(m_replay_symbol, delete_start_msc, LONG_MAX);
            if(deleted < 0)
            {
               Print("[Error] CustomTicksDelete 失敗。Code: ", GetLastError());
            }
            
            // 2. 0からtarget_indexまでの全ティックを一括置換（重複を完全に排除）
            int count_to_replace = target_index + 1;
            MqlTick replace_ticks[];
            if(ArrayResize(replace_ticks, count_to_replace) >= 0)
            {
               ArrayCopy(replace_ticks, m_all_ticks, 0, 0, count_to_replace);
               
               int replaced = CustomTicksReplace(m_replay_symbol, from_msc, m_all_ticks[target_index].time_msc, replace_ticks);
               if(replaced < 0)
               {
                  Print("[Error] CustomTicksReplace 失敗。Code: ", GetLastError());
               }
               
               // 3. 未来のバーデータを削除
               datetime delete_start_time = (datetime)(m_all_ticks[target_index].time_msc / 1000) + 1;
               int deleted_rates = CustomRatesDelete(m_replay_symbol, delete_start_time, D'3000.01.01 00:00:00');
               if(deleted_rates < 0)
               {
                  Print("[Error] CustomRatesDelete 失敗。Code: ", GetLastError());
               }
            }
         }
         
         m_current_idx = target_index + 1;
         m_virtual_current_msc = (long)m_all_ticks[target_index].time_msc;
      }
    }
   
   m_last_real_timer_msc = 0; // タイマ基準時間のリセット
   
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
   
   // 各チャートを強制再計算・リフレッシュ
   int total_charts = ArraySize(m_viewer_chart_ids);
   for(int i = 0; i < total_charts; i++)
   {
      long cid = m_viewer_chart_ids[i];
      if(cid > 0)
      {
         ENUM_TIMEFRAMES period = m_viewer_periods[i];
         
         // オートスクロールを一時オフにしてから時間軸を設定しなおす
         ChartSetInteger(cid, CHART_AUTOSCROLL, false);
         ChartSetSymbolPeriod(cid, m_replay_symbol, period);
         
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
//| 複数ビューアーチャートの起動と表示プロパティ設定 (MTF対応)       |
//+------------------------------------------------------------------+
void CreateMTFCharts(string symbol)
{
   bool profile_mode = false;
   ChartLayoutInfo layouts[];
   
   if(m_profile_name != "")
   {
      Print("[Info] プロファイルモードを有効にします。フォルダ名: ", m_profile_name);
      if(ProcessProfile(m_profile_name, symbol, layouts))
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
   while(chart_id >= 0)
   {
      long next_chart_id = ChartNext(chart_id);
      if(ChartSymbol(chart_id) == symbol)
      {
         Print("[Info] 既存のビューアーチャートをクローズします: ID = ", chart_id);
         ChartClose(chart_id);
      }
      chart_id = next_chart_id;
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
      
      // 新規作成
      long cid = ChartOpen(symbol, layouts[i].period);
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
               Print("[Info] テンプレートを適用しました: ", layouts[i].tpl_path);
            }
            
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
         Print("[Info] チャートを開きました: ID = ", cid, ", 時間軸 = ", EnumToString(layouts[i].period));
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
            int file_in = FileOpen(profile_file_path, FILE_READ | FILE_TXT | FILE_UNICODE);
            if(file_in != INVALID_HANDLE)
            {
               int period_type = -1;
               int period_size = -1;
               while(!FileIsEnding(file_in))
               {
                  string line = FileReadString(file_in);
                  if(period_type == -1 && StringFind(line, "period_type=") == 0)
                  {
                     period_type = (int)StringToInteger(StringSubstr(line, 12));
                  }
                  if(period_size == -1 && StringFind(line, "period_size=") == 0)
                  {
                     period_size = (int)StringToInteger(StringSubstr(line, 12));
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
      if(hCommandPipe != INVALID_HANDLE_VALUE && hStatusPipe != INVALID_HANDLE_VALUE)
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
         Print("[Info] 同期処理を開始しました。Tauri アプリの接続を待機します。");
         m_last_connect_attempt = 0; // 次のタイマー判定ですぐ接続を試行
      }
      UpdateSyncButtonUI();
   }
}

//+------------------------------------------------------------------+
//| 経済指標値を文字列にフォーマットする                             |
//+------------------------------------------------------------------+
string FormatCalendarValue(long value, int digits, ENUM_CALENDAR_EVENT_UNIT unit, string currency)
{
   // 未設定や無効値（LONG_MIN, LONG_MAX, 0等）のチェック
   if(value == LONG_MAX || value == LONG_MIN || value == 0) return "-";
   
   double val = (double)value / 1000000.0;
   string unit_str = "";
   switch(unit)
   {
      case CALENDAR_UNIT_PERCENT: unit_str = "%"; break;
      case CALENDAR_UNIT_CURRENCY: unit_str = " " + currency; break;
      default: break;
   }
   return DoubleToString(val, digits) + unit_str;
}

//+------------------------------------------------------------------+
//| JSON文字列用のエスケープ処理                                      |
//+------------------------------------------------------------------+
string EscapeJsonString(string str)
{
   StringReplace(str, "\\", "\\\\");
   StringReplace(str, "\"", "\\\"");
   StringReplace(str, "\n", "\\n");
   StringReplace(str, "\r", "\\r");
   StringReplace(str, "\t", "\\t");
   return str;
}

//+------------------------------------------------------------------+
//| 経済指標履歴の取得とJSON書き出し                                 |
//+------------------------------------------------------------------+
bool ExportCalendarHistory(datetime start_time, datetime end_time)
{
   MqlCalendarValue values[];
   // MQL5の経済指標履歴を取得 (サーバー時間基準)
   int total_values = CalendarValueHistory(values, start_time, end_time);
   if(total_values < 0)
   {
      Print("[Warning] CalendarValueHistory が失敗しました。エラーコード: ", GetLastError());
      return false;
   }
   
   // JSON 文字列の構築
   string json = "[\n";
   int export_count = 0;
   
   for(int i = 0; i < total_values; i++)
   {
      MqlCalendarEvent event;
      if(CalendarEventById(values[i].event_id, event))
      {
         // タイムスタンプをJSTに変換 (フロント表示用)
         datetime event_jst = ConvertServerToJST(values[i].time);
         string time_str = TimeToString(event_jst, TIME_DATE|TIME_SECONDS);
         
         // 通貨の取得 (MqlCalendarCountryから)
         string currency_str = "";
         MqlCalendarCountry country;
         if(CalendarCountryById(event.country_id, country))
         {
            currency_str = country.currency;
         }
         
         // 各値の文字列整形
         string actual_str = FormatCalendarValue(values[i].actual_value, event.digits, event.unit, currency_str);
         string forecast_str = FormatCalendarValue(values[i].forecast_value, event.digits, event.unit, currency_str);
         string prev_str = FormatCalendarValue(values[i].prev_value, event.digits, event.unit, currency_str);
         
         string importance_str = "LOW";
         if(event.importance == CALENDAR_IMPORTANCE_MODERATE) importance_str = "MEDIUM";
         else if(event.importance == CALENDAR_IMPORTANCE_HIGH) importance_str = "HIGH";
         
         // JSONオブジェクトの作成
         string item_json = StringFormat(
            "  {\n"
            "    \"id\": %d,\n"
            "    \"time\": \"%s\",\n"
            "    \"currency\": \"%s\",\n"
            "    \"event\": \"%s\",\n"
            "    \"importance\": \"%s\",\n"
            "    \"actual\": \"%s\",\n"
            "    \"forecast\": \"%s\",\n"
            "    \"previous\": \"%s\"\n"
            "  }",
            values[i].id, time_str, currency_str, EscapeJsonString(event.name),
            importance_str, actual_str, forecast_str, prev_str
         );
         
         if(export_count > 0) json += ",\n";
         json += item_json;
         export_count++;
      }
   }
   json += "\n]";
   
   // ファイル書き出し (FILE_ANSI と CP_UTF8 を指定して UTF-8 で出力)
   int file_handle = FileOpen("replay_news.json", FILE_WRITE|FILE_TXT|FILE_ANSI, 0, CP_UTF8);
   if(file_handle != INVALID_HANDLE)
   {
      FileWriteString(file_handle, json);
      FileClose(file_handle);
      Print("[Info] replay_news.json のエクスポートが完了しました。件数: ", export_count);
      return true;
   }
   else
   {
      Print("[Error] replay_news.json の書き込みに失敗しました。エラーコード: ", GetLastError());
      return false;
   }
}

//+------------------------------------------------------------------+
//| リプレイのタイムライン世代（TR_Gen）を更新                       |
//+------------------------------------------------------------------+
void UpdateReplayGeneration()
{
   if(m_replay_symbol != "")
   {
      string var_name = "TR_Gen_" + m_replay_symbol;
      GlobalVariableSet(var_name, (double)GetTickCount64());
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
   GetPseudoRates(m_all_ticks[m_current_idx - 1], bid, ask, spread);
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
            
            VirtualOrderCloseEx(ticket_to_close, close_vol, "SETTLEMENT", settle_price, m_virtual_current_msc);
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
   MqlTick tick;
   tick.bid = bid;
   tick.ask = ask;
   tick.time_msc = m_virtual_current_msc;
   EvaluatePositionsByTick(tick);
   
   // 即座にステータスを書き出し
   WriteStatusFile();
}

//+------------------------------------------------------------------+
//| 仮想ポジション決済                                               |
//+------------------------------------------------------------------+
void VirtualOrderClose(int ticket, double volume, string reason)
{
   if(!m_initialized || m_total_ticks <= 0 || m_current_idx <= 0) return;
   
   double bid = 0.0;
   double ask = 0.0;
   double spread = 0.0;
   GetPseudoRates(m_all_ticks[m_current_idx - 1], bid, ask, spread);
   if(bid <= 0) bid = m_all_ticks[m_current_idx - 1].last;
   if(ask <= 0) ask = m_all_ticks[m_current_idx - 1].last;
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
      VirtualOrderCloseEx(ticket, volume, reason, close_price, m_virtual_current_msc);
   }
}

//+------------------------------------------------------------------+
//| 仮想ポジション決済 (価格指定内部用)                              |
//+------------------------------------------------------------------+
void VirtualOrderCloseEx(int ticket, double volume, string reason, double closePrice, long closeTimeMsc)
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
   
   // 他ポジション含めた口座ステータス更新
   MqlTick dummy;
   dummy.bid = closePrice;
   dummy.ask = closePrice;
   dummy.time_msc = closeTimeMsc;
   EvaluatePositionsByTick(dummy);
   
   // 即座にステータス書き出し
   WriteStatusFile();
}

//+------------------------------------------------------------------+
//| 全ポジションの一括決済                                           |
//+------------------------------------------------------------------+
void VirtualOrderCloseAll(string reason)
{
   int pos_size = ArraySize(m_virtual_positions);
   for(int i = pos_size - 1; i >= 0; i--)
   {
      VirtualOrderClose(m_virtual_positions[i].ticket, m_virtual_positions[i].volume, reason);
   }
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
         VirtualOrderClose(m_virtual_positions[i].ticket, m_virtual_positions[i].volume, reason);
      }
   }
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
         VirtualOrderClose(m_virtual_positions[i].ticket, m_virtual_positions[i].volume, reason);
      }
   }
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
void EvaluatePositionsByTick(MqlTick &tick)
{
   double bid = 0.0;
   double ask = 0.0;
   double spread = 0.0;
   GetPseudoRates(tick, bid, ask, spread);

   int pos_size = ArraySize(m_virtual_positions);
   
   // 1. 各ポジションの含み損益計算およびSL/TP到達チェック
   for(int i = pos_size - 1; i >= 0; i--)
   {
      double current_price = (m_virtual_positions[i].type == POSITION_TYPE_BUY) ? bid : ask;
      m_virtual_positions[i].current_price = current_price;
      
      // 含み損益更新
      m_virtual_positions[i].profit = CalculateVirtualProfit(
         m_replay_symbol, 
         m_virtual_positions[i].type, 
         m_virtual_positions[i].volume, 
         m_virtual_positions[i].open_price, 
         current_price
      );
      
      // MFE / MAE の更新 (pips単位)
      double one_pip = (StringFind(m_replay_symbol, "JPY") >= 0) ? 0.01 : 0.0001;
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
            VirtualOrderCloseEx(m_virtual_positions[i].ticket, m_virtual_positions[i].volume, "SL", m_virtual_positions[i].sl, tick.time_msc);
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
            VirtualOrderCloseEx(m_virtual_positions[i].ticket, m_virtual_positions[i].volume, "TP", m_virtual_positions[i].tp, tick.time_msc);
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
   
   Print(StringFormat("[Info] Virtual Account Reset. Balance: %.2f JPY, Leverage: %.1fx", initial_balance, leverage));
   WriteStatusFile();
}

//+------------------------------------------------------------------+
//| 取引情報および履歴情報のJSONシリアライズ                         |
//+------------------------------------------------------------------+
string SerializePositionsAndHistoryToJson()
{
   string json = "";
   
   // 口座残高
   json += StringFormat("\"account\":{\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"free_margin\":%.2f,\"margin_level\":%.2f,\"total_profit\":%.2f,\"leverage\":%.2f}",
      m_account_balance, m_account_equity, m_account_margin, m_account_free_margin, m_account_margin_level, (m_account_equity - m_account_balance), m_account_leverage);
   
   // 保有ポジション配列のシリアライズ
   json += ",\"positions\":[";
   int pos_size = ArraySize(m_virtual_positions);
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
   
   // 取引履歴配列のシリアライズ
   json += ",\"history\":[";
   int hist_size = ArraySize(m_virtual_history);
   for(int i = 0; i < hist_size; i++)
   {
      if(i > 0) json += ",";
      string type_str = (m_virtual_history[i].type == POSITION_TYPE_BUY) ? "BUY" : "SELL";
      json += StringFormat("{\"ticket\":%d,\"type\":\"%s\",\"volume\":%.2f,\"open_price\":%.5f,\"open_time\":\"%s\",\"open_time_msc\":%I64d,\"close_price\":%.5f,\"close_time\":\"%s\",\"close_time_msc\":%I64d,\"sl\":%.5f,\"tp\":%.5f,\"profit\":%.2f,\"close_reason\":\"%s\",\"mfe_pips\":%.2f,\"mae_pips\":%.2f,\"spread_entry\":%.2f,\"volatility\":%.2f,\"volume_60s\":%I64u}",
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
   json += "]";
   
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
   MqlTick last_tick;
   if(m_current_idx > 0 && m_current_idx <= m_total_ticks)
   {
      last_tick = m_all_ticks[m_current_idx - 1];
   }
   else
   {
      last_tick = m_all_ticks[0];
   }
   EvaluatePositionsByTick(last_tick);
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
//| 疑似レートとスプレッドを取得するヘルパー関数                          |
//+------------------------------------------------------------------+
void GetPseudoRates(MqlTick &src_tick, double &out_bid, double &out_ask, double &out_spread)
{
   // 疑似レート生成が無効な場合は元のレートをそのまま返す
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

   // レートが取得できない、またはダミータックの場合は処理をバイパスする
   if(bid <= 0 || ask <= 0 || bid == ask)
   {
      out_bid = bid;
      out_ask = ask;
      out_spread = out_ask - out_bid;
      return;
   }

   string sym = (m_source_symbol != "") ? m_source_symbol : _Symbol;
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   if(digits <= 0) digits = _Digits;

   double mt5_spread = ask - bid;
   double mid = (bid + ask) / 2.0;

   // 目標スプレッドの計算
   double target_spread = 0.0;
   if(mt5_spread <= m_mt5_threshold)
   {
      target_spread = m_domestic_base_spread;
   }
   else
   {
      target_spread = m_domestic_base_spread + m_sensitivity_coeff * (mt5_spread - m_mt5_threshold);
   }

   double half_spread = target_spread / 2.0;
   double bid_raw = mid - half_spread;
   double ask_raw = mid + half_spread;

   // 厳密な四捨五入による丸め処理
   out_bid = RoundHalfUp(bid_raw, digits);
   out_ask = RoundHalfUp(ask_raw, digits);
   out_spread = out_ask - out_bid;
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