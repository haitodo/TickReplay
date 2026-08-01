//+------------------------------------------------------------------+
//|                                                   JsonHelper.mqh |
//|                                  Copyright 2026, Google DeepMind |
//|                        (軽量・高速 JSON パース＆操作モジュール)   |
//+------------------------------------------------------------------+
#ifndef __TICKREPLAY_JSONHELPER_MQH__
#define __TICKREPLAY_JSONHELPER_MQH__

#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property strict

#include "Config.mqh"

//+------------------------------------------------------------------+
//| JSONパースユーティリティクラス                                   |
//+------------------------------------------------------------------+
class CJsonHelper
{
public:
   static string GetJsonKeyValue(string json, string key)
   {
      string search_key = "\"" + key + "\":";
      int pos = StringFind(json, search_key);
      if(pos < 0) return "";
      
      int start = pos + StringLen(search_key);
      while(start < StringLen(json) && (StringSubstr(json, start, 1) == " " || StringSubstr(json, start, 1) == "\t"))
      {
         start++;
      }
      
      if(start >= StringLen(json)) return "";
      
      string first_char = StringSubstr(json, start, 1);
      if(first_char == "\"")
      {
         int end_quote = StringFind(json, "\"", start + 1);
         if(end_quote > start)
         {
            return StringSubstr(json, start + 1, end_quote - start - 1);
         }
      }
      else
      {
         int end_pos = start;
         while(end_pos < StringLen(json))
         {
            string ch = StringSubstr(json, end_pos, 1);
            if(ch == "," || ch == "}" || ch == "]" || ch == "\n" || ch == "\r")
               break;
            end_pos++;
         }
         string val = StringSubstr(json, start, end_pos - start);
         StringTrimLeft(val);
         StringTrimRight(val);
         return val;
      }
      return "";
   }

   static string GetJsonString(string json, string key)
   {
      return GetJsonKeyValue(json, key);
   }

   static double GetJsonDouble(string json, string key)
   {
      string val = GetJsonKeyValue(json, key);
      if(val == "") return 0.0;
      return StringToDouble(val);
   }

   static bool GetJsonBool(string json, string key)
   {
      string val = GetJsonKeyValue(json, key);
      return (val == "true" || val == "1");
   }

   static string EscapeJsonString(string str)
   {
      string res = str;
      StringReplace(res, "\\", "\\\\");
      StringReplace(res, "\"", "\\\"");
      StringReplace(res, "\n", "\\n");
      StringReplace(res, "\r", "\\r");
      StringReplace(res, "\t", "\\t");
      return res;
   }

   static datetime ParseDateTime(string dt_str)
   {
      if(dt_str == "") return 0;
      string s = dt_str;
      StringReplace(s, "T", " ");
      StringReplace(s, "Z", "");
      int dot_pos = StringFind(s, ".");
      if(dot_pos > 0)
      {
         s = StringSubstr(s, 0, dot_pos);
      }
      return StringToTime(s);
   }

   static string FormatCalendarValue(long value, int digits, ENUM_CALENDAR_EVENT_UNIT unit, string currency)
   {
      if(value == LONG_MIN || value == LONG_MAX || value == 0) return "-";
      
      double val = (double)value / MathPow(10.0, digits);
      string str_val = DoubleToString(val, digits);
      
      if(unit == CALENDAR_UNIT_PERCENT)
         return str_val + "%";
      else if(unit == CALENDAR_UNIT_CURRENCY && currency != "")
         return str_val + " " + currency;
         
      return str_val;
   }
};

#endif // __TICKREPLAY_JSONHELPER_MQH__
