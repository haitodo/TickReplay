//+------------------------------------------------------------------+
//|                                       TickReplayRoleMarker.mq5   |
//|                                  Copyright 2026, Google DeepMind |
//|                                           https://deepmind.google |
//|                     (TickReplay サブチャート識別＆ウォーターマーク)  |
//+------------------------------------------------------------------+
#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property version   "1.00"
#property indicator_chart_window
#property indicator_plots 0

//--- Input パラメータ
input string InpRoleName    = "SUB (Reference)"; // チャート役割表示名
input color  InpTextColor   = clrDeepSkyBlue;    // バッジテキスト色
input int    InpFontSize    = 9;                 // フォントサイズ
input int    InpCorner      = 1;                 // 表示位置 (1 = 右上)
input int    InpXOffset     = 10;                // Xオフセット
input int    InpYOffset     = 25;                // Yオフセット

#define OBJ_PREFIX "TR_ROLE_"

double g_pip_unit = 0.0;
int    g_digits   = 5;
ulong  g_last_draw_ms = 0;
double g_last_bid = 0.0;
double g_last_ask = 0.0;

//+------------------------------------------------------------------+
//| Custom indicator initialization function                         |
//+------------------------------------------------------------------+
int OnInit()
{
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   g_digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   if(g_digits <= 0) g_digits = _Digits;
   g_pip_unit = (g_digits == 3 || g_digits == 5) ? point * 10.0 : point;
   g_last_draw_ms = 0;
   DrawRoleBadge(true);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Custom indicator deinitialization function                       |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
}

//+------------------------------------------------------------------+
//| Custom indicator iteration function                              |
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
   DrawRoleBadge(false);
   return(rates_total);
}

//+------------------------------------------------------------------+
//| チャート上へのロールバッジ描画                                   |
//+------------------------------------------------------------------+
void DrawRoleBadge(const bool force = false)
{
   ulong now_ms = GetTickCount64();
   if(!force && g_last_draw_ms > 0 && (now_ms - g_last_draw_ms < 250))
      return;

   string obj_name = OBJ_PREFIX + "BADGE";
   
   if(ObjectFind(0, obj_name) < 0)
   {
      ObjectCreate(0, obj_name, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, obj_name, OBJPROP_CORNER, InpCorner);
      ObjectSetInteger(0, obj_name, OBJPROP_XDISTANCE, InpXOffset);
      ObjectSetInteger(0, obj_name, OBJPROP_YDISTANCE, InpYOffset);
      ObjectSetInteger(0, obj_name, OBJPROP_FONTSIZE, InpFontSize);
      ObjectSetString(0, obj_name, OBJPROP_FONT, "Segoe UI");
      ObjectSetInteger(0, obj_name, OBJPROP_COLOR, InpTextColor);
      ObjectSetInteger(0, obj_name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, obj_name, OBJPROP_BACK, false);
   }
   
   string final_text = "";
   MqlTick tick;
   if(SymbolInfoTick(_Symbol, tick))
   {
      if(!force && tick.bid == g_last_bid && tick.ask == g_last_ask && g_last_draw_ms > 0)
         return;
      g_last_bid = tick.bid;
      g_last_ask = tick.ask;
      double s_val = (g_pip_unit > 0.0) ? (tick.ask - tick.bid) / g_pip_unit : 0.0;
      final_text = StringFormat("[ %s : %s | Bid: %.*f Ask: %.*f | Spread: %.1f pips ]", InpRoleName, _Symbol, g_digits, tick.bid, g_digits, tick.ask, s_val);
   }
   else
   {
      if(!force && g_last_draw_ms > 0)
         return;
      final_text = StringFormat("[ %s : %s ]", InpRoleName, _Symbol);
   }
   
   g_last_draw_ms = now_ms;
   ObjectSetString(0, obj_name, OBJPROP_TEXT, final_text);
}
