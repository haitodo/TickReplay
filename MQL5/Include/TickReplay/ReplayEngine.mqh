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
   static bool EnsureConnected(bool sync_enabled, long &hCmd, long &hStatus, datetime &last_attempt)
   {
      if(!sync_enabled) return false;
      if(hCmd != INVALID_HANDLE_VALUE && hStatus != INVALID_HANDLE_VALUE) return true;
      
      datetime now = TimeLocal();
      if(now - last_attempt < 3) return false;
      last_attempt = now;
      
      Print("[Info] Named Pipe 接続を試行します。");
      return ConnectPipesCore(hCmd, hStatus);
   }

   static bool ConnectPipesCore(long &hCmd, long &hStatus)
   {
      CWin32Pipe::CloseHandleIfValid(hCmd);
      CWin32Pipe::CloseHandleIfValid(hStatus);

      string cmd_pipe = "\\\\.\\pipe\\replay_command";
      string status_pipe = "\\\\.\\pipe\\replay_status";

      hCmd = CreateFileW(cmd_pipe, GENERIC_READ, 0, 0, OPEN_EXISTING, 0, 0);
      hStatus = CreateFileW(status_pipe, GENERIC_WRITE, 0, 0, OPEN_EXISTING, 0, 0);

      if(hCmd != INVALID_HANDLE_VALUE && hStatus != INVALID_HANDLE_VALUE)
      {
         Print("[Info] Named Pipe 接続成功。");
         string init_status = StringFormat("{\"status\":\"CONNECTED\",\"symbol\":\"%s\",\"ea_version\":\"3.00\"}", _Symbol);
         CWin32Pipe::WriteData(hStatus, init_status + "\n");
         return true;
      }
      CWin32Pipe::CloseHandleIfValid(hCmd);
      CWin32Pipe::CloseHandleIfValid(hStatus);
      return false;
   }
};

#endif // __TICKREPLAY_REPLAYENGINE_MQH__
