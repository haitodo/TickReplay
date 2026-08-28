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
      static int cached_digits = -1;
      static double cached_factor = 100000.0;
      double factor;
      if(digits == 5)
      {
         factor = 100000.0;
      }
      else if(digits == cached_digits)
      {
         factor = cached_factor;
      }
      else
      {
         factor = MathPow(10, digits);
         cached_digits = digits;
         cached_factor = factor;
      }

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
      if(orig_bid <= 0) orig_bid = src_tick.last;
      if(orig_ask <= 0) orig_ask = src_tick.last;
      double orig_spread = orig_ask - orig_bid;
      
      if(!pseudo_enabled || orig_bid <= 0 || orig_ask <= 0 || orig_bid == orig_ask)
      {
         out_bid = orig_bid;
         out_ask = orig_ask;
         out_spread = orig_spread;
         return;
      }
      
      double mid = (orig_bid + orig_ask) / 2.0;
      
      MqlDateTime dt;
      TimeToStruct(src_tick.time, dt);
      int hour = dt.hour;
      int min  = dt.min;
      
      double eff_base = base_spread;
      double eff_thresh = threshold;
      
      // 早朝ロールオーバー
      if(hour == 6)
      {
         eff_base = base_spread * 17.5;
         eff_thresh = threshold * 5.5;
      }
      // 早朝復帰帯
      else if(hour == 7 && min < 15)
      {
         double roll_base = base_spread * 17.5;
         eff_base = roll_base - (roll_base - base_spread) * (min / 15.0);
         eff_thresh = threshold * 3.0;
      }
      
      double target_spread = eff_base;
      if(orig_spread > eff_thresh)
      {
         target_spread = eff_base + sensitivity * (orig_spread - eff_thresh);
      }
      
      double max_limit = base_spread * 80.0;
      if(target_spread > max_limit) target_spread = max_limit;
      
      double half_spread = target_spread / 2.0;
      out_bid = RoundHalfUp(mid - half_spread, 3);
      out_ask = RoundHalfUp(mid + half_spread, 3);
      out_spread = out_ask - out_bid;
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
