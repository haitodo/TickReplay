//+------------------------------------------------------------------+
//|                                                 ChartManager.mqh |
//|                                  Copyright 2026, Google DeepMind |
//|                     (MTFチャート作成・レイアウト・描画管理モジュール)|
//+------------------------------------------------------------------+
#ifndef __TICKREPLAY_CHARTMANAGER_MQH__
#define __TICKREPLAY_CHARTMANAGER_MQH__

#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property strict

#include "Config.mqh"
#include "Win32Pipe.mqh"

//+------------------------------------------------------------------+
//| チャート作成＆レイアウト統合クラス                              |
//+------------------------------------------------------------------+
class CChartManager
{
public:
   static ENUM_TIMEFRAMES GetTimeframeFromPeriod(int p_type, int p_size)
   {
      if(p_type == 0)
      {
         switch(p_size)
         {
            case 1:  return(PERIOD_M1);
            case 2:  return(PERIOD_M2);
            case 3:  return(PERIOD_M3);
            case 4:  return(PERIOD_M4);
            case 5:  return(PERIOD_M5);
            case 6:  return(PERIOD_M6);
            case 10: return(PERIOD_M10);
            case 12: return(PERIOD_M12);
            case 15: return(PERIOD_M15);
            case 20: return(PERIOD_M20);
            case 30: return(PERIOD_M30);
         }
      }
      else if(p_type == 1)
      {
         switch(p_size)
         {
            case 1:  return(PERIOD_H1);
            case 2:  return(PERIOD_H2);
            case 3:  return(PERIOD_H3);
            case 4:  return(PERIOD_H4);
            case 6:  return(PERIOD_H6);
            case 8:  return(PERIOD_H8);
            case 12: return(PERIOD_H12);
            case 24: return(PERIOD_D1);
         }
      }
      else if(p_type == 2)
      {
         if(p_size == 1) return(PERIOD_W1);
      }
      else if(p_type == 3)
      {
         if(p_size == 1) return(PERIOD_MN1);
      }
      return(PERIOD_M1);
   }

   static ENUM_TIMEFRAMES SecondsToTimeframe(int seconds)
   {
      if(seconds >= 2592000) return(PERIOD_MN1);
      if(seconds >= 604800)  return(PERIOD_W1);
      if(seconds >= 86400)   return(PERIOD_D1);
      if(seconds >= 43200)   return(PERIOD_H12);
      if(seconds >= 28800)   return(PERIOD_H8);
      if(seconds >= 21600)   return(PERIOD_H6);
      if(seconds >= 14400)   return(PERIOD_H4);
      if(seconds >= 10800)   return(PERIOD_H3);
      if(seconds >= 7200)    return(PERIOD_H2);
      if(seconds >= 3600)    return(PERIOD_H1);
      if(seconds >= 1800)    return(PERIOD_M30);
      if(seconds >= 1200)    return(PERIOD_M20);
      if(seconds >= 900)     return(PERIOD_M15);
      if(seconds >= 720)     return(PERIOD_M12);
      if(seconds >= 600)     return(PERIOD_M10);
      if(seconds >= 360)     return(PERIOD_M6);
      if(seconds >= 300)     return(PERIOD_M5);
      if(seconds >= 240)     return(PERIOD_M4);
      if(seconds >= 180)     return(PERIOD_M3);
      if(seconds >= 120)     return(PERIOD_M2);
      return(PERIOD_M1);
   }

   static void CleanTempTemplates()
   {
      string filename;
      long search_handle = FileFindFirst("replay-chart-temp\\*", filename);
      if(search_handle == INVALID_HANDLE) return;
      FileFindClose(search_handle);
      
      search_handle = FileFindFirst("replay-chart-temp\\*.tpl", filename);
      if(search_handle != INVALID_HANDLE)
      {
         do
         {
            string temp_tpl_path = "replay-chart-temp\\" + filename;
            FileDelete(temp_tpl_path);
         } while(FileFindNext(search_handle, filename));
         FileFindClose(search_handle);
      }
      FolderDelete("replay-chart-temp");
   }
};

#endif // __TICKREPLAY_CHARTMANAGER_MQH__
