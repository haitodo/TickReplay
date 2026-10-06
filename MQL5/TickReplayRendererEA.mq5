//+------------------------------------------------------------------+
//|                                       TickReplayRendererEA.mq5   |
//|                                  Copyright 2026, Google DeepMind |
//|                                           https://deepmind.google |
//|                      (Replay Core v2 専用・描画特化レンダラーEA)     |
//+------------------------------------------------------------------+
#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property version   "4.00"
#property strict

//--- Win32 API Named Pipe インポート
#import "kernel32.dll"
long CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, long lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, long hTemplateFile);
int WriteFile(long hFile, uchar &lpBuffer[], uint nNumberOfBytesToWrite, uint &lpNumberOfBytesWritten, long lpOverlapped);
int ReadFile(long hFile, uchar &lpBuffer[], uint nNumberOfBytesToRead, uint &lpNumberOfBytesRead, long lpOverlapped);
int PeekNamedPipe(long hNamedPipe, long lpBuffer, uint nBufferSize, long lpBytesRead, uint &lpTotalBytesAvail, long lpBytesLeftThisMessage);
int WaitNamedPipeW(string lpNamedPipeName, uint nTimeOut);
int CloseHandle(long hObject);
#import

//--- Win32 API winmm (高精度マルチメディアタイマー制御)
#import "winmm.dll"
uint timeBeginPeriod(uint uPeriod);
uint timeEndPeriod(uint uPeriod);
#import

//--- Win32 API User32 (ウィンドウ配置制御)
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

//--- プロトコル定数 (render_pipe.rs と 100% 一致)
#define RENDER_MAGIC          0x54525232 // 'TRR2'
#define MSG_HELLO             0x0001
#define MSG_ADVANCE           0x0002
#define MSG_RESET             0x0003
#define MSG_ACK               0x0004
#define MSG_READY             0x0005
#define MSG_APPLY_PROFILE     0x0006
#define MSG_INIT              0x0007
#define MSG_IMPORT_TICKS      0x0008
#define MSG_TERMINATE         0x0009

#define HEADER_SIZE                16
#define HELLO_PAYLOAD_SIZE         72
#define ADVANCE_PAYLOAD_SIZE       24
#define RESET_PAYLOAD_SIZE         48
#define ACK_PAYLOAD_SIZE           24
#define APPLY_PROFILE_PAYLOAD_SIZE 128
#define INIT_PAYLOAD_SIZE          192
#define IMPORT_TICKS_PAYLOAD_SIZE  224

//--- 自然アライメント構造体定義 (pack 境界なし)
struct RenderHeader
{
    uint   magic;        // 4 bytes: 0x54525232 ('TRR2')
    ushort msg_type;     // 2 bytes: コマンド種別
    ushort flags;        // 2 bytes: フラグ
    uint   epoch;        // 4 bytes: シーク世代エポック
    uint   payload_len;  // 4 bytes: ペイロード長
};

struct HelloPayload
{
    uint   ea_version;   // 4 bytes: 400
    uint   reserved;     // 4 bytes
    ulong  main_ticks;   // 8 bytes: ロード済み総ティック数
    ulong  main_hash;    // 8 bytes
    ulong  sub_ticks;    // 8 bytes
    ulong  sub_hash;     // 8 bytes
    uchar  symbol[32];   // 32 bytes: シンボル名
};

struct AdvancePayload
{
    ulong main_idx;          // 8 bytes: 描画到達インデックス
    ulong sub_idx;           // 8 bytes: サブシンボル描画到達インデックス
    long  virtual_time_msc;  // 8 bytes: 現在の仮想時刻 (ミリ秒)
};

struct ResetPayload
{
    ulong main_target_idx;   // 8 bytes: シーク先インデックス
    ulong main_preload_from; // 8 bytes: プリロード開始インデックス
    ulong sub_target_idx;    // 8 bytes
    ulong sub_preload_from;  // 8 bytes
    long  virtual_time_msc;  // 8 bytes: シーク先仮想時刻 (ミリ秒)
    long  reserved;          // 8 bytes: 予約
};

struct AckPayload
{
    ulong main_applied_idx;   // 8 bytes: 実際に描画適用されたインデックス
    ulong sub_applied_idx;    // 8 bytes
    uint  render_duration_us; // 4 bytes: 描画所要時間 (μs)
    uint  reserved;           // 4 bytes
};

struct ApplyProfilePayload
{
    uchar profile_name[64];  // 64 bytes
    uchar main_symbol[32];   // 32 bytes
    uchar sub_symbol[32];    // 32 bytes
};

struct InitPayload
{
    long  start_time_msc;    // 8 bytes: リプレイ開始日時 (ミリ秒)
    long  end_time_msc;      // 8 bytes: リプレイ終了日時 (ミリ秒)
    long  preload_date_msc;  // 8 bytes: 過去足プリロード基準日 (ミリ秒)
    uint  preloaded_bars;    // 4 bytes: 過去足プリロード本数
    uint  preload_mode;      // 4 bytes: 0 = BARS, 1 = DATE
    uchar source_symbol[32]; // 32 bytes: ソースシンボル名
    uchar sub_symbol[32];    // 32 bytes: サブシンボル名
    uchar profile_name[64];  // 64 bytes: 適用プロファイル名
    uchar reserved[32];      // 32 bytes: 予約
};

struct ImportTicksPayload
{
    uchar symbol[32];        // 32 bytes: シンボル名
    uchar group[32];         // 32 bytes: グループ名
    uchar base_symbol[32];   // 32 bytes: 原銘柄名
    uchar bin_file[128];     // 128 bytes: .bin ファイル相対パス
};

struct ChartLayoutInfo
{
    string             tpl_path;
    string             target_symbol;
    ENUM_TIMEFRAMES    period;
    int                floating;
    int                win_left;
    int                win_top;
    int                win_right;
    int                win_bottom;
    int                float_left;
    int                float_top;
    int                float_right;
    int                float_bottom;
    bool               show_grid;
};

//--- Input パラメータ
input string InpPipeName = "\\\\.\\pipe\\tick_replay_render"; // Core レンダリングパイプ名
input int    InpTimerMs  = 2;                                // パイプ監視周期 (ミリ秒: 2ms = 500Hz)

//--- 状態変数
long     m_hPipe = INVALID_HANDLE_VALUE;
string   m_replay_symbol = "";
string   m_source_symbol = "";
MqlTick  m_all_ticks[];
int      m_total_ticks = 0;
int      m_current_idx = -1;
uint     m_current_epoch = 1;

// サブ比較銘柄
bool     m_enable_dual_feed = false;
string   m_replay_symbol_sub = "";
string   m_source_symbol_sub = "";
MqlTick  m_all_ticks_sub[];
int      m_total_ticks_sub = 0;
int      m_current_idx_sub = -1;

ulong    m_last_redraw_us = 0;
const ulong REDRAW_INTERVAL_US = 16666; // 最大 60FPS にチャート再描画を間引き

// ビューアーチャート管理
long     m_viewer_chart_ids[];
int      m_pending_reset_redraw_count = 0; // 時間遷移後の末尾スクロール追跡カウンタ

//--- 前方宣言
bool ConnectPipe();
void SendHello();
void SendAck(ulong main_applied, ulong sub_applied, uint duration_us);
void SendReady();
int  BuildM1RatesFromTicks(const MqlTick &ticks[], int from_idx, int to_idx, string symbol_for_point, MqlRates &rates_out[]);
void ProcessInit(const InitPayload &p);
void ProcessAdvance(const AdvancePayload &adv, ulong start_us);
void ProcessReset(const ResetPayload &rst);
void ProcessApplyProfile(const ApplyProfilePayload &p);
void ProcessImportTicks(const ImportTicksPayload &p);
void RedrawAllViewerCharts(bool force = false);
void CleanTempTemplates();
void CloseAllReplayCharts();

//+------------------------------------------------------------------+
//| 厳密な四捨五入（ハーフアップ）を行うヘルパー関数                     |
//+------------------------------------------------------------------+
double RoundHalfUp(double value, int digits)
{
    double multiplier = MathPow(10.0, digits);
    return MathRound(value * multiplier + 1e-9) / multiplier;
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
    return "USDJPY";
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
//| 指定時間足で指定バー数分過去の実取引バー開始日時を取得            |
//+------------------------------------------------------------------+
datetime GetBarHistoryStartTime(string symbol, ENUM_TIMEFRAMES tf, datetime ref_time, int bar_count)
{
    if(bar_count <= 0) return ref_time;

    MqlRates rates[];
    ArrayFree(rates);
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
        return min_time;
    }

    int sec_per_bar = PeriodSeconds(tf);
    return ref_time - (datetime)(bar_count * sec_per_bar * 1.5);
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
//| すべてのリプレイ用ビューアーチャートを安全にクローズする             |
//+------------------------------------------------------------------+
void CloseAllReplayCharts()
{
    long current_cid = ChartID();
    int closed_count = 0;

    // 1. m_viewer_chart_ids に登録されているチャートをクローズ
    int total_viewers = ArraySize(m_viewer_chart_ids);
    for(int i = 0; i < total_viewers; i++)
    {
        long cid = m_viewer_chart_ids[i];
        if(cid > 0 && cid != current_cid)
        {
            if(ChartClose(cid))
            {
                closed_count++;
            }
            m_viewer_chart_ids[i] = 0;
        }
    }
    ArrayFree(m_viewer_chart_ids);

    // 2. 防御策: MT5 内のすべてのチャートを走査し、_Replay シンボルチャートを確実にクローズ（EAホストチャートは絶対に除外）
    long chart_id = ChartFirst();
    while(chart_id >= 0)
    {
        long next_chart_id = ChartNext(chart_id);
        if(chart_id != current_cid)
        {
            string csym = ChartSymbol(chart_id);
            if(StringFind(csym, "_Replay") >= 0)
            {
                PrintFormat("[RendererEA] 残存リプレイチャートをクローズ: ID=%I64d (%s)", chart_id, csym);
                if(ChartClose(chart_id))
                {
                    closed_count++;
                }
            }
        }
        chart_id = next_chart_id;
    }

    // 3. 一時テンプレートとフォルダの削除
    CleanTempTemplates();

    // 4. メモリ・再生状態・シンボルのリセット
    m_current_idx = -1;
    m_current_idx_sub = -1;
    m_total_ticks = 0;
    m_total_ticks_sub = 0;
    m_replay_symbol = "";
    m_replay_symbol_sub = "";
    ArrayFree(m_all_ticks);
    ArrayFree(m_all_ticks_sub);

    if(closed_count > 0)
    {
        PrintFormat("[RendererEA] リプレイチャート全クローズ完了 (計 %d チャート閉鎖)", closed_count);
    }
}

//+------------------------------------------------------------------+
//| 仮想ミリ秒時刻に対応するティック配列内の最大インデックスを二分探索  |
//+------------------------------------------------------------------+
int FindTickIndexByMsc(const MqlTick &ticks[], int total, long target_msc)
{
    if (total <= 0) return -1;
    if (target_msc <= ticks[0].time_msc) return 0;
    if (target_msc >= ticks[total - 1].time_msc) return total - 1;

    int left = 0;
    int right = total - 1;
    int ans = 0;

    while (left <= right)
    {
        int mid = left + (right - left) / 2;
        if (ticks[mid].time_msc <= target_msc)
        {
            ans = mid;
            left = mid + 1;
        }
        else
        {
            right = mid - 1;
        }
    }
    return ans;
}

//+------------------------------------------------------------------+
//| ティック配列からM1バー配列を高速生成するヘルパー関数                   |
//+------------------------------------------------------------------+
int BuildM1RatesFromTicks(const MqlTick &ticks[], int from_idx, int to_idx, string symbol_for_point, MqlRates &rates_out[])
{
    if(from_idx > to_idx || from_idx < 0 || to_idx >= ArraySize(ticks))
        return 0;

    int tick_count = to_idx - from_idx + 1;
    if(tick_count <= 0) return 0;

    datetime t_first = (datetime)(ticks[from_idx].time_msc / 1000);
    datetime t_last  = (datetime)(ticks[to_idx].time_msc / 1000);
    int estimated_bars = (int)((t_last - t_first) / 60) + 10;
    if(estimated_bars < 1) estimated_bars = 1;

    ArrayResize(rates_out, estimated_bars);
    int bar_count = 0;
    datetime current_bar_time = 0;
    double pt = SymbolInfoDouble(symbol_for_point, SYMBOL_POINT);
    if(pt <= 0.0) pt = 0.001;

    for(int i = from_idx; i <= to_idx; i++)
    {
        datetime t = (datetime)(ticks[i].time_msc / 1000);
        datetime bar_time = t - (t % 60); // 1分足の境界 (秒)
        double price = ticks[i].bid;
        if(price <= 0.0) price = ticks[i].last;
        if(price <= 0.0) price = ticks[i].ask;
        if(price <= 0.0) continue;

        if(bar_count == 0 || bar_time != current_bar_time)
        {
            if(bar_count >= ArraySize(rates_out))
            {
                ArrayResize(rates_out, bar_count + 500);
            }
            bar_count++;
            rates_out[bar_count - 1].time = bar_time;
            rates_out[bar_count - 1].open = price;
            rates_out[bar_count - 1].high = price;
            rates_out[bar_count - 1].low = price;
            rates_out[bar_count - 1].close = price;
            rates_out[bar_count - 1].tick_volume = 1;
            rates_out[bar_count - 1].spread = (ticks[i].ask > ticks[i].bid) ? (int)MathRound((ticks[i].ask - ticks[i].bid) / pt) : 20;
            rates_out[bar_count - 1].real_volume = 0;
            current_bar_time = bar_time;
        }
        else
        {
            if(price > rates_out[bar_count - 1].high) rates_out[bar_count - 1].high = price;
            if(price < rates_out[bar_count - 1].low)  rates_out[bar_count - 1].low = price;
            rates_out[bar_count - 1].close = price;
            rates_out[bar_count - 1].tick_volume++;
        }
    }

    ArrayResize(rates_out, bar_count);
    return bar_count;
}

//+------------------------------------------------------------------+
//| M1バーから4つのティック (Open, Low/High, High/Low, Close) を生成 |
//+------------------------------------------------------------------+
int GenerateTicksFromRates(string symbol, const MqlRates &rates[], MqlTick &out_ticks[])
{
    int rates_count = ArraySize(rates);
    if(rates_count <= 0) return 0;

    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    if(digits <= 0) digits = 5;

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

        double p0 = r.open;
        double p1 = (r.close >= r.open) ? r.low  : r.high;
        double p2 = (r.close >= r.open) ? r.high : r.low;
        double p3 = r.close;

        for(int k = 0; k < ticks_in_bar; k++)
        {
            double ratio = (ticks_in_bar > 1) ? ((double)k / (double)(ticks_in_bar - 1)) : 0.0;
            long offset_msc = (long)(ratio * 58000.0);

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
//| 過去ティックデータの汎用読み込み関数                             |
//+------------------------------------------------------------------+
bool LoadHistoricalTicksEx(string source_symbol, datetime start, datetime end, MqlTick &out_ticks[], int &out_total)
{
    ulong from_msc = (start > 0) ? ((ulong)start * 1000) : 0;
    ulong to_msc   = (end > start && end > 0) ? ((ulong)end * 1000) : 0;

    SymbolSelect(source_symbol, true);
    ArrayFree(out_ticks);
    out_total = 0;

    int retries = 0;
    while(retries < 10)
    {
        ResetLastError();
        out_total = CopyTicksRange(source_symbol, out_ticks, COPY_TICKS_ALL, from_msc, to_msc);
        if(out_total > 0) break;
        Sleep(250);
        retries++;
    }

    // 指定範囲で0件だった場合、全期間コピーをフォールバック試行
    if(out_total <= 0 && from_msc > 0)
    {
        PrintFormat("[RendererEA] [Info] 指定範囲でのティック0件のため、全期間コピーをフォールバック試行: %s", source_symbol);
        out_total = CopyTicksRange(source_symbol, out_ticks, COPY_TICKS_ALL, 0, 0);
    }

    if(out_total <= 0)
    {
        PrintFormat("[RendererEA] [Info] 生ティック0件のため、M1バーからの疑似ティック生成を試行: %s", source_symbol);
        MqlRates rates[];
        ArrayFree(rates);
        datetime stop_dt = (end > start && end > 0) ? end : D'3000.01.01 00:00:00';
        int copied_rates = CopyRates(source_symbol, PERIOD_M1, start, stop_dt, rates);
        if(copied_rates <= 0)
        {
            copied_rates = CopyRates(source_symbol, PERIOD_M1, 0, 50000, rates);
        }
        if(copied_rates > 0)
        {
            out_total = GenerateTicksFromRates(source_symbol, rates, out_ticks);
            PrintFormat("[RendererEA] M1バー %d 件から %d 件の疑似ティックを生成しました", copied_rates, out_total);
        }
        else
        {
            PrintFormat("[RendererEA] [Warning] M1バーの取得にも失敗しました: Code=%d", GetLastError());
        }
    }

    if(out_total <= 0)
    {
        PrintFormat("[RendererEA] [Error] ティックデータが0件です: %s (Code: %d)", source_symbol, GetLastError());
        return false;
    }

    PrintFormat("[RendererEA] %s から %d 件のティックデータをロード完了", source_symbol, out_total);
    return true;
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
            PrintFormat("[RendererEA] [Warning] source_symbol ('%s') での CustomSymbolCreate 失敗 (Code: %d)。ベース銘柄で試行します。", source_symbol, err);

            string base_symbol = ExtractBaseSymbol(source_symbol);
            if(SymbolExist(base_symbol, is_custom))
            {
                created = CustomSymbolCreate(replay_symbol, "Replay", base_symbol);
            }

            if(!created)
            {
                PrintFormat("[RendererEA] [Warning] ベース銘柄 ('%s') での CustomSymbolCreate 失敗。原銘柄なしで試行します。", base_symbol);
                created = CustomSymbolCreate(replay_symbol, "Replay", "");
            }

            if(!created)
            {
                PrintFormat("[RendererEA] [Error] カスタムシンボルの作成に失敗しました: %s (Code: %d)", replay_symbol, GetLastError());
                return false;
            }
        }
    }

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
        PrintFormat("[RendererEA] [Error] カスタムシンボルの気配値登録に失敗: %s (Code: %d)", replay_symbol, GetLastError());
        return false;
    }

    ResetLastError();
    CustomTicksDelete(replay_symbol, 0, LONG_MAX);
    CustomRatesDelete(replay_symbol, 0, LONG_MAX);

    PrintFormat("[RendererEA] カスタムシンボル初期化完了: %s (原銘柄=%s, digits=%d, point=%g)",
        replay_symbol, source_symbol, (int)digits, point);
    return true;
}

//+------------------------------------------------------------------+
//| 過去足プリロード (バー数または日付指定)                            |
//+------------------------------------------------------------------+
bool PreloadHistoricalRatesEx(string source_symbol, string replay_symbol, datetime start_time, int max_period_sec, uint preload_mode, long preload_date_msc, uint preloaded_bars)
{
    SymbolSelect(source_symbol, true);
    datetime preload_start = 0;
    datetime preload_end = start_time - 1;

    if(preload_mode == 1) // DATE モード
    {
        if(preload_date_msc > 0)
        {
            preload_start = (datetime)(preload_date_msc / 1000);
        }
    }

    if(preload_start <= 0 || preload_mode == 0) // BARS モードまたはフォールバック
    {
        ENUM_TIMEFRAMES tf = SecondsToTimeframe(max_period_sec);
        int bars = (preloaded_bars > 0) ? (int)preloaded_bars : 300;
        preload_start = GetBarHistoryStartTime(source_symbol, tf, start_time, bars);
    }

    if(preload_start >= start_time)
    {
        PrintFormat("[RendererEA] プリロード対象期間なし (開始=%s, リプレイ開始=%s)",
            TimeToString(preload_start), TimeToString(start_time));
        return true;
    }

    PrintFormat("[RendererEA] 過去データプリロード取得: %s -> %s (%s 〜 %s)",
        source_symbol, replay_symbol, TimeToString(preload_start), TimeToString(preload_end));

    MqlRates preload_rates[];
    ArrayFree(preload_rates);

    int copied = CopyRates(source_symbol, PERIOD_M1, preload_start, preload_end, preload_rates);
    if(copied <= 0)
    {
        PrintFormat("[RendererEA] [Warning] CopyRatesでのM1バー取得失敗 (Code: %d)。メモリ内ティックからの生成を試行。", GetLastError());
        bool is_sub = (m_enable_dual_feed && source_symbol == m_source_symbol_sub);
        int src_tick_count = is_sub ? m_total_ticks_sub : m_total_ticks;
        if(src_tick_count > 0)
        {
            int sample_count = MathMin(src_tick_count, 100000);
            MqlRates generated[];
            ArrayResize(generated, sample_count);
            int gen_count = 0;
            datetime last_bar_time = 0;
            for(int i = 0; i < sample_count; i++)
            {
                datetime t = is_sub ? (datetime)(m_all_ticks_sub[i].time_msc / 1000) : (datetime)(m_all_ticks[i].time_msc / 1000);
                datetime bar_time = t - (t % 60);
                double bid = is_sub ? m_all_ticks_sub[i].bid : m_all_ticks[i].bid;
                if(gen_count == 0 || bar_time != last_bar_time)
                {
                    if(gen_count >= 3000) break;
                    gen_count++;
                    generated[gen_count - 1].time = bar_time;
                    generated[gen_count - 1].open = bid;
                    generated[gen_count - 1].high = bid;
                    generated[gen_count - 1].low = bid;
                    generated[gen_count - 1].close = bid;
                    generated[gen_count - 1].tick_volume = 1;
                    generated[gen_count - 1].spread = 20;
                    last_bar_time = bar_time;
                }
                else
                {
                    if(bid > generated[gen_count - 1].high) generated[gen_count - 1].high = bid;
                    if(bid < generated[gen_count - 1].low) generated[gen_count - 1].low = bid;
                    generated[gen_count - 1].close = bid;
                    generated[gen_count - 1].tick_volume++;
                }
            }
            if(gen_count > 0)
            {
                ArrayResize(generated, gen_count);
                CustomRatesUpdate(replay_symbol, generated);
                PrintFormat("[RendererEA] メモリ内ティックから %d 件のM1バーを代替プリロードしました: %s", gen_count, replay_symbol);
            }
        }
        return true;
    }

    int updated = CustomRatesUpdate(replay_symbol, preload_rates);
    if(updated < 0)
    {
        PrintFormat("[RendererEA] [Error] プリロードデータのシンボル適用に失敗: Code=%d", GetLastError());
        return false;
    }

    PrintFormat("[RendererEA] %s: %d 件のM1バーを事前描画データとして正常登録しました", replay_symbol, copied);
    return true;
}

//+------------------------------------------------------------------+
//| 全ビューアーチャートの再描画 (最大60FPSスロットル)                |
//+------------------------------------------------------------------+
void RedrawAllViewerCharts(bool force = false)
{
    ulong now_us = GetMicrosecondCount();
    if(!force && (now_us - m_last_redraw_us < REDRAW_INTERVAL_US))
        return;

    m_last_redraw_us = now_us;

    ChartRedraw(0);

    int total_viewers = ArraySize(m_viewer_chart_ids);
    for(int i = 0; i < total_viewers; i++)
    {
        if(m_viewer_chart_ids[i] > 0)
        {
            if(force)
            {
                ChartSetInteger(m_viewer_chart_ids[i], CHART_AUTOSCROLL, true);
                ChartNavigate(m_viewer_chart_ids[i], CHART_END, 0);
            }
            ChartRedraw(m_viewer_chart_ids[i]);
        }
    }
}

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

    if(b0 == 0xFF && b1 == 0xFE)
    {
        return FileOpen(profile_file_path, FILE_READ | FILE_TXT | FILE_UNICODE);
    }
    if(b0 == 0xEF && b1 == 0xBB && b2 == 0xBF)
    {
        return FileOpen(profile_file_path, FILE_READ | FILE_TXT | FILE_ANSI);
    }
    if(b1 == 0x00 && b0 != 0x00 && fsize >= 4)
    {
        return FileOpen(profile_file_path, FILE_READ | FILE_TXT | FILE_UNICODE);
    }
    return FileOpen(profile_file_path, FILE_READ | FILE_TXT | FILE_ANSI);
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
//| プロファイル内の最大時間枠秒数を取得                             |
//+------------------------------------------------------------------+
int GetMaxPeriodSeconds(string profile_name)
{
    int max_sec = 60;
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
//| プロファイル解析とテンプレート一時出力                           |
//+------------------------------------------------------------------+
bool ProcessProfile(string profile_name, string main_symbol, string sub_symbol, bool enable_dual, ChartLayoutInfo &out_layouts[])
{
    ArrayFree(out_layouts);

    string search_mask = profile_name + "\\*.chr";
    string filename;
    long search_handle = FileFindFirst(search_mask, filename);

    if(search_handle == INVALID_HANDLE)
    {
        PrintFormat("[RendererEA] プロファイルフォルダが見つからないか、.chr が存在しません: '%s'", profile_name);
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
            Print("[RendererEA] プロファイルファイルが開けません: ", profile_file_path);
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
        int show_grid = 1;

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
            Print("[RendererEA] テンポラリテンプレート作成失敗: ", temp_tpl_path);
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

        PrintFormat("[RendererEA] プロファイル解析 チャート #%d (%s): 原シンボル='%s' -> 割当='%s' (%s, %s)",
            chart_count, filename, original_symbol, target_symbol, (is_sub_chart ? "SUB" : "MAIN"), EnumToString(period));

    } while(FileFindNext(search_handle, filename));

    FileFindClose(search_handle);
    return (chart_count > 0);
}

//+------------------------------------------------------------------+
//| MTF チャート起動およびレイアウト・テンプレート適用                  |
//+------------------------------------------------------------------+
void CreateMTFCharts(string profile_name, string main_symbol, string sub_symbol = "", bool enable_dual = false)
{
    bool profile_mode = false;
    ChartLayoutInfo layouts[];

    if(profile_name != "")
    {
        PrintFormat("[RendererEA] プロファイルモードを有効にします: フォルダ='%s'", profile_name);
        if(ProcessProfile(profile_name, main_symbol, sub_symbol, enable_dual, layouts))
        {
            profile_mode = true;
            PrintFormat("[RendererEA] プロファイル解析成功: チャート数=%d", ArraySize(layouts));
        }
        else
        {
            Print("[RendererEA] プロファイル解析に失敗したため、デフォルトM1チャートをオープンします");
        }
    }

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
        layouts[0].show_grid = true;
    }

    // 既存のビューアーチャートをすべて閉じる（EA自身のチャートは絶対に閉じない）
    long current_cid = ChartID();
    long chart_id = ChartFirst();
    bool any_closed = false;
    while(chart_id >= 0)
    {
        long next_chart_id = ChartNext(chart_id);
        if(chart_id != current_cid)
        {
            string csym = ChartSymbol(chart_id);
            if(csym == main_symbol || (sub_symbol != "" && csym == sub_symbol) || StringFind(csym, "_Replay") >= 0)
            {
                PrintFormat("[RendererEA] 既存のビューアーチャートをクローズ: ID=%I64d (%s)", chart_id, csym);
                ChartClose(chart_id);
                any_closed = true;
            }
        }
        chart_id = next_chart_id;
    }
    if(any_closed)
    {
        Sleep(100);
    }

    int total_req = ArraySize(layouts);
    ArrayResize(m_viewer_chart_ids, total_req);

    for(int i = 0; i < total_req; i++)
    {
        m_viewer_chart_ids[i] = 0;
        string sym_to_open = (layouts[i].target_symbol != "") ? layouts[i].target_symbol : main_symbol;
        long cid = ChartOpen(sym_to_open, layouts[i].period);
        if(cid > 0)
        {
            m_viewer_chart_ids[i] = cid;

            if(profile_mode && layouts[i].tpl_path != "")
            {
                Sleep(15);
                if(!ChartApplyTemplate(cid, layouts[i].tpl_path))
                {
                    PrintFormat("[RendererEA] テンプレート適用失敗: %s (エラー: %d)", layouts[i].tpl_path, GetLastError());
                }
                else
                {
                    PrintFormat("[RendererEA] テンプレート適用完了: %s (%s)", layouts[i].tpl_path, sym_to_open);
                }
                Sleep(15);

                ChartSetInteger(cid, CHART_AUTOSCROLL, true);
                ChartSetInteger(cid, CHART_SHIFT, true);
                ChartSetInteger(cid, CHART_SHOW_GRID, layouts[i].show_grid);

                if(layouts[i].floating == 1)
                {
                    ChartSetInteger(cid, CHART_IS_DOCKED, false);
                    ChartSetInteger(cid, CHART_FLOAT_LEFT, layouts[i].float_left);
                    ChartSetInteger(cid, CHART_FLOAT_TOP, layouts[i].float_top);
                    ChartSetInteger(cid, CHART_FLOAT_RIGHT, layouts[i].float_right);
                    ChartSetInteger(cid, CHART_FLOAT_BOTTOM, layouts[i].float_bottom);
                }
                else
                {
                    ChartSetInteger(cid, CHART_IS_DOCKED, true);

                    long c_hwnd = 0;
                    long p_hwnd = 0;
                    for(int r = 0; r < 10; r++)
                    {
                        c_hwnd = ChartGetInteger(cid, CHART_WINDOW_HANDLE);
                        if(c_hwnd > 0)
                        {
                            p_hwnd = GetParent(c_hwnd);
                            if(p_hwnd > 0) break;
                        }
                        Sleep(5);
                    }

                    if(p_hwnd > 0)
                    {
                        ShowWindow(p_hwnd, SW_SHOWNORMAL);
                        int x = layouts[i].win_left;
                        int y = layouts[i].win_top;
                        int w = layouts[i].win_right - layouts[i].win_left;
                        int h = layouts[i].win_bottom - layouts[i].win_top;
                        MoveWindow(p_hwnd, x, y, w, h, true);
                    }
                }
            }
            else
            {
                ChartSetInteger(cid, CHART_AUTOSCROLL, true);
                ChartSetInteger(cid, CHART_SHIFT, true);
                ChartSetInteger(cid, CHART_SHOW_GRID, layouts[i].show_grid);
            }

            ChartRedraw(cid);
            PrintFormat("[RendererEA] チャートオープン完了: ID=%I64d, シンボル=%s, 時間軸=%s",
                cid, sym_to_open, EnumToString(ChartPeriod(cid)));
        }
        else
        {
            PrintFormat("[RendererEA] チャートオープン失敗: %s, 時間軸=%s (エラー: %d)",
                sym_to_open, EnumToString(layouts[i].period), GetLastError());
        }
    }
}

//+------------------------------------------------------------------+
//| 構造体バイトコピー補助関数                                       |
//+------------------------------------------------------------------+
template<typename T>
void StructToBytes(const T &s, uchar &buf[], int offset)
{
    uchar src[];
    int size = (int)sizeof(T);
    ArrayResize(src, size);
    StringToCharArray("", src);
    StructToCharArray(s, src);
    ArrayCopy(buf, src, offset, 0, size);
}

template<typename T>
void BytesToStruct(const uchar &buf[], int offset, T &s)
{
    uchar src[];
    int size = (int)sizeof(T);
    ArrayResize(src, size);
    ArrayCopy(src, buf, 0, offset, size);
    CharArrayToStruct(s, src);
}

//+------------------------------------------------------------------+
//| パイプ接続処理                                                    |
//+------------------------------------------------------------------+
bool ConnectPipe()
{
    if(m_hPipe != INVALID_HANDLE_VALUE)
        return true;

    WaitNamedPipeW(InpPipeName, 50);

    m_hPipe = CreateFileW(
        InpPipeName,
        GENERIC_READ | GENERIC_WRITE,
        0,
        0,
        OPEN_EXISTING,
        0,
        0
    );

    if(m_hPipe == INVALID_HANDLE_VALUE)
        return false;

    PrintFormat("[RendererEA] Core パイプ接続成功: handle=%I64d", m_hPipe);
    SendHello();
    return true;
}

//+------------------------------------------------------------------+
//| HELLO 送信                                                       |
//+------------------------------------------------------------------+
void SendHello()
{
    if(m_hPipe == INVALID_HANDLE_VALUE) return;

    RenderHeader header;
    header.magic = RENDER_MAGIC;
    header.msg_type = MSG_HELLO;
    header.flags = 0;
    header.epoch = m_current_epoch;
    header.payload_len = HELLO_PAYLOAD_SIZE;

    HelloPayload payload;
    payload.ea_version = 400;
    payload.reserved = 0;
    payload.main_ticks = (ulong)m_total_ticks;
    payload.main_hash = 0;
    payload.sub_ticks = (ulong)m_total_ticks_sub;
    payload.sub_hash = 0;
    ArrayInitialize(payload.symbol, 0);
    string sym = (m_replay_symbol != "") ? m_replay_symbol : Symbol();
    StringToCharArray(sym, payload.symbol);

    uchar buf[];
    ArrayResize(buf, HEADER_SIZE + HELLO_PAYLOAD_SIZE);
    StructToBytes(header, buf, 0);
    StructToBytes(payload, buf, HEADER_SIZE);

    uint written = 0;
    WriteFile(m_hPipe, buf, HEADER_SIZE + HELLO_PAYLOAD_SIZE, written, 0);
}

//+------------------------------------------------------------------+
//| ACK 送信                                                         |
//+------------------------------------------------------------------+
void SendAck(ulong main_applied, ulong sub_applied, uint duration_us)
{
    if(m_hPipe == INVALID_HANDLE_VALUE) return;

    RenderHeader header;
    header.magic = RENDER_MAGIC;
    header.msg_type = MSG_ACK;
    header.flags = 0;
    header.epoch = m_current_epoch;
    header.payload_len = ACK_PAYLOAD_SIZE;

    AckPayload payload;
    payload.main_applied_idx = main_applied;
    payload.sub_applied_idx = sub_applied;
    payload.render_duration_us = duration_us;
    payload.reserved = 0;

    uchar buf[];
    ArrayResize(buf, HEADER_SIZE + ACK_PAYLOAD_SIZE);
    StructToBytes(header, buf, 0);
    StructToBytes(payload, buf, HEADER_SIZE);

    uint written = 0;
    WriteFile(m_hPipe, buf, HEADER_SIZE + ACK_PAYLOAD_SIZE, written, 0);
}

//+------------------------------------------------------------------+
//| READY 送信 (シーク/初期化完了)                                   |
//+------------------------------------------------------------------+
void SendReady()
{
    if(m_hPipe == INVALID_HANDLE_VALUE) return;

    RenderHeader header;
    header.magic = RENDER_MAGIC;
    header.msg_type = MSG_READY;
    header.flags = 0;
    header.epoch = m_current_epoch;
    header.payload_len = 0;

    uchar buf[];
    ArrayResize(buf, HEADER_SIZE);
    StructToBytes(header, buf, 0);

    uint written = 0;
    WriteFile(m_hPipe, buf, HEADER_SIZE, written, 0);
}

//+------------------------------------------------------------------+
//| INIT 処理 (Core からのリプレイ環境完全構築要求)                  |
//+------------------------------------------------------------------+
void ProcessInit(const InitPayload &p)
{
    long start_msc = p.start_time_msc;
    long end_msc = p.end_time_msc;
    long preload_date_msc = p.preload_date_msc;
    uint preloaded_bars = p.preloaded_bars;
    uint preload_mode = p.preload_mode;
    string source_symbol = CharArrayToString(p.source_symbol);
    string sub_symbol = CharArrayToString(p.sub_symbol);
    string profile_name = CharArrayToString(p.profile_name);

    StringTrimLeft(source_symbol);
    StringTrimRight(source_symbol);
    StringTrimLeft(sub_symbol);
    StringTrimRight(sub_symbol);
    StringTrimLeft(profile_name);
    StringTrimRight(profile_name);

    if(source_symbol == "") source_symbol = Symbol();

    PrintFormat("[RendererEA] MSG_INIT 受信: source=%s, sub=%s, profile=%s, start=%s, end=%s, pre_mode=%d, pre_bars=%d",
        source_symbol, sub_symbol, profile_name,
        TimeToString((datetime)(start_msc / 1000)), TimeToString((datetime)(end_msc / 1000)),
        preload_mode, preloaded_bars);

    m_source_symbol = source_symbol;
    if(StringFind(source_symbol, "_Replay") > 0)
    {
        m_replay_symbol = source_symbol;
        m_source_symbol = StringSubstr(source_symbol, 0, StringFind(source_symbol, "_Replay"));
    }
    else
    {
        m_replay_symbol = source_symbol + "_Replay";
    }

    m_enable_dual_feed = (sub_symbol != "");
    if(m_enable_dual_feed)
    {
        m_source_symbol_sub = sub_symbol;
        if(StringFind(sub_symbol, "_Replay") > 0)
        {
            m_replay_symbol_sub = sub_symbol;
            m_source_symbol_sub = StringSubstr(sub_symbol, 0, StringFind(sub_symbol, "_Replay"));
        }
        else
        {
            m_replay_symbol_sub = sub_symbol + "_Replay";
        }
    }
    else
    {
        m_source_symbol_sub = "";
        m_replay_symbol_sub = "";
    }

    // 1. カスタムシンボルの作成・初期化
    if(!InitializeReplaySymbol(m_replay_symbol, m_source_symbol))
    {
        PrintFormat("[RendererEA] [Error] メインリプレイシンボル初期化失敗: %s", m_replay_symbol);
    }
    if(m_enable_dual_feed && m_replay_symbol_sub != "")
    {
        InitializeReplaySymbol(m_replay_symbol_sub, m_source_symbol_sub);
    }

    // 2. 過去ティックデータのロード
    datetime start_dt = (datetime)(start_msc / 1000);
    datetime end_dt = (end_msc > start_msc) ? (datetime)(end_msc / 1000) : 0;
    if(!LoadHistoricalTicksEx(m_source_symbol, start_dt, end_dt, m_all_ticks, m_total_ticks))
    {
        PrintFormat("[RendererEA] [Warning] メインティックデータ読込で警告: %s (チャート作成を続行します)", m_source_symbol);
    }
    if(m_enable_dual_feed && m_source_symbol_sub != "")
    {
        LoadHistoricalTicksEx(m_source_symbol_sub, start_dt, end_dt, m_all_ticks_sub, m_total_ticks_sub);
    }

    // 3. 過去足の事前描画 (プリロード)
    int max_period_sec = GetMaxPeriodSeconds(profile_name);
    PreloadHistoricalRatesEx(m_source_symbol, m_replay_symbol, start_dt, max_period_sec, preload_mode, preload_date_msc, preloaded_bars);
    if(m_enable_dual_feed && m_source_symbol_sub != "" && m_replay_symbol_sub != "")
    {
        PreloadHistoricalRatesEx(m_source_symbol_sub, m_replay_symbol_sub, start_dt, max_period_sec, preload_mode, preload_date_msc, preloaded_bars);
    }

    // 4. 初回描画（開始時刻までのローソク足を先行反映してチャート起動時に即座に表示）
    int init_target_idx = 0;
    if(start_msc > 0 && m_total_ticks > 0)
    {
        init_target_idx = FindTickIndexByMsc(m_all_ticks, m_total_ticks, start_msc);
        if(init_target_idx < 0) init_target_idx = 0;
    }

    if(init_target_idx > 0)
    {
        MqlRates init_rates[];
        if(BuildM1RatesFromTicks(m_all_ticks, 0, init_target_idx, m_replay_symbol, init_rates) > 0)
        {
            CustomRatesUpdate(m_replay_symbol, init_rates);
        }
        int recent_cnt = MathMin(init_target_idx + 1, 300);
        int recent_start = init_target_idx - recent_cnt + 1;
        MqlTick init_slice[];
        ArrayResize(init_slice, recent_cnt);
        ArrayCopy(init_slice, m_all_ticks, 0, recent_start, recent_cnt);
        CustomTicksAdd(m_replay_symbol, init_slice);
        m_current_idx = init_target_idx;
    }
    else if(m_total_ticks > 0)
    {
        MqlTick first_slice[1];
        first_slice[0] = m_all_ticks[0];
        CustomTicksAdd(m_replay_symbol, first_slice);
        m_current_idx = 0;
    }
    else
    {
        m_current_idx = -1;
    }

    if(m_enable_dual_feed && m_total_ticks_sub > 0)
    {
        int init_sub_idx = 0;
        if(start_msc > 0)
        {
            init_sub_idx = FindTickIndexByMsc(m_all_ticks_sub, m_total_ticks_sub, start_msc);
            if(init_sub_idx < 0) init_sub_idx = 0;
        }
        if(init_sub_idx > 0)
        {
            MqlRates sub_init_rates[];
            if(BuildM1RatesFromTicks(m_all_ticks_sub, 0, init_sub_idx, m_replay_symbol_sub, sub_init_rates) > 0)
            {
                CustomRatesUpdate(m_replay_symbol_sub, sub_init_rates);
            }
            int recent_sub_cnt = MathMin(init_sub_idx + 1, 300);
            int recent_sub_start = init_sub_idx - recent_sub_cnt + 1;
            MqlTick sub_slice[];
            ArrayResize(sub_slice, recent_sub_cnt);
            ArrayCopy(sub_slice, m_all_ticks_sub, 0, recent_sub_start, recent_sub_cnt);
            CustomTicksAdd(m_replay_symbol_sub, sub_slice);
            m_current_idx_sub = init_sub_idx;
        }
        else
        {
            MqlTick first_sub[1];
            first_sub[0] = m_all_ticks_sub[0];
            CustomTicksAdd(m_replay_symbol_sub, first_sub);
            m_current_idx_sub = 0;
        }
    }
    else
    {
        m_current_idx_sub = -1;
    }

    // 5. ビューアーチャートのオープン & プロファイル適用
    CreateMTFCharts(profile_name, m_replay_symbol, m_replay_symbol_sub, m_enable_dual_feed);

    RedrawAllViewerCharts(true);

    // 6. ロード済み総ティック数を HELLO で再通知 & READY 発行
    SendHello();
    SendReady();
    PrintFormat("[RendererEA] MSG_INIT 完了: main_ticks=%d, sub_ticks=%d", m_total_ticks, m_total_ticks_sub);
}

//+------------------------------------------------------------------+
//| ADVANCE 処理 (インデックス/仮想時間カーソル描画)                  |
//+------------------------------------------------------------------+
void ProcessAdvance(const AdvancePayload &adv, ulong start_us)
{
    if(m_replay_symbol == "" || m_total_ticks <= 0)
    {
        SendAck(0, 0, 0);
        return;
    }

    // 仮想ミリ秒時刻に基づく厳密インデックス特定 (配列長が異なるため main_idx との比較・Max取得は禁止)
    int target_idx = -1;
    if(adv.virtual_time_msc > 0 && m_total_ticks > 0)
    {
        target_idx = FindTickIndexByMsc(m_all_ticks, m_total_ticks, adv.virtual_time_msc);
    }
    if(target_idx < 0)
    {
        target_idx = (int)adv.main_idx;
    }

    if(m_total_ticks > 0 && target_idx > m_total_ticks - 1)
        target_idx = m_total_ticks - 1;
    if(target_idx < 0)
        target_idx = 0;

    // メインシンボルへの差分ティック追加
    if(target_idx > m_current_idx && m_total_ticks > 0)
    {
        int from_idx = (m_current_idx < 0) ? 0 : (m_current_idx + 1);
        int count_to_add = target_idx - from_idx + 1;
        if(count_to_add > 0)
        {
            MqlTick ticks_slice[];
            ArrayResize(ticks_slice, count_to_add);
            ArrayCopy(ticks_slice, m_all_ticks, 0, from_idx, count_to_add);
            CustomTicksAdd(m_replay_symbol, ticks_slice);
            m_current_idx = target_idx;
        }
    }

    // サブシンボルへの差分ティック追加
    if(m_enable_dual_feed && m_replay_symbol_sub != "" && m_total_ticks_sub > 0)
    {
        int target_sub = -1;
        if(adv.virtual_time_msc > 0 && m_total_ticks_sub > 0)
        {
            target_sub = FindTickIndexByMsc(m_all_ticks_sub, m_total_ticks_sub, adv.virtual_time_msc);
        }
        if(target_sub < 0)
        {
            target_sub = (int)adv.sub_idx;
        }
        if(m_total_ticks_sub > 0 && target_sub > m_total_ticks_sub - 1)
            target_sub = m_total_ticks_sub - 1;
        if(target_sub < 0)
            target_sub = 0;

        if(target_sub > m_current_idx_sub)
        {
            int from_sub = (m_current_idx_sub < 0) ? 0 : (m_current_idx_sub + 1);
            int count_sub = target_sub - from_sub + 1;
            if(count_sub > 0)
            {
                MqlTick sub_slice[];
                ArrayResize(sub_slice, count_sub);
                ArrayCopy(sub_slice, m_all_ticks_sub, 0, from_sub, count_sub);
                CustomTicksAdd(m_replay_symbol_sub, sub_slice);
                m_current_idx_sub = target_sub;
            }
        }
    }

    // 全ビューアーチャートの更新
    RedrawAllViewerCharts();

    // チャート左上にリプレイ状態コメントを表示
    long disp_msc = (m_current_idx >= 0 && m_current_idx < m_total_ticks) ? (long)m_all_ticks[m_current_idx].time_msc : adv.virtual_time_msc;
    datetime disp_dt = (datetime)(disp_msc / 1000);
    Comment(StringFormat("=== TickReplay Core v2 ===\nSymbol: %s\nVirtual Time (Server): %s\nRendered Ticks: %d / %d (%.1f%%)",
        m_replay_symbol, TimeToString(disp_dt, TIME_DATE | TIME_SECONDS),
        m_current_idx + 1, m_total_ticks,
        (m_total_ticks > 0) ? ((double)(m_current_idx + 1) / (double)m_total_ticks * 100.0) : 0.0));

    ulong duration_us = (ulong)(GetMicrosecondCount() - start_us);
    SendAck((ulong)MathMax(0, m_current_idx), (ulong)MathMax(0, m_current_idx_sub), (uint)duration_us);
}

//+------------------------------------------------------------------+
//| RESET 処理 (シーク/時間ジャンプ/ループラップ時の差分同期)        |
//+------------------------------------------------------------------+
void ProcessReset(const ResetPayload &rst)
{
    if(m_replay_symbol == "" || m_total_ticks <= 0)
    {
        SendReady();
        return;
    }

    ulong reset_start_us = GetMicrosecondCount();

    int target_idx = -1;
    if(rst.virtual_time_msc > 0 && m_total_ticks > 0)
    {
        target_idx = FindTickIndexByMsc(m_all_ticks, m_total_ticks, rst.virtual_time_msc);
    }
    if(target_idx < 0)
    {
        target_idx = (int)rst.main_target_idx;
    }

    if(target_idx < 0) target_idx = 0;
    if(target_idx >= m_total_ticks) target_idx = m_total_ticks - 1;

    // 同一タイムスタンプを持つティック群の境界を跨がないよう末尾に調整
    while(target_idx + 1 < m_total_ticks &&
          m_all_ticks[target_idx + 1].time_msc == m_all_ticks[target_idx].time_msc)
    {
        target_idx++;
    }

    long target_msc = (long)m_all_ticks[target_idx].time_msc;

    // Subシンボルのインデックス算出
    int target_sub = -1;
    if(m_enable_dual_feed && m_total_ticks_sub > 0)
    {
        if(rst.virtual_time_msc > 0)
        {
            target_sub = FindTickIndexByMsc(m_all_ticks_sub, m_total_ticks_sub, rst.virtual_time_msc);
        }
        else
        {
            target_sub = FindTickIndexByMsc(m_all_ticks_sub, m_total_ticks_sub, target_msc);
        }
        if(target_sub < 0)
        {
            target_sub = (int)rst.sub_target_idx;
        }
        if(target_sub < 0) target_sub = 0;
        if(target_sub >= m_total_ticks_sub) target_sub = m_total_ticks_sub - 1;
    }

    // --- メインシンボルの差分シーク・リセット ---
    if(target_idx == 0)
    {
        long del_msc = (long)m_all_ticks[0].time_msc + 1;
        CustomTicksDelete(m_replay_symbol, del_msc, LONG_MAX);
        datetime del_time = (datetime)(m_all_ticks[0].time_msc / 1000) + 1;
        CustomRatesDelete(m_replay_symbol, del_time, D'3000.01.01 00:00:00');

        MqlTick first_slice[1];
        first_slice[0] = m_all_ticks[0];
        CustomTicksAdd(m_replay_symbol, first_slice);
        m_current_idx = 0;
    }
    else if(target_idx < m_current_idx)
    {
        // 巻き戻し: target_idx 以降の未来ティックおよびバーのみを差分削除
        long del_msc = (long)m_all_ticks[target_idx].time_msc + 1;
        CustomTicksDelete(m_replay_symbol, del_msc, LONG_MAX);
        datetime del_time = (datetime)(m_all_ticks[target_idx].time_msc / 1000) + 1;
        CustomRatesDelete(m_replay_symbol, del_time, D'3000.01.01 00:00:00');

        // 現在足（target_idxの足）のM1バーを正確に反映
        datetime current_bar_sec = (datetime)(m_all_ticks[target_idx].time_msc / 1000);
        current_bar_sec -= (current_bar_sec % 60);
        int bar_start_idx = target_idx;
        while(bar_start_idx > 0 && (datetime)(m_all_ticks[bar_start_idx - 1].time_msc / 1000) >= current_bar_sec)
        {
            bar_start_idx--;
        }
        MqlRates cur_bar_rates[];
        if(BuildM1RatesFromTicks(m_all_ticks, bar_start_idx, target_idx, m_replay_symbol, cur_bar_rates) > 0)
        {
            CustomRatesUpdate(m_replay_symbol, cur_bar_rates);
        }

        m_current_idx = target_idx;
    }
    else if(target_idx > m_current_idx)
    {
        int from_idx = (m_current_idx < 0) ? 0 : (m_current_idx + 1);
        int count_to_add = target_idx - from_idx + 1;

        if(count_to_add > 0)
        {
            // 差分が大量（100ティック以上）の場合、メモリ内ティックからM1バーを高速生成して CustomRatesUpdate で一括適用
            if(count_to_add >= 100)
            {
                MqlRates jump_rates[];
                int bars = BuildM1RatesFromTicks(m_all_ticks, from_idx, target_idx, m_replay_symbol, jump_rates);
                if(bars > 0)
                {
                    CustomRatesUpdate(m_replay_symbol, jump_rates);
                }

                // 直近の足（最大300ティック）のみ CustomTicksAdd して現在足のティックデータと板・スプレッドを同期
                int recent_tick_count = MathMin(count_to_add, 300);
                int recent_from = target_idx - recent_tick_count + 1;
                MqlTick recent_slice[];
                ArrayResize(recent_slice, recent_tick_count);
                ArrayCopy(recent_slice, m_all_ticks, 0, recent_from, recent_tick_count);
                CustomTicksAdd(m_replay_symbol, recent_slice);
            }
            else
            {
                // 小規模差分（100ティック未満）は従来の CustomTicksAdd で直接追加
                MqlTick slice[];
                ArrayResize(slice, count_to_add);
                ArrayCopy(slice, m_all_ticks, 0, from_idx, count_to_add);
                CustomTicksAdd(m_replay_symbol, slice);
            }
            m_current_idx = target_idx;
        }
    }

    // --- Subシンボルの差分シーク・リセット ---
    if(m_enable_dual_feed && m_replay_symbol_sub != "" && m_total_ticks_sub > 0)
    {
        if(target_sub == 0)
        {
            long del_sub_msc = (long)m_all_ticks_sub[0].time_msc + 1;
            CustomTicksDelete(m_replay_symbol_sub, del_sub_msc, LONG_MAX);
            datetime del_sub_time = (datetime)(m_all_ticks_sub[0].time_msc / 1000) + 1;
            CustomRatesDelete(m_replay_symbol_sub, del_sub_time, D'3000.01.01 00:00:00');
            MqlTick sub_first[1];
            sub_first[0] = m_all_ticks_sub[0];
            CustomTicksAdd(m_replay_symbol_sub, sub_first);
            m_current_idx_sub = 0;
        }
        else if(target_sub < m_current_idx_sub)
        {
            long del_sub_msc = (long)m_all_ticks_sub[target_sub].time_msc + 1;
            CustomTicksDelete(m_replay_symbol_sub, del_sub_msc, LONG_MAX);
            datetime del_sub_time = (datetime)(m_all_ticks_sub[target_sub].time_msc / 1000) + 1;
            CustomRatesDelete(m_replay_symbol_sub, del_sub_time, D'3000.01.01 00:00:00');

            datetime sub_bar_sec = (datetime)(m_all_ticks_sub[target_sub].time_msc / 1000);
            sub_bar_sec -= (sub_bar_sec % 60);
            int sub_bar_start = target_sub;
            while(sub_bar_start > 0 && (datetime)(m_all_ticks_sub[sub_bar_start - 1].time_msc / 1000) >= sub_bar_sec)
            {
                sub_bar_start--;
            }
            MqlRates cur_sub_rates[];
            if(BuildM1RatesFromTicks(m_all_ticks_sub, sub_bar_start, target_sub, m_replay_symbol_sub, cur_sub_rates) > 0)
            {
                CustomRatesUpdate(m_replay_symbol_sub, cur_sub_rates);
            }

            m_current_idx_sub = target_sub;
        }
        else if(target_sub > m_current_idx_sub)
        {
            int from_sub = (m_current_idx_sub < 0) ? 0 : (m_current_idx_sub + 1);
            int count_sub = target_sub - from_sub + 1;
            if(count_sub > 0)
            {
                if(count_sub >= 100)
                {
                    MqlRates sub_jump_rates[];
                    int sub_bars = BuildM1RatesFromTicks(m_all_ticks_sub, from_sub, target_sub, m_replay_symbol_sub, sub_jump_rates);
                    if(sub_bars > 0)
                    {
                        CustomRatesUpdate(m_replay_symbol_sub, sub_jump_rates);
                    }
                    int recent_sub_count = MathMin(count_sub, 300);
                    int recent_sub_from = target_sub - recent_sub_count + 1;
                    MqlTick sub_recent[];
                    ArrayResize(sub_recent, recent_sub_count);
                    ArrayCopy(sub_recent, m_all_ticks_sub, 0, recent_sub_from, recent_sub_count);
                    CustomTicksAdd(m_replay_symbol_sub, sub_recent);
                }
                else
                {
                    MqlTick sub_slice[];
                    ArrayResize(sub_slice, count_sub);
                    ArrayCopy(sub_slice, m_all_ticks_sub, 0, from_sub, count_sub);
                    CustomTicksAdd(m_replay_symbol_sub, sub_slice);
                }
                m_current_idx_sub = target_sub;
            }
        }
    }

    // チャート強制リフレッシュ & 追跡スクロール設定
    RedrawAllViewerCharts(true);
    m_pending_reset_redraw_count = 1;

    // チャート左上にリプレイ状態コメントを表示
    long disp_msc = (m_current_idx >= 0 && m_current_idx < m_total_ticks) ? (long)m_all_ticks[m_current_idx].time_msc : rst.virtual_time_msc;
    datetime disp_dt = (datetime)(disp_msc / 1000);
    ulong dur_ms = (ulong)((GetMicrosecondCount() - reset_start_us) / 1000);
    PrintFormat("[RendererEA] ProcessReset 完了: 遷移所要時間=%d ms, target_idx=%d, virtual_time=%s",
        dur_ms, m_current_idx, TimeToString(disp_dt, TIME_DATE | TIME_SECONDS));

    Comment(StringFormat("=== TickReplay Core v2 ===\nSymbol: %s\nVirtual Time (Server): %s\nRendered Ticks: %d / %d (%.1f%%)",
        m_replay_symbol, TimeToString(disp_dt, TIME_DATE | TIME_SECONDS),
        m_current_idx + 1, m_total_ticks,
        (m_total_ticks > 0) ? ((double)(m_current_idx + 1) / (double)m_total_ticks * 100.0) : 0.0));

    SendReady();
}

//+------------------------------------------------------------------+
//| プロファイル適用パケット処理                                      |
//+------------------------------------------------------------------+
void ProcessApplyProfile(const ApplyProfilePayload &p)
{
    string profile_name = CharArrayToString(p.profile_name);
    string main_sym = CharArrayToString(p.main_symbol);
    string sub_sym = CharArrayToString(p.sub_symbol);

    StringTrimLeft(profile_name);
    StringTrimRight(profile_name);
    StringTrimLeft(main_sym);
    StringTrimRight(main_sym);
    StringTrimLeft(sub_sym);
    StringTrimRight(sub_sym);

    if(main_sym == "") main_sym = (m_replay_symbol != "") ? m_replay_symbol : Symbol();
    bool enable_dual = (sub_sym != "");

    PrintFormat("[RendererEA] MSG_APPLY_PROFILE 受信: profile='%s', main='%s', sub='%s'", profile_name, main_sym, sub_sym);
    CreateMTFCharts(profile_name, main_sym, sub_sym, enable_dual);
}

//+------------------------------------------------------------------+
//| カスタムシンボル ティックインポートパケット処理                   |
//+------------------------------------------------------------------+
void ProcessImportTicks(const ImportTicksPayload &p)
{
    string target_symbol = CharArrayToString(p.symbol);
    string group_path    = CharArrayToString(p.group);
    string base_symbol   = CharArrayToString(p.base_symbol);
    string bin_file      = CharArrayToString(p.bin_file);

    StringTrimLeft(target_symbol);
    StringTrimRight(target_symbol);
    StringTrimLeft(group_path);
    StringTrimRight(group_path);
    StringTrimLeft(base_symbol);
    StringTrimRight(base_symbol);
    StringTrimLeft(bin_file);
    StringTrimRight(bin_file);

    if(target_symbol != "" && bin_file != "")
    {
        if(group_path == "") group_path = "Custom";
        if(base_symbol == "") base_symbol = target_symbol;

        PrintFormat("[RendererEA] MSG_IMPORT_TICKS 受信: target='%s', bin='%s', group='%s', base='%s'",
            target_symbol, bin_file, group_path, base_symbol);

        int file_handle = FileOpen(bin_file, FILE_READ | FILE_BIN);
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
                        }
                        if(!CustomSymbolCreate(target_symbol, group_path, actual_base))
                        {
                            CustomSymbolCreate(target_symbol, group_path, NULL);
                        }
                    }
                    int added = CustomTicksAdd(target_symbol, ticks);
                    PrintFormat("[RendererEA] CustomTicksAdd 完了: symbol=%s, 追加数=%d/%d", target_symbol, added, read_count);
                }
            }
            else
            {
                FileClose(file_handle);
            }
        }
        else
        {
            PrintFormat("[RendererEA] [Error] binファイルオープン失敗: %s (Code=%d)", bin_file, GetLastError());
        }
    }
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
    timeBeginPeriod(1);
    EventSetMillisecondTimer(InpTimerMs);

    PrintFormat("[RendererEA] 描画専用EA起動: パイプ=%s (Core v2 からの要求待機中)", InpPipeName);

    ConnectPipe();

    return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    EventKillTimer();
    timeEndPeriod(1);

    if(m_hPipe != INVALID_HANDLE_VALUE)
    {
        CloseHandle(m_hPipe);
        m_hPipe = INVALID_HANDLE_VALUE;
    }

    // ビューアーチャートおよび残存リプレイチャートを全クローズ
    CloseAllReplayCharts();

    PrintFormat("[RendererEA] 終了処理完了: 理由=%d", reason);
}

//+------------------------------------------------------------------+
//| Timer event handler                                              |
//+------------------------------------------------------------------+
void OnTimer()
{
    // 時間遷移直後の追跡スクロール（MT5非同期バー構築完了後の末尾位置同期を100%保証）
    if(m_pending_reset_redraw_count > 0)
    {
        m_pending_reset_redraw_count--;
        int total_viewers = ArraySize(m_viewer_chart_ids);
        for(int i = 0; i < total_viewers; i++)
        {
            if(m_viewer_chart_ids[i] > 0)
            {
                ChartSetInteger(m_viewer_chart_ids[i], CHART_AUTOSCROLL, true);
                ChartNavigate(m_viewer_chart_ids[i], CHART_END, 0);
                ChartRedraw(m_viewer_chart_ids[i]);
            }
        }
    }

    if(m_hPipe == INVALID_HANDLE_VALUE)
    {
        ConnectPipe();
        return;
    }

    uint bytes_avail = 0;
    if(!PeekNamedPipe(m_hPipe, 0, 0, 0, bytes_avail, 0))
    {
        CloseHandle(m_hPipe);
        m_hPipe = INVALID_HANDLE_VALUE;
        // パイプ切断時（アプリ終了・異常終了等）にも安全にビューアーチャートをクローズ
        CloseAllReplayCharts();
        return;
    }

    if(bytes_avail < HEADER_SIZE)
        return;

    while(bytes_avail >= HEADER_SIZE)
    {
        uchar header_buf[];
        ArrayResize(header_buf, HEADER_SIZE);
        uint read_bytes = 0;
        if(!ReadFile(m_hPipe, header_buf, HEADER_SIZE, read_bytes, 0) || read_bytes < HEADER_SIZE)
        {
            CloseHandle(m_hPipe);
            m_hPipe = INVALID_HANDLE_VALUE;
            CloseAllReplayCharts();
            return;
        }

        RenderHeader header;
        BytesToStruct(header_buf, 0, header);

        if(header.magic != RENDER_MAGIC)
        {
            PrintFormat("[RendererEA] 不正なマジックナンバー: 0x%08X", header.magic);
            CloseHandle(m_hPipe);
            m_hPipe = INVALID_HANDLE_VALUE;
            CloseAllReplayCharts();
            return;
        }

        m_current_epoch = header.epoch;
        uchar payload_buf[];
        ArrayResize(payload_buf, header.payload_len);

        if(header.payload_len > 0)
        {
            if(!ReadFile(m_hPipe, payload_buf, header.payload_len, read_bytes, 0) || read_bytes < header.payload_len)
            {
                CloseHandle(m_hPipe);
                m_hPipe = INVALID_HANDLE_VALUE;
                CloseAllReplayCharts();
                return;
            }
        }

        ulong start_us = GetMicrosecondCount();

        switch(header.msg_type)
        {
            case MSG_INIT:
            {
                InitPayload init_p;
                BytesToStruct(payload_buf, 0, init_p);
                ProcessInit(init_p);
                break;
            }
            case MSG_ADVANCE:
            {
                AdvancePayload adv;
                BytesToStruct(payload_buf, 0, adv);
                ProcessAdvance(adv, start_us);
                break;
            }
            case MSG_RESET:
            {
                ResetPayload rst;
                BytesToStruct(payload_buf, 0, rst);
                ProcessReset(rst);
                break;
            }
            case MSG_APPLY_PROFILE:
            {
                ApplyProfilePayload app;
                BytesToStruct(payload_buf, 0, app);
                ProcessApplyProfile(app);
                break;
            }
            case MSG_IMPORT_TICKS:
            {
                ImportTicksPayload imp;
                BytesToStruct(payload_buf, 0, imp);
                ProcessImportTicks(imp);
                break;
            }
            case MSG_TERMINATE:
            {
                Print("[RendererEA] MSG_TERMINATE 受信: リプレイチャートを全クローズします");
                CloseAllReplayCharts();
                break;
            }
            default:
                break;
        }

        if(!PeekNamedPipe(m_hPipe, 0, 0, 0, bytes_avail, 0))
        {
            CloseHandle(m_hPipe);
            m_hPipe = INVALID_HANDLE_VALUE;
            CloseAllReplayCharts();
            break;
        }
    }
}
