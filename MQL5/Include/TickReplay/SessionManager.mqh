//+------------------------------------------------------------------+
//|                                               SessionManager.mqh |
//|                                  Copyright 2026, Google DeepMind |
//|                     (取引セッション・サマータイム判定モジュール) |
//+------------------------------------------------------------------+
#ifndef __TICKREPLAY_SESSIONMANAGER_MQH__
#define __TICKREPLAY_SESSIONMANAGER_MQH__

#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property strict

#include "Config.mqh"
#include "JsonHelper.mqh"

//+------------------------------------------------------------------+
//| セッション判定＆サマータイム管理クラス                            |
//+------------------------------------------------------------------+
class CSessionManager
{
public:
   static bool IsSummerTimeEurope(datetime dt)
   {
      MqlDateTime mdt;
      TimeToStruct(dt, mdt);
      if(mdt.mon < 3 || mdt.mon > 10) return false;
      if(mdt.mon > 3 && mdt.mon < 10) return true;
      if(mdt.mon == 3)
      {
         int last_sunday = 31 - ((mdt.day_of_week + 31 - mdt.day) % 7);
         if(mdt.day > last_sunday) return true;
         if(mdt.day == last_sunday && mdt.hour >= 1) return true;
         return false;
      }
      if(mdt.mon == 10)
      {
         int last_sunday = 31 - ((mdt.day_of_week + 31 - mdt.day) % 7);
         if(mdt.day < last_sunday) return true;
         if(mdt.day == last_sunday && mdt.hour < 1) return true;
         return false;
      }
      return false;
   }

   static bool IsSummerTimeUS(datetime dt)
   {
      MqlDateTime mdt;
      TimeToStruct(dt, mdt);
      if(mdt.mon < 3 || mdt.mon > 11) return false;
      if(mdt.mon > 3 && mdt.mon < 11) return true;
      if(mdt.mon == 3)
      {
         int second_sunday = 14 - ((mdt.day_of_week + 14 - mdt.day) % 7);
         if(mdt.day > second_sunday) return true;
         if(mdt.day == second_sunday && mdt.hour >= 2) return true;
         return false;
      }
      if(mdt.mon == 11)
      {
         int first_sunday = 7 - ((mdt.day_of_week + 7 - mdt.day) % 7);
         if(mdt.day < first_sunday) return true;
         if(mdt.day == first_sunday && mdt.hour < 2) return true;
         return false;
      }
      return false;
   }

   static void ParseTimeStrings(string time_str, int &out_hour, int &out_min)
   {
      out_hour = 0; out_min = 0;
      int colon = StringFind(time_str, ":");
      if(colon > 0)
      {
         out_hour = (int)StringToInteger(StringSubstr(time_str, 0, colon));
         out_min  = (int)StringToInteger(StringSubstr(time_str, colon + 1));
      }
   }

   static datetime AddDays(datetime time_val, int days)
   {
      return time_val + (datetime)(days * 86400);
   }

   static datetime GetSessionStartForDate(datetime date_val, string session, string tyo, string ldn_sum, string ldn_win, string ny_sum, string ny_win)
   {
      MqlDateTime mdt;
      TimeToStruct(date_val, mdt);
      mdt.hour = 0; mdt.min = 0; mdt.sec = 0;
      datetime day_start = StructToTime(mdt);
      
      int h = 0, m = 0;
      if(session == "TYO")
      {
         ParseTimeStrings(tyo, h, m);
      }
      else if(session == "LDN")
      {
         bool is_summer = IsSummerTimeEurope(date_val);
         ParseTimeStrings(is_summer ? ldn_sum : ldn_win, h, m);
      }
      else if(session == "NY")
      {
         bool is_summer = IsSummerTimeUS(date_val);
         ParseTimeStrings(is_summer ? ny_sum : ny_win, h, m);
      }
      
      return day_start + (h * 3600) + (m * 60);
   }

   static datetime FindPreviousSessionStart(datetime current_time, string session, string tyo, string ldn_sum, string ldn_win, string ny_sum, string ny_win)
   {
      datetime today_start = GetSessionStartForDate(current_time, session, tyo, ldn_sum, ldn_win, ny_sum, ny_win);
      if(current_time > today_start + 5)
      {
         return today_start;
      }
      
      for(int i = 1; i <= 10; i++)
      {
         datetime prev_date = AddDays(current_time, -i);
         MqlDateTime mdt;
         TimeToStruct(prev_date, mdt);
         if(mdt.day_of_week == 0 || mdt.day_of_week == 6) continue; // 土日はスキップ
         
         return GetSessionStartForDate(prev_date, session, tyo, ldn_sum, ldn_win, ny_sum, ny_win);
      }
      return current_time;
   }

   static datetime FindNextSessionStart(datetime current_time, string session, string tyo, string ldn_sum, string ldn_win, string ny_sum, string ny_win)
   {
      datetime today_start = GetSessionStartForDate(current_time, session, tyo, ldn_sum, ldn_win, ny_sum, ny_win);
      if(current_time < today_start - 5)
      {
         return today_start;
      }
      
      for(int i = 1; i <= 10; i++)
      {
         datetime next_date = AddDays(current_time, i);
         MqlDateTime mdt;
         TimeToStruct(next_date, mdt);
         if(mdt.day_of_week == 0 || mdt.day_of_week == 6) continue; // 土日はスキップ
         
         return GetSessionStartForDate(next_date, session, tyo, ldn_sum, ldn_win, ny_sum, ny_win);
      }
      return current_time;
   }
};

#endif // __TICKREPLAY_SESSIONMANAGER_MQH__
