//+------------------------------------------------------------------+
//|                                                    Win32Pipe.mqh |
//|                                  Copyright 2026, Google DeepMind |
//|                     (Win32 API 名前付きパイプ通信モジュール)      |
//+------------------------------------------------------------------+
#ifndef __TICKREPLAY_WIN32PIPE_MQH__
#define __TICKREPLAY_WIN32PIPE_MQH__

#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property strict

#include "Config.mqh"

//--- Win32 API Named Pipe インポート
#import "kernel32.dll"
long CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, long lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, long hTemplateFile);
int WriteFile(long hFile, uchar &lpBuffer[], uint nNumberOfBytesToWrite, uint &lpNumberOfBytesRead, long lpOverlapped);
int ReadFile(long hFile, uchar &lpBuffer[], uint nNumberOfBytesToRead, uint &lpNumberOfBytesRead, long lpOverlapped);
int PeekNamedPipe(long hNamedPipe, long lpBuffer, uint nBufferSize, long lpBytesRead, uint &lpTotalBytesAvail, long lpBytesLeftThisMessage);
int CloseHandle(long hObject);
#import

//--- Win32 API User32 インポート
#import "user32.dll"
long GetParent(long hWnd);
bool MoveWindow(long hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
bool ShowWindow(long hWnd, int nCmdShow);
#import

//+------------------------------------------------------------------+
//| 名前付きパイプ通信ヘルパークラス                                |
//+------------------------------------------------------------------+
class CWin32Pipe
{
public:
   static void CloseHandleIfValid(long &handle)
   {
      if(handle != INVALID_HANDLE_VALUE)
      {
         CloseHandle(handle);
         handle = INVALID_HANDLE_VALUE;
      }
   }
   
   static bool WriteData(long handle, string text)
   {
      if(handle == INVALID_HANDLE_VALUE) return false;
      uchar buf[];
      StringToCharArray(text, buf, 0, WHOLE_ARRAY, CP_UTF8);
      uint len = (uint)ArraySize(buf) - 1; // ヌル終端文字を除外
      if(len <= 0) return true;
      uint written = 0;
      int res = WriteFile(handle, buf, len, written, 0);
      return (res != 0 && written == len);
   }
};

#endif // __TICKREPLAY_WIN32PIPE_MQH__
