//+------------------------------------------------------------------+
//|                                                 ReplayEngine.mqh |
//|                                  Copyright 2026, Google DeepMind |
//|                     (リプレイ再生制御＆メインエンジンモジュール)   |
//+------------------------------------------------------------------+
#ifndef __TICKREPLAY_REPLAYENGINE_MQH__
#define __TICKREPLAY_REPLAYENGINE_MQH__

#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property strict

#include "Config.mqh"
#include "Win32Pipe.mqh"
#include "JsonHelper.mqh"
#include "SessionManager.mqh"
#include "TickBuffer.mqh"
#include "SymbolManager.mqh"
#include "ChartManager.mqh"
#include "VirtualTrader.mqh"

//+------------------------------------------------------------------+
//| リプレイ再生エンジンクラス                                       |
//+------------------------------------------------------------------+
class CReplayEngine
{
public:
   // パイプ接続の生存確認
   static bool EnsureConnected(bool sync_enabled, long &hPipe, datetime &last_attempt)
   {
      if(!sync_enabled) return false;
      if(hPipe != INVALID_HANDLE_VALUE) return true;
      
      datetime now = TimeLocal();
      if(now - last_attempt < 2) return false;
      last_attempt = now;
      
      Print("[Info] Named Pipe 接続を試行します。");
      return ConnectPipesCore(hPipe);
   }

   static bool ConnectPipesCore(long &hPipe)
   {
      CWin32Pipe::CloseHandleIfValid(hPipe);

      string pipe_name = "\\\\.\\pipe\\tick_replay_ipc";

      hPipe = CreateFileW(pipe_name, GENERIC_READ | GENERIC_WRITE, 0, 0, OPEN_EXISTING, 0, 0);

      if(hPipe != INVALID_HANDLE_VALUE)
      {
         Print("[Info] Named Pipe 接続成功。");
         string init_status = StringFormat("{\"status\":\"CONNECTED\",\"symbol\":\"%s\",\"ea_version\":\"3.00\"}", _Symbol);
         CWin32Pipe::WriteData(hPipe, init_status + "\n");
         return true;
      }
      CWin32Pipe::CloseHandleIfValid(hPipe);
      return false;
   }
};

#endif // __TICKREPLAY_REPLAYENGINE_MQH__
