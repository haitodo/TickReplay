//+------------------------------------------------------------------+
//|                                                VirtualTrader.mqh |
//|                                  Copyright 2026, Google DeepMind |
//|                     (仮想取引エンジン・損益＆指標計算モジュール) |
//+------------------------------------------------------------------+
#ifndef __TICKREPLAY_VIRTUALTRADER_MQH__
#define __TICKREPLAY_VIRTUALTRADER_MQH__

#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property strict

#include "Config.mqh"
#include "Win32Pipe.mqh"
#include "JsonHelper.mqh"
#include "TickBuffer.mqh"

//+------------------------------------------------------------------+
//| 仮想取引・口座管理統合クラス                                     |
//+------------------------------------------------------------------+
class CVirtualTrader
{
public:
   static double CalculateVirtualProfit(string symbol, ENUM_POSITION_TYPE type, double volume, double openPrice, double currentPrice, double contract_size)
   {
      double profit_val = 0.0;
      if(type == POSITION_TYPE_BUY)
      {
         profit_val = (currentPrice - openPrice) * volume * contract_size;
      }
      else
      {
         profit_val = (openPrice - currentPrice) * volume * contract_size;
      }
      
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

   static void CalculateVolatilityAndVolume(const MqlTick &all_ticks[], int total_ticks, int current_idx, string symbol, double &out_volatility, ulong &out_volume)
   {
      out_volatility = 0.0;
      out_volume = 0;
      if(current_idx <= 1 || total_ticks <= 0) return;
      
      long current_time_msc = all_ticks[current_idx - 1].time_msc;
      long start_time_msc = current_time_msc - 60000;
      
      double max_price = -1.0;
      double min_price = 999999.0;
      ulong vol_sum = 0;
      ulong tick_count = 0;
      
      for(int i = current_idx - 1; i >= 0; i--)
      {
         if(all_ticks[i].time_msc < start_time_msc) break;
            
         double price = all_ticks[i].bid;
         if(price > 0)
         {
            if(max_price < 0 || price > max_price) max_price = price;
            if(price < min_price) min_price = price;
         }
         
         vol_sum += all_ticks[i].volume;
         tick_count++;
      }
      
      if(max_price > 0 && min_price < 999999 && max_price > min_price)
      {
         double diff = max_price - min_price;
         double one_pip = (StringFind(symbol, "JPY") >= 0) ? 0.01 : 0.0001;
         out_volatility = diff / one_pip;
      }
      
      out_volume = (vol_sum > 0) ? vol_sum : tick_count;
   }
};

#endif // __TICKREPLAY_VIRTUALTRADER_MQH__
