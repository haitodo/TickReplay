//+------------------------------------------------------------------+
//|                                              KuChartFastOpt.mq5  |
//|                                     Converted for MetaTrader 5   |
//+------------------------------------------------------------------+
#property copyright "Converted from cTrader with Robust Optimization"
#property version   "2.22" // 土日検証完全対応・無限ループ100%回避・CHFバグ修正・8要素ソート
#property indicator_separate_window 
#property indicator_buffers 8
#property indicator_plots   8

//--- プロット設定
#property indicator_label1  "CAD"
#property indicator_type1   DRAW_LINE
#property indicator_color1  0x2D52A0
#property indicator_width1  2

#property indicator_label2  "NZD"
#property indicator_type2   DRAW_LINE
#property indicator_color2  0x7E9031
#property indicator_width2  2

#property indicator_label3  "CHF"
#property indicator_type3   DRAW_LINE
#property indicator_color3  0xAFA59E
#property indicator_width3  2

#property indicator_label4  "AUD"
#property indicator_type4   DRAW_LINE
#property indicator_color4  0x00C0FF
#property indicator_width4  2

#property indicator_label5  "GBP"
#property indicator_type5   DRAW_LINE
#property indicator_color5  0xFF0091
#property indicator_width5  2

#property indicator_label6  "EUR"
#property indicator_type6   DRAW_LINE
#property indicator_color6  0xF3C133
#property indicator_width6  2

#property indicator_label7  "JPY"
#property indicator_type7   DRAW_LINE
#property indicator_color7  0xD500E5
#property indicator_width7  2

#property indicator_label8  "USD"
#property indicator_type8   DRAW_LINE
#property indicator_color8  0x40D640
#property indicator_width8  2

//--- Constants
#define CACHE_MARGIN 16 // 計算の表示境界をカバーするキャッシュマージン
#define RESERVE_SIZE 32768 // 再確保(realloc)のオーバーヘッドを皆無にする大容量予備枠

//--- Enum
enum ENUM_TERM_TYPE
{
    TERM_CUSTOM = 0, // Custom
    TERM_DAY = 1,    // Day
    TERM_WEEK = 2,   // Week
    TERM_MONTH = 3,  // Month
    TERM_YEAR = 4    // Year
};

enum ENUM_THROTTLE_MODE
{
    THROTTLE_NONE = 0,   // 間引きなし (全ティックで即時計算)
    THROTTLE_AUTO = 1,   // 自動判別 (M1:100ms / M5:500ms / その他:1000ms)
    THROTTLE_CUSTOM = 2  // 手動設定 (下の「手動設定時の間引き時間」を使用)
};

//--- Inputs
input group "表示期間モード設定"
input ENUM_TERM_TYPE InpTermType          = TERM_CUSTOM; // 表示期間モード
input int            InpPeriods           = 180;         // カスタムの期間(バーの数)

input group "UI設定"
input bool           InpIsDisplayCurrency = false;       // 8通貨強弱順位レジェンド表示
input int            InpMultipliedRange   = 50;          // 価格内に入らない場合の調整用(縦軸に乗算する値)
input string         InpRefreshKey        = "S";         // 手動リフレッシュキー (1文字)

input group "パフォーマンス設定"
input bool               InpUseApproxReturn   = true;          // 近似計算の使用 (MathLogを完全排除し超高速化)
input ENUM_THROTTLE_MODE InpThrottleMode      = THROTTLE_AUTO; // 間引き制御モード
input int                InpThrottleMs        = 250;           // 手動設定時の間引き時間 (ミリ秒)

input group "シンボル設定 (空白・デフォルト時は自動的に接尾辞を調整します)"
input string InpSymUSDCHF = "USDCHF.cl"; 
input string InpSymEURUSD = "EURUSD.cl"; 
input string InpSymGBPUSD = "GBPUSD.cl"; 
input string InpSymUSDJPY = "USDJPY.cl"; 
input string InpSymAUDUSD = "AUDUSD.cl"; 
input string InpSymNZDUSD = "NZDUSD.cl"; 
input string InpSymUSDCAD = "USDCAD.cl"; 

//--- Buffers
double BufferCAD[], BufferNZD[], BufferCHF[], BufferAUD[], BufferGBP[], BufferEUR[], BufferJPY[], BufferUSD[];

//--- Internal Variables
color  ColorCAD, ColorNZD, ColorCHF, ColorAUD, ColorGBP, ColorEUR, ColorJPY, ColorUSD;

datetime cachedBaseTime;
double baseEURUSD, baseUSDJPY, baseGBPUSD, baseAUDUSD, baseUSDCHF, baseNZDUSD, baseUSDCAD;
double log_baseEURUSD, log_baseUSDJPY, log_baseGBPUSD, log_baseAUDUSD, log_baseUSDCHF, log_baseNZDUSD, log_baseUSDCAD; // MathLogキャッシュ用
double inv_baseEURUSD, inv_baseUSDJPY, inv_baseGBPUSD, inv_baseAUDUSD, inv_baseUSDCHF, inv_baseNZDUSD, inv_baseUSDCAD; // 除算排除キャッシュ用

bool   isFirstBar;
int    lastDay;
ENUM_TERM_TYPE baseTerm;

string prefix;
string lastLegendNames[8];
double lastLegendValues[8];
color  lastLegendColors[8];

//--- 解決済みシンボル名保持用
string SymUSDCHF, SymEURUSD, SymGBPUSD, SymUSDJPY, SymAUDUSD, SymNZDUSD, SymUSDCAD;

//--- 自動サフィックス検出用グローバル変数
string g_prefix = "";
string g_suffix = "";

//--- 一括データ格納用
double c_EURUSD[], c_USDJPY[], c_GBPUSD[], c_AUDUSD[], c_USDCHF[], c_NZDUSD[], c_USDCAD[];

//--- 価格および近似リターンのステートキャッシュ
double last_cur_e = 0, last_cur_j = 0, last_cur_g = 0, last_cur_a = 0, last_cur_c = 0, last_cur_n = 0, last_cur_d = 0;
double last_r_e = 0, last_r_j = 0, last_r_g = 0, last_r_a = 0, last_r_c = 0, last_r_n = 0, last_r_d = 0;

//--- プロトタイプ宣言
datetime GetBaseTime(datetime currentTime);
int GetRequiredPeriods();

//+------------------------------------------------------------------+
//| チャートシンボルから接頭辞・接尾辞を自動検出する関数            |
//+------------------------------------------------------------------+
void DetectPrefixSuffix()
{
    string chart_symbol = _Symbol;
    string core_symbols[] = {"EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD", "USDCAD",
                             "EURJPY", "GBPJPY", "AUDJPY", "CHFJPY", "CADJPY", "NZDJPY",
                             "EURAUD", "EURCAD", "EURCHF", "EURGBP", "EURNZD",
                             "GBPAUD", "GBPCAD", "GBPCHF", "GBPNZD", "XAUUSD"};
    
    g_prefix = "";
    g_suffix = "";
    
    for(int i = 0; i < ArraySize(core_symbols); i++)
    {
        int pos = StringFind(chart_symbol, core_symbols[i]);
        if(pos >= 0)
        {
            g_prefix = StringSubstr(chart_symbol, 0, pos);
            g_suffix = StringSubstr(chart_symbol, pos + StringLen(core_symbols[i]));
            return;
        }
    }
    
    if(StringLen(chart_symbol) > 6)
    {
        g_suffix = StringSubstr(chart_symbol, 6);
    }
}

string GetSymbolWithSuffix(string baseName)
{
    return g_prefix + baseName + g_suffix;
}

string GetBrokerSuffix()
{
    string suffix = g_suffix;
    int len = StringLen(suffix);
    int rep_len = StringLen("_Replay");
    if(len >= rep_len && StringSubstr(suffix, len - rep_len) == "_Replay")
    {
        return StringSubstr(suffix, 0, len - rep_len);
    }
    return suffix;
}

string ResolveSymbol(string inputSym, string baseName)
{
    if(inputSym != "" && inputSym != baseName && inputSym != baseName + ".cl")
    {
        return inputSym;
    }
    
    string chart_symbol = _Symbol;
    // baseName に接頭辞と接尾辞（_Replay を含む）を適用して、現在のチャートシンボルと一致するか判定
    string resolved_replay = g_prefix + baseName + g_suffix;
    if(resolved_replay == chart_symbol)
    {
        return chart_symbol; // リプレイ中のカスタムシンボル自身（例: USDJPY_Replay）を返す
    }
    
    // 他の通貨は、_Replay を除外したブローカーの標準シンボル名（例: EURUSD.m）を返す
    string broker_suffix = GetBrokerSuffix();
    return g_prefix + baseName + broker_suffix;
}

void RequestData(string sym, int periods)
{
    if(SymbolSelect(sym, true))
    {
        double tmp[];
        CopyClose(sym, PERIOD_CURRENT, 0, periods + 500, tmp);
    }
}

bool IsSymbolsDataReadyWithDiagnostics(int periods)
{
    static string last_error_log = "";
    string symbols[7] = {SymUSDCHF, SymEURUSD, SymGBPUSD, SymUSDJPY, SymAUDUSD, SymNZDUSD, SymUSDCAD};
    
    for(int i = 0; i < 7; i++)
    {
        string sym = symbols[i];
        
        if(!SymbolSelect(sym, true))
        {
            string log = StringFormat("シンボル '%s' が存在しないか気配値に追加できません。", sym);
            if(log != last_error_log) { Print("KuChartFast [Error]: ", log); last_error_log = log; }
            return false;
        }
        
        long sync = 0;
        if(!SeriesInfoInteger(sym, PERIOD_CURRENT, SERIES_SYNCHRONIZED, sync) || sync == 0)
        {
            string log = StringFormat("シンボル '%s' のヒストリカルデータ同期を待機中...", sym);
            if(log != last_error_log) { Print("KuChartFast [Waiting]: ", log); last_error_log = log; }
            return false;
        }
        
        int bars = Bars(sym, PERIOD_CURRENT);
        if(bars < periods)
        {
            string log = StringFormat("シンボル '%s' のデータ本数が不足しています（必要: %d / 現在: %d）", sym, periods, bars);
            if(log != last_error_log) { Print("KuChartFast [Waiting]: ", log); last_error_log = log; }
            return false;
        }
    }
    
    if(last_error_log != "")
    {
        Print("KuChartFast: すべての参照通貨データの同期が正常に完了しました。計算を開始します。");
        last_error_log = "";
    }
    return true;
}

//+------------------------------------------------------------------+
//| Math Utils                                                       |
//+------------------------------------------------------------------+
double GetApproxReturnCached(double currentPrice, double basePrice, double invBasePrice)
{
    if(basePrice <= 0 || currentPrice <= 0 || currentPrice == EMPTY_VALUE) return 0;
    return (currentPrice - basePrice) * invBasePrice * 1000.0;
}

double GetLogReturnCached(double currentPrice, double logBasePrice)
{
    if(currentPrice <= 0 || currentPrice == EMPTY_VALUE || !MathIsValidNumber(currentPrice))
        return 0;
    return (MathLog(currentPrice) - logBasePrice) * 1000.0;
}

double GetBasePriceSafe(string sym, datetime t)
{
    int shift = iBarShift(sym, PERIOD_CURRENT, t, false);
    if(shift < 0) 
    {
        int total = Bars(sym, PERIOD_CURRENT);
        if(total > 0)
        {
            double oldest = iClose(sym, PERIOD_CURRENT, total - 1);
            if(oldest > 0 && oldest != EMPTY_VALUE) return oldest;
        }
        return EMPTY_VALUE;
    }
    double price = iClose(sym, PERIOD_CURRENT, shift);
    if(price <= 0 || price == EMPTY_VALUE) return EMPTY_VALUE;
    return price;
}

double GetPriceAtTime(string sym, datetime t)
{
    int shift = iBarShift(sym, PERIOD_CURRENT, t, false);
    if(shift >= 0)
    {
        double price = iClose(sym, PERIOD_CURRENT, shift);
        if(price > 0 && price != EMPTY_VALUE)
            return price;
    return EMPTY_VALUE;
}

bool CopyCloseAtTime(string sym, datetime t, double &out_price[])
{
    if(sym == _Symbol)
    {
        // リプレイ中シンボルの最新値は 0 から直接取得可能
        return (CopyClose(sym, PERIOD_CURRENT, 0, 1, out_price) > 0);
    }
    else
    {
        // 他の標準シンボルは、リプレイの仮想現在時刻に対応するバー位置（shift）を探して取得
        int shift = iBarShift(sym, PERIOD_CURRENT, t, false);
        if(shift < 0) return false;
        return (CopyClose(sym, PERIOD_CURRENT, shift, 1, out_price) > 0);
    }
}

//+------------------------------------------------------------------+
//| BaseTime Calculation                                             |
//+------------------------------------------------------------------+
datetime GetBaseTime(datetime currentTime)
{
    MqlDateTime mdt;
    TimeToStruct(currentTime, mdt);

    if(lastDay == mdt.day && baseTerm == InpTermType && cachedBaseTime != 0)
        return cachedBaseTime;

    lastDay  = mdt.day;
    baseTerm = InpTermType;
    datetime baseT = 0;

    switch(InpTermType)
    {
        case TERM_CUSTOM:
            if(isFirstBar || cachedBaseTime == 0)
            {
                int bars = iBars(_Symbol, PERIOD_CURRENT);
                int lookback = MathMin(InpPeriods, bars - 1);
                if(lookback < 0) lookback = 0;
                datetime tempT = iTime(_Symbol, PERIOD_CURRENT, lookback);
                if(tempT > 0 && tempT != EMPTY_VALUE)
                {
                    baseT = tempT;
                    isFirstBar = false; // 正しい時間が裏で取得できてから、初めて起点をロックする
                }
            }
            else baseT = cachedBaseTime;
            break;
        case TERM_DAY:
            mdt.hour = 0; mdt.min = 0; mdt.sec = 0;
            baseT = StructToTime(mdt);
            break;
        case TERM_WEEK:
            mdt.hour = 0; mdt.min = 0; mdt.sec = 0;
            {
                datetime day_start = StructToTime(mdt);
                int diff = mdt.day_of_week - 1;
                if(diff < 0) diff = 6; 
                baseT = day_start - diff * 86400;
            }
            break;
        case TERM_MONTH:
            mdt.day = 1; mdt.hour = 0; mdt.min = 0; mdt.sec = 0;
            baseT = StructToTime(mdt);
            break;
        case TERM_YEAR:
            mdt.mon = 1; mdt.day = 1; mdt.hour = 0; mdt.min = 0; mdt.sec = 0;
            baseT = StructToTime(mdt);
            break;
    }
    return baseT;
}

//+------------------------------------------------------------------+
//| 同期処理に必要なヒストリカルデータ期間を動的に算出する軽量関数  |
//+------------------------------------------------------------------+
int GetRequiredPeriods()
{
    int check_req = 1000;
    if(InpTermType == TERM_CUSTOM) 
    {
        check_req = InpPeriods + CACHE_MARGIN;
    }
    else
    {
        datetime last_bar_time = iTime(_Symbol, PERIOD_CURRENT, 0);
        if(last_bar_time != 0)
        {
            datetime t_approx = GetBaseTime(last_bar_time);
            int shift = iBarShift(_Symbol, PERIOD_CURRENT, t_approx, false);
            if(shift > 0) check_req = shift + CACHE_MARGIN;
        }
    }
    return check_req;
}

//+------------------------------------------------------------------+
//| UI Label Display (8要素 バッチャー奇偶マージソートネットワークによる整列)  |
//+------------------------------------------------------------------+
struct LegendItem { string currency; double value; color clr; };
void DisplayLegend(double valCAD, double valNZD, double valCHF, double valAUD, double valGBP, double valEUR, double valJPY, double valUSD)
{
    LegendItem items[8];
    items[0].currency = "CAD"; items[0].value = valCAD; items[0].clr = ColorCAD;
    items[1].currency = "NZD"; items[1].value = valNZD; items[1].clr = ColorNZD;
    items[2].currency = "CHF"; items[2].value = valCHF; items[2].clr = ColorCHF;
    items[3].currency = "AUD"; items[3].value = valAUD; items[3].clr = ColorAUD;
    items[4].currency = "GBP"; items[4].value = valGBP; items[4].clr = ColorGBP;
    items[5].currency = "EUR"; items[5].value = valEUR; items[5].clr = ColorEUR;
    items[6].currency = "JPY"; items[6].value = valJPY; items[6].clr = ColorJPY;
    items[7].currency = "USD"; items[7].value = valUSD; items[7].clr = ColorUSD;

    // Batcher's Odd-Even Mergesort Network for 8 items (分岐ループ無しの完全インライン展開)
    #define SWAP_ITEMS(i, j) if(items[i].value < items[j].value) { LegendItem tmp = items[i]; items[i] = items[j]; items[j] = tmp; }
    SWAP_ITEMS(0, 1);
    SWAP_ITEMS(2, 3);
    SWAP_ITEMS(0, 2);
    SWAP_ITEMS(1, 3);
    SWAP_ITEMS(1, 2);
    SWAP_ITEMS(4, 5);
    SWAP_ITEMS(6, 7);
    SWAP_ITEMS(4, 6);
    SWAP_ITEMS(5, 7);
    SWAP_ITEMS(5, 6);
    SWAP_ITEMS(0, 4);
    SWAP_ITEMS(2, 6);
    SWAP_ITEMS(2, 4);
    SWAP_ITEMS(1, 5);
    SWAP_ITEMS(3, 7);
    SWAP_ITEMS(3, 5);
    SWAP_ITEMS(1, 2);
    SWAP_ITEMS(3, 4);
    SWAP_ITEMS(5, 6);
    #undef SWAP_ITEMS

    int y_base = 20, y_step = 16;
    for(int i = 0; i < 8; i++)
    {
        string objName = prefix + IntegerToString(i);
        double roundedValue = NormalizeDouble(items[i].value, 2);
        
        // オブジェクトがユーザー操作等で消されていたら即座に再作成
        if(ObjectFind(0, objName) < 0)
        {
            ObjectCreate(0, objName, OBJ_LABEL, 0, 0, 0);
            ObjectSetInteger(0, objName, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
            ObjectSetInteger(0, objName, OBJPROP_XDISTANCE, 20);
            ObjectSetInteger(0, objName, OBJPROP_YDISTANCE, y_base + i * y_step);
            ObjectSetInteger(0, objName, OBJPROP_FONTSIZE, 10);
            ObjectSetString(0, objName, OBJPROP_FONT, "Arial");
            ObjectSetInteger(0, objName, OBJPROP_SELECTABLE, false);
            ObjectSetInteger(0, objName, OBJPROP_HIDDEN, true);
            
            // 強制再描画のためにキャッシュをクリア
            lastLegendNames[i] = "";
            lastLegendValues[i] = EMPTY_VALUE;
            lastLegendColors[i] = clrNONE;
        }

        if(lastLegendNames[i] != items[i].currency || MathAbs(lastLegendValues[i] - roundedValue) > 0.0001)
        {
            string text = StringFormat("%s %.2f%%", items[i].currency, items[i].value);
            ObjectSetString(0, objName, OBJPROP_TEXT, text);
            lastLegendNames[i] = items[i].currency; lastLegendValues[i] = roundedValue;
        }

        if(lastLegendColors[i] != items[i].clr)
        {
            ObjectSetInteger(0, objName, OBJPROP_COLOR, items[i].clr);
            lastLegendColors[i] = items[i].clr;
        }
    }
}

//+------------------------------------------------------------------+
//| 一括同期処理 (表示に必要な最大期間に限定した O(N) 同期)             |
//+------------------------------------------------------------------+
bool AlignSymbolData(string sym, const datetime &main_time[], int rates_total, int start_idx, double &aligned_close[])
{
    datetime sec_time[];
    double   sec_close[];
    
    int count = rates_total - start_idx;
    
    int copied_t, copied_c;
    if(sym == _Symbol)
    {
        // リプレイ中のカスタムシンボル自身は、0番目から複製
        copied_t = CopyTime(sym, _Period, 0, count, sec_time);
        copied_c = CopyClose(sym, _Period, 0, count, sec_close);
    }
    else
    {
        // 他の標準シンボルは、リプレイチャートの表示時間範囲に合わせたヒストリカルデータをコピー
        copied_t = CopyTime(sym, _Period, main_time[start_idx], main_time[rates_total - 1], sec_time);
        copied_c = CopyClose(sym, _Period, main_time[start_idx], main_time[rates_total - 1], sec_close);
    }
    
    if(copied_t <= 0 || copied_c <= 0 || copied_t != copied_c)
    {
        return false;
    }
    
    if(ArraySize(aligned_close) < rates_total)
    {
        ArrayResize(aligned_close, rates_total, RESERVE_SIZE);
    }
    
    int main_idx = start_idx;
    int sec_idx = 0;
    double last_known_price = EMPTY_VALUE;
    
    while(main_idx < rates_total)
    {
        datetime t_target = main_time[main_idx];
        
        while(sec_idx < copied_t && sec_time[sec_idx] <= t_target)
        {
            last_known_price = sec_close[sec_idx];
            sec_idx++;
        }
        
        aligned_close[main_idx] = last_known_price;
        main_idx++;
    }
    
    return true;
}

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
    SetIndexBuffer(0, BufferCAD, INDICATOR_DATA); PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
    SetIndexBuffer(1, BufferNZD, INDICATOR_DATA); PlotIndexSetDouble(1, PLOT_EMPTY_VALUE, EMPTY_VALUE);
    SetIndexBuffer(2, BufferCHF, INDICATOR_DATA); PlotIndexSetDouble(2, PLOT_EMPTY_VALUE, EMPTY_VALUE);
    SetIndexBuffer(3, BufferAUD, INDICATOR_DATA); PlotIndexSetDouble(3, PLOT_EMPTY_VALUE, EMPTY_VALUE);
    SetIndexBuffer(4, BufferGBP, INDICATOR_DATA); PlotIndexSetDouble(4, PLOT_EMPTY_VALUE, EMPTY_VALUE);
    SetIndexBuffer(5, BufferEUR, INDICATOR_DATA); PlotIndexSetDouble(5, PLOT_EMPTY_VALUE, EMPTY_VALUE);
    SetIndexBuffer(6, BufferJPY, INDICATOR_DATA); PlotIndexSetDouble(6, PLOT_EMPTY_VALUE, EMPTY_VALUE);
    SetIndexBuffer(7, BufferUSD, INDICATOR_DATA); PlotIndexSetDouble(7, PLOT_EMPTY_VALUE, EMPTY_VALUE);

    DetectPrefixSuffix();
    SymUSDCHF = ResolveSymbol(InpSymUSDCHF, "USDCHF");
    SymEURUSD = ResolveSymbol(InpSymEURUSD, "EURUSD");
    SymGBPUSD = ResolveSymbol(InpSymGBPUSD, "GBPUSD");
    SymUSDJPY = ResolveSymbol(InpSymUSDJPY, "USDJPY");
    SymAUDUSD = ResolveSymbol(InpSymAUDUSD, "AUDUSD");
    SymNZDUSD = ResolveSymbol(InpSymNZDUSD, "NZDUSD");
    SymUSDCAD = ResolveSymbol(InpSymUSDCAD, "USDCAD");

    // バックグラウンドで同期ロードを開始するリクエスト
    int initial_req = GetRequiredPeriods();
    RequestData(SymUSDCHF, initial_req);
    RequestData(SymEURUSD, initial_req);
    RequestData(SymGBPUSD, initial_req);
    RequestData(SymUSDJPY, initial_req);
    RequestData(SymAUDUSD, initial_req);
    RequestData(SymNZDUSD, initial_req);
    RequestData(SymUSDCAD, initial_req);

    ColorCAD = (color)PlotIndexGetInteger(0, PLOT_LINE_COLOR);
    ColorNZD = (color)PlotIndexGetInteger(1, PLOT_LINE_COLOR);
    ColorCHF = (color)PlotIndexGetInteger(2, PLOT_LINE_COLOR);
    ColorAUD = (color)PlotIndexGetInteger(3, PLOT_LINE_COLOR);
    ColorGBP = (color)PlotIndexGetInteger(4, PLOT_LINE_COLOR);
    ColorEUR = (color)PlotIndexGetInteger(5, PLOT_LINE_COLOR);
    ColorJPY = (color)PlotIndexGetInteger(6, PLOT_LINE_COLOR);
    ColorUSD = (color)PlotIndexGetInteger(7, PLOT_LINE_COLOR);

    prefix = "KuChart_" + IntegerToString(ChartID()) + "_";
    
    cachedBaseTime = 0;
    isFirstBar = true;
    lastDay = -1;
    baseEURUSD = 0; baseUSDJPY = 0; baseGBPUSD = 0; baseAUDUSD = 0; baseUSDCHF = 0; baseNZDUSD = 0; baseUSDCAD = 0;
    
    log_baseEURUSD = 0; log_baseUSDJPY = 0; log_baseGBPUSD = 0; log_baseAUDUSD = 0; log_baseUSDCHF = 0; log_baseNZDUSD = 0; log_baseUSDCAD = 0;
    inv_baseEURUSD = 0; inv_baseUSDJPY = 0; inv_baseGBPUSD = 0; inv_baseAUDUSD = 0; inv_baseUSDCHF = 0; inv_baseNZDUSD = 0; inv_baseUSDCAD = 0;
    
    last_cur_e = 0; last_cur_j = 0; last_cur_g = 0; last_cur_a = 0; last_cur_c = 0; last_cur_n = 0; last_cur_d = 0;
    last_r_e = 0; last_r_j = 0; last_r_g = 0; last_r_a = 0; last_r_c = 0; last_r_n = 0; last_r_d = 0;

    for(int i = 0; i < 8; i++) 
    {
        lastLegendNames[i] = "";
        lastLegendValues[i] = EMPTY_VALUE;
        lastLegendColors[i] = clrNONE;
    }

    // オブジェクトの事前生成＆Y座標の固定設定（ObjectSetIntegerのティック呼び出し排除）
    int y_base = 20, y_step = 16;
    for(int i = 0; i < 8; i++)
    {
        string objName = prefix + IntegerToString(i);
        if(ObjectFind(0, objName) < 0)
        {
            ObjectCreate(0, objName, OBJ_LABEL, 0, 0, 0);
            ObjectSetInteger(0, objName, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
            ObjectSetInteger(0, objName, OBJPROP_XDISTANCE, 20);
            ObjectSetInteger(0, objName, OBJPROP_FONTSIZE, 10);
            ObjectSetString(0, objName, OBJPROP_FONT, "Arial");
            ObjectSetInteger(0, objName, OBJPROP_SELECTABLE, false);
            ObjectSetInteger(0, objName, OBJPROP_HIDDEN, true);
        }
        ObjectSetInteger(0, objName, OBJPROP_YDISTANCE, y_base + i * y_step);
        ObjectSetString(0, objName, OBJPROP_TEXT, "");
    }

    EventSetTimer(2);

    return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
    EventKillTimer();
    for(int i=0; i<8; i++) ObjectDelete(0, prefix + IntegerToString(i));
    
    // 動的配列のメモリを確実に解放
    ArrayFree(c_EURUSD);
    ArrayFree(c_USDJPY);
    ArrayFree(c_GBPUSD);
    ArrayFree(c_AUDUSD);
    ArrayFree(c_USDCHF);
    ArrayFree(c_NZDUSD);
    ArrayFree(c_USDCAD);
}

//+------------------------------------------------------------------+
//| OnTimer                                                          |
//+------------------------------------------------------------------+
void OnTimer()
{
    static int retries = 0;
    
    // すでに計算済みの場合は即座にタイマーを消滅させ、無駄な処理を一切行わない
    if(cachedBaseTime != 0) 
    {
        EventKillTimer();
        return;
    }
    
    int req = GetRequiredPeriods();
    
    if(IsSymbolsDataReadyWithDiagnostics(req))
    {
        // 土日・祝日（リアルティックが来ない時間帯）であっても確実に描画を実行するために
        // データの準備が整ったこの瞬間に限り、1度だけ安全にチャートをリフレッシュさせます。
        // リフレッシュ後に起動するOnCalculateでは、データが揃っているため即時描画されます。
        ChartSetSymbolPeriod(0, _Symbol, _Period);
        EventKillTimer();
    }
    else
    {
        retries++;
        if(retries > 15) 
        {
            Print("KuChartFastOpt [Warning]: 同期タイムアウト。");
            EventKillTimer();
        }
    }
}

//+------------------------------------------------------------------+
//| OnCalculate                                                          |
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
    if(rates_total < 2) return 0;

    // --- 同期チェック ---
    static uint last_check_time = 0;
    static bool was_ready = false;
    
    if(!was_ready)
    {
        if(last_check_time != 0 && GetTickCount() - last_check_time < 2000) return 0; 
        last_check_time = GetTickCount();
        
        int check_req = GetRequiredPeriods();
        if(!IsSymbolsDataReadyWithDiagnostics(check_req)) return 0;
        was_ready = true;
    }

    // --- 新バー検出 ＆ 最新ティック検出 ---
    static datetime last_bar_time = 0;
    datetime current_bar_time = time[rates_total - 1];
    bool is_new_bar = (current_bar_time != last_bar_time);

    // --- 設定に応じた間引き制御 ---
    static ulong last_calc_time = 0;
    ulong current_tick = GetTickCount64(); 
    uint throttle_ms = 0;
    
    if(InpThrottleMode == THROTTLE_AUTO)
    {
        ENUM_TIMEFRAMES tf = Period();
        if(tf == PERIOD_M1)      throttle_ms = 100;
        else if(tf == PERIOD_M5) throttle_ms = 500;
        else                     throttle_ms = 1000;
    }
    else if(InpThrottleMode == THROTTLE_CUSTOM)
    {
        throttle_ms = (uint)InpThrottleMs;
    }

    // ★「is_new_bar（新しいローソク足の最初のティック）」の時は間引きを完全バイパスする
    if(throttle_ms > 0 && !is_new_bar && last_bar_time != 0 && (current_tick - last_calc_time < throttle_ms))
    {
        return(rates_total); 
    }
    
    last_calc_time = current_tick;

    // CopyClose 一括取得によるオーバーヘッドの最小化
    double e_tmp[1], j_tmp[1], g_tmp[1], a_tmp[1], c_tmp[1], n_tmp[1], d_tmp[1];
    if(!CopyCloseAtTime(SymEURUSD, current_bar_time, e_tmp) ||
       !CopyCloseAtTime(SymUSDJPY, current_bar_time, j_tmp) ||
       !CopyCloseAtTime(SymGBPUSD, current_bar_time, g_tmp) ||
       !CopyCloseAtTime(SymAUDUSD, current_bar_time, a_tmp) ||
       !CopyCloseAtTime(SymUSDCHF, current_bar_time, c_tmp) ||
       !CopyCloseAtTime(SymNZDUSD, current_bar_time, n_tmp) ||
       !CopyCloseAtTime(SymUSDCAD, current_bar_time, d_tmp))
    {
        return(rates_total);
    }
    double curEURUSD = e_tmp[0];
    double curUSDJPY = j_tmp[0];
    double curGBPUSD = g_tmp[0];
    double curAUDUSD = a_tmp[0];
    double curUSDCHF = c_tmp[0];
    double curNZDUSD = n_tmp[0];
    double curUSDCAD = d_tmp[0];

    // いずれかの価格が EMPTY_VALUE または <=0（不正価格）の場合は計算をスキップして異常表示をガード
    if(curEURUSD <= 0 || curEURUSD == EMPTY_VALUE ||
       curUSDJPY <= 0 || curUSDJPY == EMPTY_VALUE ||
       curGBPUSD <= 0 || curGBPUSD == EMPTY_VALUE ||
       curAUDUSD <= 0 || curAUDUSD == EMPTY_VALUE ||
       curUSDCHF <= 0 || curUSDCHF == EMPTY_VALUE ||
       curNZDUSD <= 0 || curNZDUSD == EMPTY_VALUE ||
       curUSDCAD <= 0 || curUSDCAD == EMPTY_VALUE)
    {
        return(rates_total);
    }

    // 全ペアの価格が前回値と完全に一致している場合は早期リターン
    if(!is_new_bar && curEURUSD == last_cur_e && curUSDJPY == last_cur_j && curGBPUSD == last_cur_g &&
       curAUDUSD == last_cur_a && curUSDCHF == last_cur_c && curNZDUSD == last_cur_n && curUSDCAD == last_cur_d)
    {
        return(rates_total);
    }

    // --- 起点の変更検知 ---
    datetime currentTime = time[rates_total - 1];
    datetime newBaseTime = GetBaseTime(currentTime);
    bool base_time_changed = (cachedBaseTime != newBaseTime);

    // --- データ同期・過去バー再計算（初回 / 起点変化時 / 未初期化時のみ） ---
    if(prev_calculated == 0 || base_time_changed || cachedBaseTime == 0)
    {
        // 過去バッファ全体を EMPTY_VALUE で明示的に初期化して、古い領域に0の横線が描写されるのを防止
        ArrayInitialize(BufferCAD, EMPTY_VALUE);
        ArrayInitialize(BufferNZD, EMPTY_VALUE);
        ArrayInitialize(BufferCHF, EMPTY_VALUE);
        ArrayInitialize(BufferAUD, EMPTY_VALUE);
        ArrayInitialize(BufferGBP, EMPTY_VALUE);
        ArrayInitialize(BufferEUR, EMPTY_VALUE);
        ArrayInitialize(BufferJPY, EMPTY_VALUE);
        ArrayInitialize(BufferUSD, EMPTY_VALUE);

        // 過去バーの計算ループ回数を、表示に必要な期間に厳密に制限
        int req_bars = GetRequiredPeriods();
        int max_calc_bars = MathMin(rates_total - 1, req_bars); 
        int start_idx = (rates_total - 1) - max_calc_bars;
        if(start_idx < 0) start_idx = 0;

        if(!AlignSymbolData(SymEURUSD, time, rates_total, start_idx, c_EURUSD) ||
           !AlignSymbolData(SymUSDJPY, time, rates_total, start_idx, c_USDJPY) ||
           !AlignSymbolData(SymGBPUSD, time, rates_total, start_idx, c_GBPUSD) ||
           !AlignSymbolData(SymAUDUSD, time, rates_total, start_idx, c_AUDUSD) ||
           !AlignSymbolData(SymUSDCHF, time, rates_total, start_idx, c_USDCHF) ||
           !AlignSymbolData(SymNZDUSD, time, rates_total, start_idx, c_NZDUSD) ||
           !AlignSymbolData(SymUSDCAD, time, rates_total, start_idx, c_USDCAD))
        {
            was_ready = false;
            return 0;
        }

        if(ArraySize(c_EURUSD) < rates_total)
        {
            ArrayResize(c_EURUSD, rates_total, RESERVE_SIZE);
            ArrayResize(c_USDJPY, rates_total, RESERVE_SIZE);
            ArrayResize(c_GBPUSD, rates_total, RESERVE_SIZE);
            ArrayResize(c_AUDUSD, rates_total, RESERVE_SIZE);
            ArrayResize(c_USDCHF, rates_total, RESERVE_SIZE);
            ArrayResize(c_NZDUSD, rates_total, RESERVE_SIZE);
            ArrayResize(c_USDCAD, rates_total, RESERVE_SIZE);
        }

        if(base_time_changed || cachedBaseTime == 0)
        {
            double tmpEURUSD = GetBasePriceSafe(SymEURUSD, newBaseTime);
            double tmpUSDJPY = GetBasePriceSafe(SymUSDJPY, newBaseTime);
            double tmpGBPUSD = GetBasePriceSafe(SymGBPUSD, newBaseTime);
            double tmpAUDUSD = GetBasePriceSafe(SymAUDUSD, newBaseTime);
            double tmpUSDCHF = GetBasePriceSafe(SymUSDCHF, newBaseTime);
            double tmpNZDUSD = GetBasePriceSafe(SymNZDUSD, newBaseTime);
            double tmpUSDCAD = GetBasePriceSafe(SymUSDCAD, newBaseTime);
            
            if(tmpEURUSD == EMPTY_VALUE || tmpUSDJPY == EMPTY_VALUE || tmpGBPUSD == EMPTY_VALUE ||
               tmpAUDUSD == EMPTY_VALUE || tmpUSDCHF == EMPTY_VALUE || tmpNZDUSD == EMPTY_VALUE || tmpUSDCAD == EMPTY_VALUE)
            {
                lastDay = -1; 
                cachedBaseTime = 0; 
                isFirstBar = true; 
                was_ready = false;
                return 0; 
            }
            
            cachedBaseTime = newBaseTime;
            baseEURUSD = tmpEURUSD; baseUSDJPY = tmpUSDJPY; baseGBPUSD = tmpGBPUSD;
            baseAUDUSD = tmpAUDUSD; baseUSDCHF = tmpUSDCHF; baseNZDUSD = tmpNZDUSD; baseUSDCAD = tmpUSDCAD;
            
            log_baseEURUSD = MathLog(baseEURUSD);
            log_baseUSDJPY = MathLog(baseUSDJPY);
            log_baseGBPUSD = MathLog(baseGBPUSD);
            log_baseAUDUSD = MathLog(baseAUDUSD);
            log_baseUSDCHF = MathLog(baseUSDCHF);
            log_baseNZDUSD = MathLog(baseNZDUSD);
            log_baseUSDCAD = MathLog(baseUSDCAD);
            
            inv_baseEURUSD = (baseEURUSD > 0) ? 1.0 / baseEURUSD : 0;
            inv_baseUSDJPY = (baseUSDJPY > 0) ? 1.0 / baseUSDJPY : 0;
            inv_baseGBPUSD = (baseGBPUSD > 0) ? 1.0 / baseGBPUSD : 0;
            inv_baseAUDUSD = (baseAUDUSD > 0) ? 1.0 / baseAUDUSD : 0;
            inv_baseUSDCHF = (baseUSDCHF > 0) ? 1.0 / baseUSDCHF : 0;
            inv_baseNZDUSD = (baseNZDUSD > 0) ? 1.0 / baseNZDUSD : 0;
            inv_baseUSDCAD = (baseUSDCAD > 0) ? 1.0 / baseUSDCAD : 0;
        }

        // 過去の確定足（最末尾の未確定足を除く）のみ再計算してキャッシュへ配置
        for(int i = start_idx; i < rates_total - 1; i++)
        {
            if(time[i] < cachedBaseTime)
            {
                BufferCAD[i] = EMPTY_VALUE; BufferNZD[i] = EMPTY_VALUE; BufferCHF[i] = EMPTY_VALUE; BufferAUD[i] = EMPTY_VALUE;
                BufferGBP[i] = EMPTY_VALUE; BufferEUR[i] = EMPTY_VALUE; BufferJPY[i] = EMPTY_VALUE; BufferUSD[i] = EMPTY_VALUE;
                continue;
            }

            double cur_e = c_EURUSD[i];
            double cur_j = c_USDJPY[i];
            double cur_g = c_GBPUSD[i];
            double cur_a = c_AUDUSD[i];
            double cur_c = c_USDCHF[i];
            double cur_n = c_NZDUSD[i];
            double cur_d = c_USDCAD[i];

            if(cur_e <= 0 || cur_e == EMPTY_VALUE || cur_j <= 0 || cur_j == EMPTY_VALUE || cur_g <= 0 || cur_g == EMPTY_VALUE ||
               cur_a <= 0 || cur_a == EMPTY_VALUE || cur_c <= 0 || cur_c == EMPTY_VALUE || cur_n <= 0 || cur_n == EMPTY_VALUE ||
               cur_d <= 0 || cur_d == EMPTY_VALUE)
            {
                BufferCAD[i] = EMPTY_VALUE; BufferNZD[i] = EMPTY_VALUE; BufferCHF[i] = EMPTY_VALUE; BufferAUD[i] = EMPTY_VALUE;
                BufferGBP[i] = EMPTY_VALUE; BufferEUR[i] = EMPTY_VALUE; BufferJPY[i] = EMPTY_VALUE; BufferUSD[i] = EMPTY_VALUE;
                continue;
            }

            double r_EURUSD, r_USDJPY, r_GBPUSD, r_AUDUSD, r_USDCHF, r_NZDUSD, r_USDCAD;
            if(InpUseApproxReturn)
            {
                r_EURUSD = GetApproxReturnCached(cur_e, baseEURUSD, inv_baseEURUSD);
                r_USDJPY = GetApproxReturnCached(cur_j, baseUSDJPY, inv_baseUSDJPY);
                r_GBPUSD = GetApproxReturnCached(cur_g, baseGBPUSD, inv_baseGBPUSD);
                r_AUDUSD = GetApproxReturnCached(cur_a, baseAUDUSD, inv_baseAUDUSD);
                r_USDCHF = GetApproxReturnCached(cur_c, baseUSDCHF, inv_baseUSDCHF);
                r_NZDUSD = GetApproxReturnCached(cur_n, baseNZDUSD, inv_baseNZDUSD);
                r_USDCAD = GetApproxReturnCached(cur_d, baseUSDCAD, inv_baseUSDCAD);
            }
            else
            {
                r_EURUSD = GetLogReturnCached(cur_e, log_baseEURUSD);
                r_USDJPY = GetLogReturnCached(cur_j, log_baseUSDJPY);
                r_GBPUSD = GetLogReturnCached(cur_g, log_baseGBPUSD);
                r_AUDUSD = GetLogReturnCached(cur_a, log_baseAUDUSD);
                r_USDCHF = GetLogReturnCached(cur_c, log_baseUSDCHF);
                r_NZDUSD = GetLogReturnCached(cur_n, log_baseNZDUSD);
                r_USDCAD = GetLogReturnCached(cur_d, log_baseUSDCAD);
            }

            double S = -r_EURUSD - r_GBPUSD - r_AUDUSD - r_NZDUSD + r_USDJPY + r_USDCHF + r_USDCAD;
            double Pairs = 7.0;

            BufferUSD[i] = (S / Pairs) * InpMultipliedRange;
            BufferJPY[i] = ((S - 8.0 * r_USDJPY) / Pairs) * InpMultipliedRange;
            BufferEUR[i] = ((S + 8.0 * r_EURUSD) / Pairs) * InpMultipliedRange;
            BufferGBP[i] = ((S + 8.0 * r_GBPUSD) / Pairs) * InpMultipliedRange;
            BufferAUD[i] = ((S + 8.0 * r_AUDUSD) / Pairs) * InpMultipliedRange;
            BufferCHF[i] = ((S - 8.0 * r_USDCHF) / Pairs) * InpMultipliedRange;
            BufferNZD[i] = ((S + 8.0 * r_NZDUSD) / Pairs) * InpMultipliedRange;
            BufferCAD[i] = ((S - 8.0 * r_USDCAD) / Pairs) * InpMultipliedRange;
        }
        
        last_bar_time = current_bar_time;
        
        // 起動時ステートキャッシュの初期埋め
        last_cur_e = curEURUSD; last_cur_j = curUSDJPY; last_cur_g = curGBPUSD;
        last_cur_a = curAUDUSD; last_cur_c = curUSDCHF; last_cur_n = curNZDUSD; last_cur_d = curUSDCAD;
        
        if(InpUseApproxReturn)
        {
            last_r_e = GetApproxReturnCached(curEURUSD, baseEURUSD, inv_baseEURUSD);
            last_r_j = GetApproxReturnCached(curUSDJPY, baseUSDJPY, inv_baseUSDJPY);
            last_r_g = GetApproxReturnCached(curGBPUSD, baseGBPUSD, inv_baseGBPUSD);
            last_r_a = GetApproxReturnCached(curAUDUSD, baseAUDUSD, inv_baseAUDUSD);
            last_r_c = GetApproxReturnCached(curUSDCHF, baseUSDCHF, inv_baseUSDCHF);
            last_r_n = GetApproxReturnCached(curNZDUSD, baseNZDUSD, inv_baseNZDUSD);
            last_r_d = GetApproxReturnCached(curUSDCAD, baseUSDCAD, inv_baseUSDCAD);
        }
        else
        {
            last_r_e = GetLogReturnCached(curEURUSD, log_baseEURUSD);
            last_r_j = GetLogReturnCached(curUSDJPY, log_baseUSDJPY);
            last_r_g = GetLogReturnCached(curGBPUSD, log_baseGBPUSD);
            last_r_a = GetLogReturnCached(curAUDUSD, log_baseAUDUSD);
            last_r_c = GetLogReturnCached(curUSDCHF, log_baseUSDCHF);
            last_r_n = GetLogReturnCached(curNZDUSD, log_baseNZDUSD);
            last_r_d = GetLogReturnCached(curUSDCAD, log_baseUSDCAD);
        }
    }
    else if(is_new_bar)
    {
        // ★改良★ 新バー確定時の正確な確定足同期（1バーに1回しか走らないため超軽量）
        int prev_idx = rates_total - 2;
        
        if(ArraySize(c_EURUSD) < rates_total)
        {
            ArrayResize(c_EURUSD, rates_total, RESERVE_SIZE);
            ArrayResize(c_USDJPY, rates_total, RESERVE_SIZE);
            ArrayResize(c_GBPUSD, rates_total, RESERVE_SIZE);
            ArrayResize(c_AUDUSD, rates_total, RESERVE_SIZE);
            ArrayResize(c_USDCHF, rates_total, RESERVE_SIZE);
            ArrayResize(c_NZDUSD, rates_total, RESERVE_SIZE);
            ArrayResize(c_USDCAD, rates_total, RESERVE_SIZE);
        }
        
        // メモリのキャッシュ値ではなく、ターミナルが持つ「実際に確定した正確な終値」を同期他通貨から正確に再取得
        c_EURUSD[prev_idx] = GetPriceAtTime(SymEURUSD, time[prev_idx]);
        c_USDJPY[prev_idx] = GetPriceAtTime(SymUSDJPY, time[prev_idx]);
        c_GBPUSD[prev_idx] = GetPriceAtTime(SymGBPUSD, time[prev_idx]);
        c_AUDUSD[prev_idx] = GetPriceAtTime(SymAUDUSD, time[prev_idx]);
        c_USDCHF[prev_idx] = GetPriceAtTime(SymUSDCHF, time[prev_idx]);
        c_NZDUSD[prev_idx] = GetPriceAtTime(SymNZDUSD, time[prev_idx]);
        c_USDCAD[prev_idx] = GetPriceAtTime(SymUSDCAD, time[prev_idx]);

        // バグ修正：取得価格が EMPTY_VALUE だった場合のガード処理（縦線の巨大スパイクを防止）
        if(c_EURUSD[prev_idx] <= 0 || c_EURUSD[prev_idx] == EMPTY_VALUE ||
           c_USDJPY[prev_idx] <= 0 || c_USDJPY[prev_idx] == EMPTY_VALUE ||
           c_GBPUSD[prev_idx] <= 0 || c_GBPUSD[prev_idx] == EMPTY_VALUE ||
           c_AUDUSD[prev_idx] <= 0 || c_AUDUSD[prev_idx] == EMPTY_VALUE ||
           c_USDCHF[prev_idx] <= 0 || c_USDCHF[prev_idx] == EMPTY_VALUE ||
           c_NZDUSD[prev_idx] <= 0 || c_NZDUSD[prev_idx] == EMPTY_VALUE ||
           c_USDCAD[prev_idx] <= 0 || c_USDCAD[prev_idx] == EMPTY_VALUE)
        {
            BufferCAD[prev_idx] = EMPTY_VALUE; BufferNZD[prev_idx] = EMPTY_VALUE; BufferCHF[prev_idx] = EMPTY_VALUE; BufferAUD[prev_idx] = EMPTY_VALUE;
            BufferGBP[prev_idx] = EMPTY_VALUE; BufferEUR[prev_idx] = EMPTY_VALUE; BufferJPY[prev_idx] = EMPTY_VALUE; BufferUSD[prev_idx] = EMPTY_VALUE;
        }
        else
        {
            // 実際に確定した正確な終値から、100%正確なリターン値を算出（間引き中の価格ズレを完全リセット）
            double r_e, r_j, r_g, r_a, r_c, r_n, r_d;
            if(InpUseApproxReturn)
            {
                r_e = GetApproxReturnCached(c_EURUSD[prev_idx], baseEURUSD, inv_baseEURUSD);
                r_j = GetApproxReturnCached(c_USDJPY[prev_idx], baseUSDJPY, inv_baseUSDJPY);
                r_g = GetApproxReturnCached(c_GBPUSD[prev_idx], baseGBPUSD, inv_baseGBPUSD);
                r_a = GetApproxReturnCached(c_AUDUSD[prev_idx], baseAUDUSD, inv_baseAUDUSD);
                r_c = GetApproxReturnCached(c_USDCHF[prev_idx], baseUSDCHF, inv_baseUSDCHF);
                r_n = GetApproxReturnCached(c_NZDUSD[prev_idx], baseNZDUSD, inv_baseNZDUSD);
                r_d = GetApproxReturnCached(c_USDCAD[prev_idx], baseUSDCAD, inv_baseUSDCAD);
            }
            else
            {
                r_e = GetLogReturnCached(c_EURUSD[prev_idx], log_baseEURUSD);
                r_j = GetLogReturnCached(c_USDJPY[prev_idx], log_baseUSDJPY);
                r_g = GetLogReturnCached(c_GBPUSD[prev_idx], log_baseGBPUSD);
                r_a = GetLogReturnCached(c_AUDUSD[prev_idx], log_baseAUDUSD);
                r_c = GetLogReturnCached(c_USDCHF[prev_idx], log_baseUSDCHF);
                r_n = GetLogReturnCached(c_NZDUSD[prev_idx], log_baseNZDUSD);
                r_d = GetLogReturnCached(c_USDCAD[prev_idx], log_baseUSDCAD);
            }

            double S = -r_e - r_g - r_a - r_n + r_j + r_c + r_d;
            double Pairs = 7.0;

            BufferUSD[prev_idx] = (S / Pairs) * InpMultipliedRange;
            BufferJPY[prev_idx] = ((S - 8.0 * r_j) / Pairs) * InpMultipliedRange;
            BufferEUR[prev_idx] = ((S + 8.0 * r_e) / Pairs) * InpMultipliedRange;
            BufferGBP[prev_idx] = ((S + 8.0 * r_g) / Pairs) * InpMultipliedRange;
            BufferAUD[prev_idx] = ((S + 8.0 * r_a) / Pairs) * InpMultipliedRange;
            BufferCHF[prev_idx] = ((S - 8.0 * r_c) / Pairs) * InpMultipliedRange;
            BufferNZD[prev_idx] = ((S + 8.0 * r_n) / Pairs) * InpMultipliedRange;
            BufferCAD[prev_idx] = ((S - 8.0 * r_d) / Pairs) * InpMultipliedRange;
        }
        
        last_bar_time = current_bar_time;
    }

    // --- ティック更新計算 ---
    int last_idx = rates_total - 1;
    if(time[last_idx] >= cachedBaseTime)
    {
        double r_EURUSD, r_USDJPY, r_GBPUSD, r_AUDUSD, r_USDCHF, r_NZDUSD, r_USDCAD;

        // EURUSD
        if(curEURUSD == last_cur_e) r_EURUSD = last_r_e;
        else
        {
            r_EURUSD = InpUseApproxReturn ? GetApproxReturnCached(curEURUSD, baseEURUSD, inv_baseEURUSD) : GetLogReturnCached(curEURUSD, log_baseEURUSD);
            last_cur_e = curEURUSD; last_r_e = r_EURUSD;
        }

        // USDJPY
        if(curUSDJPY == last_cur_j) r_USDJPY = last_r_j;
        else
        {
            r_USDJPY = InpUseApproxReturn ? GetApproxReturnCached(curUSDJPY, baseUSDJPY, inv_baseUSDJPY) : GetLogReturnCached(curUSDJPY, log_baseUSDJPY);
            last_cur_j = curUSDJPY; last_r_j = r_USDJPY;
        }

        // GBPUSD
        if(curGBPUSD == last_cur_g) r_GBPUSD = last_r_g;
        else
        {
            r_GBPUSD = InpUseApproxReturn ? GetApproxReturnCached(curGBPUSD, baseGBPUSD, inv_baseGBPUSD) : GetLogReturnCached(curGBPUSD, log_baseGBPUSD);
            last_cur_g = curGBPUSD; last_r_g = r_GBPUSD;
        }

        // AUDUSD
        if(curAUDUSD == last_cur_a) r_AUDUSD = last_r_a;
        else
        {
            r_AUDUSD = InpUseApproxReturn ? GetApproxReturnCached(curAUDUSD, baseAUDUSD, inv_baseAUDUSD) : GetLogReturnCached(curAUDUSD, log_baseAUDUSD);
            last_cur_a = curAUDUSD; last_r_a = r_AUDUSD;
        }

        // USDCHF
        if(curUSDCHF == last_cur_c) r_USDCHF = last_r_c;
        else
        {
            r_USDCHF = InpUseApproxReturn ? GetApproxReturnCached(curUSDCHF, baseUSDCHF, inv_baseUSDCHF) : GetLogReturnCached(curUSDCHF, log_baseUSDCHF);
            last_cur_c = curUSDCHF; last_r_c = r_USDCHF;
        }

        // NZDUSD
        if(curNZDUSD == last_cur_n) r_NZDUSD = last_r_n;
        else
        {
            r_NZDUSD = InpUseApproxReturn ? GetApproxReturnCached(curNZDUSD, baseNZDUSD, inv_baseNZDUSD) : GetLogReturnCached(curNZDUSD, log_baseNZDUSD);
            last_cur_n = curNZDUSD; last_r_n = r_NZDUSD;
        }

        // USDCAD
        if(curUSDCAD == last_cur_d) r_USDCAD = last_r_d;
        else
        {
            r_USDCAD = InpUseApproxReturn ? GetApproxReturnCached(curUSDCAD, baseUSDCAD, inv_baseUSDCAD) : GetLogReturnCached(curUSDCAD, log_baseUSDCAD);
            last_cur_d = curUSDCAD; last_r_d = r_USDCAD;
        }

        double S = -r_EURUSD - r_GBPUSD - r_AUDUSD - r_NZDUSD + r_USDJPY + r_USDCHF + r_USDCAD;
        double Pairs = 7.0;

        BufferUSD[last_idx] = (S / Pairs) * InpMultipliedRange;
        BufferJPY[last_idx] = ((S - 8.0 * r_USDJPY) / Pairs) * InpMultipliedRange;
        BufferEUR[last_idx] = ((S + 8.0 * r_EURUSD) / Pairs) * InpMultipliedRange;
        BufferGBP[last_idx] = ((S + 8.0 * r_GBPUSD) / Pairs) * InpMultipliedRange;
        BufferAUD[last_idx] = ((S + 8.0 * r_AUDUSD) / Pairs) * InpMultipliedRange;
        BufferCHF[last_idx] = ((S - 8.0 * r_USDCHF) / Pairs) * InpMultipliedRange;
        BufferNZD[last_idx] = ((S + 8.0 * r_NZDUSD) / Pairs) * InpMultipliedRange;
        BufferCAD[last_idx] = ((S - 8.0 * r_USDCAD) / Pairs) * InpMultipliedRange;
    }
    else
    {
        BufferUSD[last_idx] = EMPTY_VALUE;
        BufferJPY[last_idx] = EMPTY_VALUE;
        BufferEUR[last_idx] = EMPTY_VALUE;
        BufferGBP[last_idx] = EMPTY_VALUE;
        BufferAUD[last_idx] = EMPTY_VALUE;
        BufferCHF[last_idx] = EMPTY_VALUE;
        BufferNZD[last_idx] = EMPTY_VALUE;
        BufferCAD[last_idx] = EMPTY_VALUE;
    }

    // --- レジェンド表示及び自動クリーンアップ ---
    static bool was_legend_displayed = false; // 無駄なオブジェクト検索・削除による毎ティック負荷を大幅削減
    if(InpIsDisplayCurrency)
    {
        int last_idx_lg = rates_total - 1;
        if(BufferUSD[last_idx_lg] != EMPTY_VALUE)
        {
            DisplayLegend(BufferCAD[last_idx_lg], BufferNZD[last_idx_lg], BufferCHF[last_idx_lg], 
                          BufferAUD[last_idx_lg], BufferGBP[last_idx_lg], BufferEUR[last_idx_lg], 
                          BufferJPY[last_idx_lg], BufferUSD[last_idx_lg]);
            was_legend_displayed = true;
        }
    }
    else if(was_legend_displayed)
    {
        for(int i = 0; i < 8; i++)
        {
            string objName = prefix + IntegerToString(i);
            if(ObjectFind(0, objName) >= 0)
            {
                ObjectDelete(0, objName);
            }
        }
        was_legend_displayed = false;
    }

    return(rates_total);
}

//+------------------------------------------------------------------+
//| OnChartEvent                                                     |
//+------------------------------------------------------------------+
void OnChartEvent(const int id,
                  const long &lparam,
                  const double &dparam,
                  const string &sparam)
{
    if(id == CHARTEVENT_KEYDOWN)
    {
        if(StringLen(InpRefreshKey) > 0)
        {
            string keyStr = InpRefreshKey;
            StringToUpper(keyStr);
            ushort targetKey = StringGetCharacter(keyStr, 0);
            
            if(lparam == targetKey)
            {
                Print("KuChartFastOpt: リフレッシュキー '", keyStr, "' が押されました。");
                
                cachedBaseTime = 0;
                isFirstBar = true;
                lastDay = -1;
                baseEURUSD = 0; baseUSDJPY = 0; baseGBPUSD = 0;
                baseAUDUSD = 0; baseUSDCHF = 0; baseNZDUSD = 0; baseUSDCAD = 0;
                
                log_baseEURUSD = 0; log_baseUSDJPY = 0; log_baseGBPUSD = 0;
                log_baseAUDUSD = 0; log_baseUSDCHF = 0; log_baseNZDUSD = 0; log_baseUSDCAD = 0;
                
                inv_baseEURUSD = 0; inv_baseUSDJPY = 0; inv_baseGBPUSD = 0;
                inv_baseAUDUSD = 0; inv_baseUSDCHF = 0; inv_baseNZDUSD = 0; inv_baseUSDCAD = 0;
                
                last_cur_e = 0; last_cur_j = 0; last_cur_g = 0;
                last_cur_a = 0; last_cur_c = 0; last_cur_n = 0; last_cur_d = 0;
                
                last_r_e = 0; last_r_j = 0; last_r_g = 0;
                last_r_a = 0; last_r_c = 0; last_r_n = 0; last_r_d = 0;
                
                for(int i = 0; i < 8; i++)
                {
                    lastLegendNames[i] = "";
                    lastLegendValues[i] = EMPTY_VALUE;
                    lastLegendColors[i] = clrNONE;
                    
                    string objName = prefix + IntegerToString(i);
                    ObjectSetString(0, objName, OBJPROP_TEXT, "");
                }

                ArrayInitialize(BufferCAD, EMPTY_VALUE);
                ArrayInitialize(BufferNZD, EMPTY_VALUE);
                ArrayInitialize(BufferCHF, EMPTY_VALUE);
                ArrayInitialize(BufferAUD, EMPTY_VALUE);
                ArrayInitialize(BufferGBP, EMPTY_VALUE);
                ArrayInitialize(BufferEUR, EMPTY_VALUE);
                ArrayInitialize(BufferJPY, EMPTY_VALUE);
                ArrayInitialize(BufferUSD, EMPTY_VALUE);
                
                ChartSetSymbolPeriod(0, _Symbol, _Period);
                ChartRedraw(0);
                EventSetTimer(2);
            }
        }
    }
}