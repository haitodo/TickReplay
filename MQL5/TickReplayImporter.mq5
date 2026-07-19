//+------------------------------------------------------------------+
//|                                        TickReplayImporter.mq5    |
//|                                  Copyright 2026, Google DeepMind |
//|                                           https://deepmind.google |
//|                     (TickReplay カスタムシンボル一括インポータ)  |
//+------------------------------------------------------------------+
#property copyright "Google DeepMind"
#property link      "https://deepmind.google"
#property version   "1.00"
#property script_show_inputs

//--- スクリプト入力を定義
input string InpCustomGroup = "Custom"; // インポート先カスタムシンボルのグループ名

//+------------------------------------------------------------------+
//| Script program start function                                    |
//+------------------------------------------------------------------+
void OnStart()
{
   Print("[Info] TickReplayImporter: インポートフォルダの走査を開始します。");
   
   string search_path = "TickReplay\\Imports\\*.bin";
   string file_name;
   long search_handle = FileFindFirst(search_path, file_name);
   
   if(search_handle == INVALID_HANDLE)
   {
      Print("[Info] インポート対象の .bin ファイルが見つかりませんでした。");
      return;
   }
   
   int processed_files = 0;
   do
   {
      string rel_file_path = "TickReplay\\Imports\\" + file_name;
      Print("[Info] 処理中ファイル: ", rel_file_path);
      
      // ファイル名からシンボル名と年月を解析 (例: EURJPY_Custom_2025-01.bin)
      string symbol_name = "";
      string name_only = StringSubstr(file_name, 0, StringLen(file_name) - 4); // .bin を除外
      
      // 最後のアンダースコア（年月区切り）を探す
      int last_underscore = -1;
      for(int i = StringLen(name_only) - 1; i >= 0; i--)
      {
         if(StringSubstr(name_only, i, 1) == "_")
         {
            last_underscore = i;
            break;
         }
      }
      
      if(last_underscore > 0)
      {
         symbol_name = StringSubstr(name_only, 0, last_underscore);
      }
      else
      {
         symbol_name = name_only;
      }
      
      if(symbol_name != "")
      {
         ImportBinFile(rel_file_path, symbol_name, InpCustomGroup);
         processed_files++;
      }
      
   } while(FileFindNext(search_handle, file_name));
   
   FileFindClose(search_handle);
   Print("[Info] TickReplayImporter 完了。処理ファイル数: ", processed_files);
}

//+------------------------------------------------------------------+
//| カスタム銘柄名からベース通貨ペア名を抽出するヘルパー            |
//+------------------------------------------------------------------+
string ExtractBaseSymbol(string source_symbol)
{
   string sym = source_symbol;
   int pos = StringFind(sym, "_");
   if(pos > 0)
   {
      sym = StringSubstr(sym, 0, pos);
   }
   pos = StringFind(sym, ".");
   if(pos > 0)
   {
      sym = StringSubstr(sym, 0, pos);
   }
   if(StringLen(sym) >= 6)
   {
      return sym;
   }
   return "USDJPY"; // フォールバック
}

//+------------------------------------------------------------------+
//| .bin ファイルから MqlTick 配列を読み込んで CustomTicksAdd を実行する|
//+------------------------------------------------------------------+
bool ImportBinFile(string rel_path, string symbol_name, string group_name)
{
   int file_handle = FileOpen(rel_path, FILE_READ|FILE_BIN);
   if(file_handle == INVALID_HANDLE)
   {
      Print("[Error] ファイルオープン失敗: ", rel_path, " Code: ", GetLastError());
      return false;
   }
   
   ulong file_size = FileSize(file_handle);
   int tick_count = (int)(file_size / sizeof(MqlTick));
   if(tick_count <= 0)
   {
      FileClose(file_handle);
      Print("[Warning] 空のファイルです: ", rel_path);
      FileDelete(rel_path);
      return false;
   }
   
   MqlTick ticks[];
   ArrayResize(ticks, tick_count);
   uint read_count = FileReadArray(file_handle, ticks, 0, tick_count);
   FileClose(file_handle);
   
   if(read_count <= 0)
   {
      Print("[Error] ティック配列の読み込み失敗: ", rel_path);
      return false;
   }
   
   // シンボルの存在確認 ＆ 作成
   bool is_custom = false;
   if(!SymbolExist(symbol_name, is_custom))
   {
      // ソースシンボルの推定 (例: EURJPY_Custom_2025 -> EURJPY)
      string base_symbol = ExtractBaseSymbol(symbol_name);
      
      bool created = CustomSymbolCreate(symbol_name, group_name, base_symbol);
      if(!created)
      {
         Print("[Warning] base_symbol ('", base_symbol, "') での CustomSymbolCreate 失敗。原銘柄なしで作成を試みます。");
         created = CustomSymbolCreate(symbol_name, group_name, "");
      }
      
      if(!created)
      {
         Print("[Error] CustomSymbolCreate 最終失敗: ", symbol_name, " Code: ", GetLastError());
         return false;
      }
      Print("[Info] カスタムシンボルを作成しました: ", symbol_name, " (グループ: ", group_name, ")");
      
      bool is_jpy = (StringFind(symbol_name, "JPY") >= 0);
      long digits = SymbolInfoInteger(base_symbol, SYMBOL_DIGITS);
      if(digits <= 0) digits = is_jpy ? 3 : 5;
      CustomSymbolSetInteger(symbol_name, SYMBOL_DIGITS, digits);
      
      double point = SymbolInfoDouble(base_symbol, SYMBOL_POINT);
      if(point <= 0) point = (digits == 3 || digits == 2) ? 0.001 : 0.00001;
      CustomSymbolSetDouble(symbol_name, SYMBOL_POINT, point);
      
      double contract_size = SymbolInfoDouble(base_symbol, SYMBOL_TRADE_CONTRACT_SIZE);
      if(contract_size <= 0) contract_size = 100000.0;
      CustomSymbolSetDouble(symbol_name, SYMBOL_TRADE_CONTRACT_SIZE, contract_size);
   }
   
   SymbolSelect(symbol_name, true);
   
   // ティックデータの追加
   ResetLastError();
   int added = CustomTicksAdd(symbol_name, ticks);
   if(added > 0)
   {
      Print("[Success] ", symbol_name, " に ", added, " 件のティックデータをインポートしました。");
      // インポート完了後にファイルを削除
      FileDelete(rel_path);
      return true;
   }
   else
   {
      Print("[Error] CustomTicksAdd 失敗: ", symbol_name, " Code: ", GetLastError());
      return false;
   }
}
