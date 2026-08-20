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

//+------------------------------------------------------------------+
//| Custom indicator initialization function                         |
//+------------------------------------------------------------------+
int OnInit()
{
   DrawRoleBadge();
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
   DrawRoleBadge();
   return(rates_total);
}

//+------------------------------------------------------------------+
//| チャート上へのロールバッジ描画                                   |
//+------------------------------------------------------------------+
void DrawRoleBadge()
{
   string obj_name = OBJ_PREFIX + "BADGE";
   
   double spread_val = 0.0;
   MqlTick last_tick;
   if(SymbolInfoTick(_Symbol, last_tick))
   {
      double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
      int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
      double pip_unit = (digits == 3 || digits == 5) ? point * 10.0 : point;
      if(pip_unit > 0.0)
      {
         spread_val = (last_tick.ask - last_tick.bid) / pip_unit;
      }
   }
   
   string text = StringFormat("[ %s : %s | Spread: %.1f pips ]", InpRoleName, _Symbol, spread_val);
   
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
   
   ObjectSetString(0, obj_name, OBJPROP_TEXT, text);
}
