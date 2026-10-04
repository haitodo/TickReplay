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

#define GENERIC_READ          0x80000000
#define GENERIC_WRITE         0x40000000
#define OPEN_EXISTING         3
#define INVALID_HANDLE_VALUE  -1

//--- プロトコル定数 (render_pipe.rs と 100% 一致)
#define RENDER_MAGIC          0x54525232 // 'TRR2'
#define MSG_HELLO             0x0001
#define MSG_ADVANCE           0x0002
#define MSG_RESET             0x0003
#define MSG_ACK               0x0004
#define MSG_READY             0x0005

#define HEADER_SIZE           16
#define HELLO_PAYLOAD_SIZE    40
#define ADVANCE_PAYLOAD_SIZE  24
#define RESET_PAYLOAD_SIZE    32
#define ACK_PAYLOAD_SIZE      24

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

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
    timeBeginPeriod(1);
    EventSetMillisecondTimer(InpTimerMs);

    // シンボル設定の読込
    m_replay_symbol = Symbol();
    PrintFormat("[RendererEA] 初期化完了: シンボル=%s, パイプ=%s", m_replay_symbol, InpPipeName);

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
    PrintFormat("[RendererEA] 終了処理完了: 理由=%d", reason);
}

//+------------------------------------------------------------------+
//| パイプ接続処理                                                    |
//+------------------------------------------------------------------+
bool ConnectPipe()
{
    if (m_hPipe != INVALID_HANDLE_VALUE)
        return true;

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
    int target_idx = (int)adv.main_idx;
    if (target_idx > m_total_ticks - 1)
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
