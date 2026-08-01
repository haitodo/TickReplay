//+------------------------------------------------------------------+
//|                                                SymbolManager.mqh |
//|                                  Copyright 2026, Google DeepMind |
//|                     (カスタムシンボル管理＆ヒストリー構築モジュール)|
//+------------------------------------------------------------------+
#ifndef __TICKREPLAY_SYMBOLMANAGER_MQH__
#define __TICKREPLAY_SYMBOLMANAGER_MQH__

#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property strict

#include "Config.mqh"
#include "JsonHelper.mqh"
#include "TickBuffer.mqh"

//+------------------------------------------------------------------+
//| カスタムシンボル作成・プリロード統合クラス                        |
//+------------------------------------------------------------------+
class CSymbolManager
{
public:
   static string ExtractBaseSymbol(string source_symbol)
   {
      string sym = source_symbol;
      int pos = StringFind(sym, "_");
      if(pos > 0) sym = StringSubstr(sym, 0, pos);
      pos = StringFind(sym, ".");
      if(pos > 0) sym = StringSubstr(sym, 0, pos);
      if(StringLen(sym) >= 6) return sym;
      return "USDJPY"; // フォールバック
   }

   static bool InitializeReplaySymbol(string replay_symbol, string source_symbol)
   {
      bool is_custom = false;
      bool exist = SymbolExist(replay_symbol, is_custom);
      
      if(!exist)
      {
         ResetLastError();
         bool created = CustomSymbolCreate(replay_symbol, "Replay", source_symbol);
         
         if(!created)
         {
            int err = GetLastError();
            Print("[Warning] source_symbol ('", source_symbol, "') での CustomSymbolCreate 失敗。Code: ", err, "。ベース銘柄での作成を試みます。");
            
            string base_symbol = ExtractBaseSymbol(source_symbol);
            if(SymbolExist(base_symbol, is_custom))
            {
               created = CustomSymbolCreate(replay_symbol, "Replay", base_symbol);
            }
            
            if(!created)
            {
               Print("[Warning] ベース銘柄 ('", base_symbol, "') での CustomSymbolCreate 失敗。原銘柄なしで作成を試みます。");
               created = CustomSymbolCreate(replay_symbol, "Replay", "");
            }
            
            if(!created)
            {
               Print("[Error] カスタムシンボルの作成に最終失敗しました: ", replay_symbol, " Code: ", GetLastError());
               return false;
            }
         }
      }
      
      string base_sym = ExtractBaseSymbol(source_symbol);
      bool is_jpy = (StringFind(source_symbol, "JPY") >= 0);
      
      long digits = SymbolInfoInteger(source_symbol, SYMBOL_DIGITS);
      if(digits <= 0 || (is_jpy && digits != 2 && digits != 3) || (!is_jpy && digits != 4 && digits != 5))
      {
         long base_digits = SymbolInfoInteger(base_sym, SYMBOL_DIGITS);
         if(base_digits > 0) digits = base_digits;
         else digits = is_jpy ? 3 : 5;
      }
      CustomSymbolSetInteger(replay_symbol, SYMBOL_DIGITS, digits);
      
      double point = SymbolInfoDouble(source_symbol, SYMBOL_POINT);
      if(point <= 0.0 || (is_jpy && point > 0.01) || (!is_jpy && point > 0.001))
      {
         double base_point = SymbolInfoDouble(base_sym, SYMBOL_POINT);
         if(base_point > 0.0) point = base_point;
         else point = (digits == 3 || digits == 2) ? 0.001 : 0.00001;
      }
      CustomSymbolSetDouble(replay_symbol, SYMBOL_POINT, point);
      
      double contract_size = SymbolInfoDouble(source_symbol, SYMBOL_TRADE_CONTRACT_SIZE);
      if(contract_size <= 0) contract_size = SymbolInfoDouble(base_sym, SYMBOL_TRADE_CONTRACT_SIZE);
      if(contract_size <= 0) contract_size = 100000.0;
      CustomSymbolSetDouble(replay_symbol, SYMBOL_TRADE_CONTRACT_SIZE, contract_size);
      
      string base_curr = SymbolInfoString(source_symbol, SYMBOL_CURRENCY_BASE);
      if(base_curr == "") base_curr = SymbolInfoString(base_sym, SYMBOL_CURRENCY_BASE);
      if(base_curr != "") CustomSymbolSetString(replay_symbol, SYMBOL_CURRENCY_BASE, base_curr);
      
      string profit_curr = SymbolInfoString(source_symbol, SYMBOL_CURRENCY_PROFIT);
      if(profit_curr == "") profit_curr = SymbolInfoString(base_sym, SYMBOL_CURRENCY_PROFIT);
      if(profit_curr != "") CustomSymbolSetString(replay_symbol, SYMBOL_CURRENCY_PROFIT, profit_curr);
      
      if(!SymbolSelect(replay_symbol, true))
      {
         Print("[Error] カスタムシンボルの気配値登録に失敗しました。Code: ", GetLastError());
         return false;
      }
      
      ResetLastError();
      int deleted_ticks = CustomTicksDelete(replay_symbol, 0, LONG_MAX);
      int deleted_rates = CustomRatesDelete(replay_symbol, 0, LONG_MAX);
      
      if(deleted_ticks < 0 || deleted_rates < 0)
      {
         Print("[Warning] 既存データクリア中の警告。Ticks: ", deleted_ticks, ", Rates: ", deleted_rates, ", Code: ", GetLastError());
      }
      return true;
   }
};

#endif // __TICKREPLAY_SYMBOLMANAGER_MQH__
