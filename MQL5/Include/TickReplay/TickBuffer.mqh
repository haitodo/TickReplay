//+------------------------------------------------------------------+
//|                                                   TickBuffer.mqh |
//|                                  Copyright 2026, Google DeepMind |
//|                     (ティックデータバッファ＆レート計算モジュール) |
//+------------------------------------------------------------------+
#ifndef __TICKREPLAY_TICKBUFFER_MQH__
#define __TICKREPLAY_TICKBUFFER_MQH__

#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property strict

#include "Config.mqh"

//+------------------------------------------------------------------+
//| ティックデータ管理＆擬似レート算出クラス                          |
//+------------------------------------------------------------------+
class CTickBuffer
{
public:
   // 四捨五入（ハーフアップ）
   static double RoundHalfUp(double value, int digits)
   {
      double factor = MathPow(10, digits);
      if(value >= 0.0)
         return MathFloor(value * factor + 0.5) / factor;
      else
         return MathCeil(value * factor - 0.5) / factor;
   }

   // 擬似レート・スプレッド計算
   static void GetPseudoRates(MqlTick &src_tick, double &out_bid, double &out_ask, double &out_spread,
                              bool pseudo_enabled, double base_spread, double threshold, double sensitivity)
   {
      double orig_bid = src_tick.bid;
      double orig_ask = src_tick.ask;
      double orig_spread = orig_ask - orig_bid;
      
      if(!pseudo_enabled)
      {
         out_bid = orig_bid;
         out_ask = orig_ask;
         out_spread = orig_spread;
         return;
      }
      
      if(orig_spread > threshold)
      {
         double excess = orig_spread - threshold;
         out_spread = base_spread + (excess * sensitivity);
      }
      else
      {
         out_spread = base_spread;
      }
      
      out_spread = RoundHalfUp(out_spread, 5);
      out_bid = orig_bid;
      out_ask = RoundHalfUp(out_bid + out_spread, 5);
   }

   // 前方インデックス検索
   static int FindTickIndexForward(const MqlTick &ticks[], int total_ticks, datetime target_time)
   {
      if(total_ticks <= 0) return -1;
      long target_msc = (long)target_time * 1000;
      
      int low = 0;
      int high = total_ticks - 1;
      int result = -1;
      
      while(low <= high)
      {
         int mid = low + (high - low) / 2;
         if((long)ticks[mid].time_msc >= target_msc)
         {
            result = mid;
            high = mid - 1;
         }
         else
         {
            low = mid + 1;
         }
      }
      return (result >= 0) ? result : total_ticks - 1;
   }

   // 後方インデックス検索
   static int FindTickIndexBackward(const MqlTick &ticks[], int total_ticks, datetime target_time)
   {
      if(total_ticks <= 0) return -1;
      long target_msc = (long)target_time * 1000;
      
      int low = 0;
      int high = total_ticks - 1;
      int result = -1;
      
      while(low <= high)
      {
         int mid = low + (high - low) / 2;
         if((long)ticks[mid].time_msc <= target_msc)
         {
            result = mid;
            low = mid + 1;
         }
         else
         {
            high = mid - 1;
         }
      }
      return (result >= 0) ? result : 0;
   }

   // ヒストリカルティックデータのロード
   static bool LoadHistoricalTicks(string source_symbol, datetime start, datetime end, MqlTick &out_ticks[], int &out_total_ticks)
   {
      Print("[Info] ティックデータ読み込み開始: ", source_symbol, " (", TimeToString(start), " -> ", TimeToString(end), ")");
      
      long from_msc = (long)start * 1000;
      long to_msc   = (long)end * 1000;
      
      ResetLastError();
      int fetched = CopyTicksRange(source_symbol, out_ticks, COPY_TICKS_ALL, from_msc, to_msc);
      
      if(fetched <= 0)
      {
         Print("[Error] CopyTicksRange 失敗. Code: ", GetLastError());
         out_total_ticks = 0;
         return false;
      }
      
      out_total_ticks = fetched;
      Print("[Success] ティックデータ読み込み完了. 件数: ", out_total_ticks);
      return true;
   }
};

#endif // __TICKREPLAY_TICKBUFFER_MQH__
