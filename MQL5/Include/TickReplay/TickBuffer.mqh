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
      datetime jst_time = CSessionManager::IsSummerTimeUS(src_tick.time) ? src_tick.time + 6 * 3600 : src_tick.time + 7 * 3600;
      TimeToStruct(jst_time, dt);
      int hour = dt.hour;
      int min  = dt.min;
      int day  = dt.day;
      int dow  = dt.day_of_week;
      
      double eff_base = base_spread;
      double eff_thresh = threshold;
      
      // 仲値制御 (平日 9:53〜09:55:30 JST / 実測データ準拠)
      if(dow >= 1 && dow <= 5 && hour == 9)
      {
         bool is_gotobi = (day % 5 == 0);
         if(dow == 5 && ((day + 1) % 5 == 0 || (day + 2) % 5 == 0)) is_gotobi = true;
         
         if(min == 54)
         {
            eff_base = is_gotobi ? 0.010 : 0.008; // 09:54 ピーク: 0.8銭 / 実質ゴトー日 1.0銭
         }
         else if(min == 55 && dt.sec < 30)
         {
            eff_base = is_gotobi ? 0.007 : 0.005; // 09:55:00〜29 収束帯: 0.5銭 / 実質ゴトー日 0.7銭
         }
         else if(min == 53 && dt.sec < 30)
         {
            eff_base = 0.004; // 09:53 事前動意: 0.4銭
         }
      }
      // 早朝ロールオーバー (実測データ準拠: 夏 05:50〜07:14 / 冬 06:50〜08:14 JST)
      else
      {
         int roll_hour = CSessionManager::IsSummerTimeUS(src_tick.time) ? 6 : 7;
         int pre_hour = roll_hour - 1;
         
         if(hour == pre_hour && min >= 50)
         {
            double prog = (double)(min - 50) / 10.0;
            eff_base = 0.005 + 0.010 * prog; // 05:50〜: 0.5〜1.5銭
         }
         else if(hour == roll_hour)
         {
            if(min <= 5)
            {
               eff_base = 0.065; // ロールオーバー直後スパイク (平均6.5銭)
               eff_thresh = threshold * 5.0;
            }
            else
            {
               eff_base = 0.035; // 早朝ワイド帯 (3.5銭)
               eff_thresh = threshold * 3.0;
            }
         }
         else if(hour == roll_hour + 1 && min < 10)
         {
            eff_base = 0.035; // 07:00〜07:09: 3.5銭維持
            eff_thresh = threshold * 3.0;
         }
         else if(hour == roll_hour + 1 && min < 15)
         {
            double prog = (double)(min - 10) / 5.0;
            eff_base = 0.035 - (0.035 - 0.002) * prog; // 07:10〜07:14: 3.5銭から急減衰
         }
      }
      
      double target_spread = eff_base;
      if(orig_spread > eff_thresh)
      {
         target_spread = eff_base + sensitivity * (orig_spread - eff_thresh);
      }
      
      double max_limit = base_spread * 80.0;
      if(target_spread > max_limit) target_spread = max_limit;
      
      // ① target_spread を先に3桁精度で丸める（0.001単位にスナップ）
      //    → bid/askを独立に丸めると端数の向きが逆転して0.3銭に化ける問題を根絶
      double target_rounded = MathFloor(target_spread * 1000.0 + 0.5 + 1e-9) / 1000.0;
      // ② 丸めで base_spread を下回った場合はベース値に切り上げ
      if(target_rounded < base_spread) target_rounded = base_spread;
      
      // ③ bidを丸めてから ask = bid + target_rounded で固定（独立丸め禁止）
      out_bid = RoundHalfUp(mid - target_rounded / 2.0, 3);
      out_ask = NormalizeDouble(out_bid + target_rounded, 3);
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
