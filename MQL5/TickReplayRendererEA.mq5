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

#define HEADER_SIZE                16
#define HELLO_PAYLOAD_SIZE         72
#define ADVANCE_PAYLOAD_SIZE       24
#define RESET_PAYLOAD_SIZE         32
#define ACK_PAYLOAD_SIZE           24
#define APPLY_PROFILE_PAYLOAD_SIZE 128

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
    long  virtual_time_msc;  // 8 bytes: 現在の仮想時刻
};

struct ResetPayload
{
    ulong main_target_idx;   // 8 bytes: シーク先インデックス
    ulong main_preload_from; // 8 bytes: プリロード開始インデックス
    ulong sub_target_idx;    // 8 bytes
    ulong sub_preload_from;  // 8 bytes
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
int      m_current_idx = 0;
uint     m_current_epoch = 1;

// サブ比較銘柄
bool     m_enable_dual_feed = false;
string   m_replay_symbol_sub = "";
string   m_source_symbol_sub = "";
MqlTick  m_all_ticks_sub[];
int      m_total_ticks_sub = 0;
int      m_current_idx_sub = 0;

ulong    m_last_redraw_us = 0;
const ulong REDRAW_INTERVAL_US = 16666; // 最大 60FPS にチャート再描画を間引き

// ビューアーチャート管理
long     m_viewer_chart_ids[];

//+------------------------------------------------------------------+
//| チャートシンボルから全ティックをメモリにロード                   |
//+------------------------------------------------------------------+
bool LoadChartTicks()
{
    m_replay_symbol = Symbol();
    SymbolSelect(m_replay_symbol, true);

    // 最大 5 回リトライして全ティックをロード
    int retries = 0;
    while (retries < 5)
    {
        ResetLastError();
        m_total_ticks = CopyTicksRange(m_replay_symbol, m_all_ticks, COPY_TICKS_ALL, 0, (ulong)LONG_MAX);
        if (m_total_ticks > 0)
        {
            PrintFormat("[RendererEA] ティックロード完了: %s (全 %d ティック)", m_replay_symbol, m_total_ticks);
            return true;
        }
        Sleep(100);
        retries++;
    }

    PrintFormat("[RendererEA] ティックロード待機中または0件: %s (コード: %d)", m_replay_symbol, GetLastError());
    return false;
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
    timeBeginPeriod(1);
    EventSetMillisecondTimer(InpTimerMs);

    // シンボル設定の読込 & ティックロード
    m_replay_symbol = Symbol();
    LoadChartTicks();
    PrintFormat("[RendererEA] 初期化完了: シンボル=%s (ticks=%d), パイプ=%s", m_replay_symbol, m_total_ticks, InpPipeName);

    // パイプ接続試行
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

    if (m_hPipe != INVALID_HANDLE_VALUE)
    {
        CloseHandle(m_hPipe);
        m_hPipe = INVALID_HANDLE_VALUE;
    }

    // ビューアーチャートのクローズ
    int total_viewers = ArraySize(m_viewer_chart_ids);
    long current_cid = ChartID();
    for (int i = 0; i < total_viewers; i++)
    {
        if (m_viewer_chart_ids[i] > 0 && m_viewer_chart_ids[i] != current_cid)
        {
            ChartClose(m_viewer_chart_ids[i]);
            m_viewer_chart_ids[i] = 0;
        }
    }
    ArrayFree(m_viewer_chart_ids);

    PrintFormat("[RendererEA] 終了処理完了: 理由=%d", reason);
}

//+------------------------------------------------------------------+
//| パイプ接続処理                                                    |
//+------------------------------------------------------------------+
bool ConnectPipe()
{
    if (m_hPipe != INVALID_HANDLE_VALUE)
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

    if (m_hPipe == INVALID_HANDLE_VALUE)
        return false;

    PrintFormat("[RendererEA] Core パイプ接続成功: handle=%I64d", m_hPipe);

    // HELLO パケット送信
    SendHello();
    return true;
}

//+------------------------------------------------------------------+
//| HELLO 送信                                                       |
//+------------------------------------------------------------------+
void SendHello()
{
    if (m_hPipe == INVALID_HANDLE_VALUE) return;

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
    StringToCharArray(m_replay_symbol, payload.symbol);

    uchar buf[];
    ArrayResize(buf, HEADER_SIZE + HELLO_PAYLOAD_SIZE);
    
    // ヘッダーコピー
    StructToBytes(header, buf, 0);
    // ペイロードコピー
    StructToBytes(payload, buf, HEADER_SIZE);

    uint written = 0;
    WriteFile(m_hPipe, buf, HEADER_SIZE + HELLO_PAYLOAD_SIZE, written, 0);
}

//+------------------------------------------------------------------+
//| ACK 送信                                                         |
//+------------------------------------------------------------------+
void SendAck(ulong main_applied, ulong sub_applied, uint duration_us)
{
    if (m_hPipe == INVALID_HANDLE_VALUE) return;

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
//| READY 送信 (シーク後再初期化完了)                                 |
//+------------------------------------------------------------------+
void SendReady()
{
    if (m_hPipe == INVALID_HANDLE_VALUE) return;

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
//| 構造体バイトコピー補助関数                                       |
//+------------------------------------------------------------------+
template<typename T>
void StructToBytes(const T &s, uchar &buf[], int offset)
{
    uchar src[];
    int size = (int)sizeof(T);
    ArrayResize(src, size);
    StringToCharArray("", src); // clear
    // MQL5 StructToCharArray
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
//| Timer event handler                                              |
//+------------------------------------------------------------------+
void OnTimer()
{
    if (m_hPipe == INVALID_HANDLE_VALUE)
    {
        ConnectPipe();
        return;
    }

    // パイプ内の受信可能バイト数を検査
    uint bytes_avail = 0;
    if (!PeekNamedPipe(m_hPipe, 0, 0, 0, bytes_avail, 0))
    {
        CloseHandle(m_hPipe);
        m_hPipe = INVALID_HANDLE_VALUE;
        return;
    }

    if (bytes_avail < HEADER_SIZE)
        return;

    // パケット読み込みループ
    while (bytes_avail >= HEADER_SIZE)
    {
        uchar header_buf[];
        ArrayResize(header_buf, HEADER_SIZE);
        uint read_bytes = 0;
        if (!ReadFile(m_hPipe, header_buf, HEADER_SIZE, read_bytes, 0) || read_bytes < HEADER_SIZE)
        {
            CloseHandle(m_hPipe);
            m_hPipe = INVALID_HANDLE_VALUE;
            return;
        }

        RenderHeader header;
        BytesToStruct(header_buf, 0, header);

        if (header.magic != RENDER_MAGIC)
        {
            PrintFormat("[RendererEA] 不正なマジックナンバー: 0x%08X", header.magic);
            CloseHandle(m_hPipe);
            m_hPipe = INVALID_HANDLE_VALUE;
            return;
        }

        m_current_epoch = header.epoch;
        uchar payload_buf[];
        ArrayResize(payload_buf, header.payload_len);

        if (header.payload_len > 0)
        {
            if (!ReadFile(m_hPipe, payload_buf, header.payload_len, read_bytes, 0) || read_bytes < header.payload_len)
            {
                CloseHandle(m_hPipe);
                m_hPipe = INVALID_HANDLE_VALUE;
                return;
            }
        }

        // コマンドディスパッチ
        ulong start_us = GetMicrosecondCount();

        switch (header.msg_type)
        {
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
            default:
                break;
        }

        // 次のパケット検査
        if (!PeekNamedPipe(m_hPipe, 0, 0, 0, bytes_avail, 0))
            break;
    }
}

//+------------------------------------------------------------------+
//| ADVANCE 処理 (インデックスカーソル描画)                            |
//+------------------------------------------------------------------+
void ProcessAdvance(const AdvancePayload &adv, ulong start_us)
{
    if (m_total_ticks <= 0)
    {
        LoadChartTicks();
    }

    int target_idx = (int)adv.main_idx;
    if (m_total_ticks > 0 && target_idx > m_total_ticks - 1)
        target_idx = m_total_ticks - 1;

    if (target_idx > m_current_idx && m_total_ticks > 0)
    {
        int count_to_add = target_idx - m_current_idx;
        MqlTick ticks_slice[];
        ArrayResize(ticks_slice, count_to_add);
        ArrayCopy(ticks_slice, m_all_ticks, 0, m_current_idx + 1, count_to_add);

        // MT5 チャートへ一括追加
        CustomTicksAdd(m_replay_symbol, ticks_slice);
        m_current_idx = target_idx;
    }

    // チャート再描画（最大 60FPS にスマート間引き）
    ulong now_us = GetMicrosecondCount();
    if (now_us - m_last_redraw_us >= REDRAW_INTERVAL_US)
    {
        ChartRedraw(0);
        m_last_redraw_us = now_us;
    }

    ulong duration_us = (ulong)(GetMicrosecondCount() - start_us);
    SendAck((ulong)m_current_idx, (ulong)m_current_idx_sub, (uint)duration_us);
}

//+------------------------------------------------------------------+
//| RESET 処理 (シーク時再初期化)                                      |
//+------------------------------------------------------------------+
void ProcessReset(const ResetPayload &rst)
{
    if (m_total_ticks <= 0)
    {
        LoadChartTicks();
    }

    m_current_idx = (int)rst.main_target_idx;
    int preload_from = (int)rst.main_preload_from;

    if (m_total_ticks > 0 && m_current_idx >= 0 && m_current_idx < m_total_ticks)
    {
        int preload_count = m_current_idx - preload_from + 1;
        if (preload_count > 0 && preload_from >= 0)
        {
            MqlTick preload_slice[];
            ArrayResize(preload_slice, preload_count);
            ArrayCopy(preload_slice, m_all_ticks, 0, preload_from, preload_count);
            CustomTicksDelete(m_replay_symbol, 0, LONG_MAX);
            CustomTicksAdd(m_replay_symbol, preload_slice);
        }
        else
        {
            CustomTicksDelete(m_replay_symbol, 0, LONG_MAX);
        }
    }

    ChartRedraw(0);
    SendReady();
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
    // 4. ANSI / UTF-8 without BOM
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
        PrintFormat("[RendererEA] プロファイルフォルダが見つからないか、.chr が存在しません: '%s' (検索マスク: '%s', Code: %d)", profile_name, search_mask, GetLastError());
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

        // 比較銘柄マーカーの検出
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
            if(csym == main_symbol || (sub_symbol != "" && csym == sub_symbol))
            {
                PrintFormat("[RendererEA] 既存のビューアーチャートをクローズします: ID=%I64d (%s)", chart_id, csym);
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
                Sleep(50);
                if(!ChartApplyTemplate(cid, layouts[i].tpl_path))
                {
                    PrintFormat("[RendererEA] テンプレート適用失敗: %s (エラー: %d)", layouts[i].tpl_path, GetLastError());
                }
                else
                {
                    PrintFormat("[RendererEA] テンプレート適用完了: %s (%s)", layouts[i].tpl_path, sym_to_open);
                }
                Sleep(50);

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
                        Sleep(10);
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

    if(main_sym == "") main_sym = Symbol();
    bool enable_dual = (sub_sym != "");

    PrintFormat("[RendererEA] MSG_APPLY_PROFILE 受信: profile='%s', main='%s', sub='%s'", profile_name, main_sym, sub_sym);
    CreateMTFCharts(profile_name, main_sym, sub_sym, enable_dual);
}

