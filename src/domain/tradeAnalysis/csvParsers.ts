import { BrokerType, ParsedTradeBatch, TradeRecord } from "./types";

/**
 * 簡易・高精度CSVパーサー（引用符・カンマ・改行対応）
 */
export function parseCsvRows(csvText: string): string[][] {
  const cleanText = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // スキップ
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = "";
    } else if (char === '\n' && !insideQuotes) {
      currentRow.push(currentField.trim());
      if (currentRow.some(field => field.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * 日付文字列のパース（JST/UTCタイムスタンプミリ秒の算出）
 */
export function parseTradeDateTime(dateStr: string): { formatted: string; msc: number; hourJst: number; dayJst: number } {
  if (!dateStr || dateStr.trim() === "") {
    return { formatted: "", msc: 0, hourJst: 0, dayJst: 1 };
  }

  const s = dateStr.trim().replace(/\./g, "-").replace(/\//g, "-");
  // YYYY-MM-DD HH:mm:ss または YYYY-MM-DD HH:mm
  const match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) {
    // 予備パース: Date.parse
    const ts = Date.parse(dateStr);
    if (!isNaN(ts)) {
      const d = new Date(ts);
      const formatted = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      return { formatted, msc: ts, hourJst: d.getHours(), dayJst: d.getDay() };
    }
    return { formatted: dateStr, msc: 0, hourJst: 0, dayJst: 1 };
  }

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  const h = match[4] ? parseInt(match[4], 10) : 0;
  const min = match[5] ? parseInt(match[5], 10) : 0;
  const sec = match[6] ? parseInt(match[6], 10) : 0;

  // JSTとしてミリ秒生成 (JST = UTC+9)
  const utcMsc = Date.UTC(y, m - 1, d, h - 9, min, sec);
  const formatted = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

  const jsDate = new Date(y, m - 1, d, h, min, sec);
  const dayJst = jsDate.getDay();

  return {
    formatted,
    msc: utcMsc,
    hourJst: h,
    dayJst
  };
}

/**
 * 通貨ペア名の正規化（例: "USD/JPY" -> "USDJPY", "EURUSD+" -> "EURUSD"）
 */
export function normalizeSymbolName(rawSymbol: string): string {
  if (!rawSymbol) return "UNKNOWN";
  const cleaned = rawSymbol.toUpperCase().replace(/[\/\s\-_.]/g, "");
  const match = cleaned.match(/([A-Z]{6})/);
  return match ? match[1] : cleaned;
}

/**
 * pipsの算出（通貨ペアごとの小数桁数自動判定）
 */
export function calculatePips(symbol: string, type: "BUY" | "SELL", openPrice: number, closePrice: number): number {
  if (!openPrice || !closePrice || openPrice <= 0 || closePrice <= 0) return 0;
  const diff = closePrice - openPrice;
  const isJpy = symbol.toUpperCase().includes("JPY");
  const multiplier = isJpy ? 100 : 10000;
  const pips = (type === "BUY" ? diff : -diff) * multiplier;
  return Math.round(pips * 10) / 10;
}

/**
 * 数値文字列のパース（カンマや通貨記号を除去）
 */
function parseNumberClean(val: string | undefined | null): number {
  if (!val) return 0;
  const cleaned = String(val).replace(/[¥,$\s\+]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * CSVデータからブローカータイプを自動検出
 */
export function detectBrokerType(headerRow: string[], _firstDataRow?: string[]): BrokerType {
  const headerStr = headerRow.join(",").toLowerCase();

  // GMOクリック証券 (FXネオ)
  if (
    headerStr.includes("注文番号") &&
    (headerStr.includes("取引区分") || headerStr.includes("受渡日") || headerStr.includes("実現損益") || headerStr.includes("決済約定日時") || headerStr.includes("約定レート"))
  ) {
    return "gmo";
  }

  // DMM FX
  if (
    headerStr.includes("売買区分") &&
    (headerStr.includes("注文番号") || headerStr.includes("約定番号")) &&
    headerStr.includes("約定価格")
  ) {
    return "dmm";
  }

  // SBI FXトレード
  if (
    headerStr.includes("約定番号") &&
    headerStr.includes("注文種類") &&
    headerStr.includes("決済損益")
  ) {
    return "sbi";
  }

  // MT4 / MT5
  if (
    (headerStr.includes("ticket") || headerStr.includes("position") || headerStr.includes("チケット") || headerStr.includes("order")) &&
    (headerStr.includes("profit") || headerStr.includes("損益"))
  ) {
    return (headerStr.includes("position") || headerStr.includes("ポジション") || headerStr.includes("price.1") || headerStr.includes("symbol")) ? "mt5" : "mt4";
  }

  // 汎用フォールバック
  return "generic";
}

export function getBrokerNameJa(broker: BrokerType): string {
  switch (broker) {
    case "gmo": return "GMOクリック証券 (FXネオ)";
    case "dmm": return "DMM FX";
    case "sbi": return "SBI FXトレード";
    case "mt4": return "MetaTrader 4 (MT4)";
    case "mt5": return "MetaTrader 5 (MT5)";
    case "replay": return "MT5 仮想リプレイ";
    case "generic": return "汎用 CSV形式";
  }
}

/**
 * 統合CSVパーサー（各業者の自動判定・パース・正規化）
 */
export function parseBrokerTradeCsv(csvText: string, fileName: string = "trades.csv"): ParsedTradeBatch {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    return {
      broker: "generic",
      brokerNameJa: getBrokerNameJa("generic"),
      sourceFileName: fileName,
      totalRecords: 0,
      trades: [],
      dateRange: { start: "", end: "" },
      symbols: []
    };
  }

  // ヘッダー行の特定（空行やメタ情報行をスキップ）
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i].join(",");
    if (
      r.includes("日時") || r.includes("Time") || r.includes("Date") ||
      r.includes("Ticket") || r.includes("チケット") || r.includes("通貨") ||
      r.includes("Symbol") || r.includes("売買") || r.includes("Type")
    ) {
      headerIdx = i;
      break;
    }
  }

  const headerRow = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1).filter(r => r.length >= 3 && r.some(c => c.length > 0));
  const detectedBroker = detectBrokerType(headerRow, dataRows[0]);

  // ヘッダーマッピングの作成
  const headerMap: { [key: string]: number } = {};
  headerRow.forEach((h, idx) => {
    headerMap[h.trim()] = idx;
    headerMap[h.trim().toLowerCase()] = idx;
  });

  const getCol = (row: string[], ...aliases: string[]): string => {
    for (const a of aliases) {
      const idx = headerMap[a] ?? headerMap[a.toLowerCase()];
      if (idx !== undefined && row[idx] !== undefined) {
        return row[idx].trim();
      }
    }
    return "";
  };

  const trades: TradeRecord[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];

    // 1. 各項目の抽出（ブローカー別・汎用エイリアス対応）
    const ticketRaw = getCol(row, "Ticket", "チケット", "注文番号", "約定番号", "ID", "No", "ポジション番号", "ポジション") || String(i + 1);
    const symbolRaw = getCol(row, "Symbol", "Item", "通貨ペア", "銘柄", "銘柄名", "通貨", "Pair");
    const typeRaw = getCol(row, "Type", "タイプ", "売買", "売買区分", "売/買", "Side", "取引種類", "取引区分");
    const lotsRaw = getCol(row, "Size", "Volume", "Lots", "数量", "約定数量", "取引数量", "ロット");
    
    // エントリー日時 / 決済日時
    const openTimeRaw = getCol(row, "Open Time", "注文日時", "新規約定日時", "新規日時", "約定日時", "OpenTime", "日時", "約定日");
    const closeTimeRaw = getCol(row, "Close Time", "決済約定日時", "決済日時", "決済日", "CloseTime", "決済約定日");
    
    // レート
    const openPriceRaw = getCol(row, "Open Price", "Price", "価格", "約定価格", "新規約定レート", "新規レート", "新規価格", "OpenPrice", "約定レート");
    const closePriceRaw = getCol(row, "Close Price", "Price.1", "決済価格", "決済約定レート", "決済レート", "ClosePrice", "決済");
    
    // 損益 / pips / 手数料 / スワップ
    const profitRaw = getCol(row, "Profit", "損益", "実現損益", "決済損益", "差金決済損益", "確定損益", "損益額");
    const pipsRaw = getCol(row, "Pips", "獲得pips", "損益pips", "pips");
    const commissionRaw = getCol(row, "Commission", "手数料", "取引手数料");
    const swapRaw = getCol(row, "Swap", "スワップ", "スワップ損益");
    const commentRaw = getCol(row, "Comment", "コメント", "メモ");

    // 売買区分の正規化
    let type: "BUY" | "SELL" = "BUY";
    const typeUpper = typeRaw.toUpperCase();
    if (typeUpper.includes("SELL") || typeUpper.includes("売") || typeUpper === "S") {
      type = "SELL";
    }

    const symbol = normalizeSymbolName(symbolRaw);
    const lots = Math.abs(parseNumberClean(lotsRaw)) || 0.1;
    const openPrice = parseNumberClean(openPriceRaw);
    const closePrice = parseNumberClean(closePriceRaw);
    const profit = parseNumberClean(profitRaw);
    const commission = parseNumberClean(commissionRaw);
    const swap = parseNumberClean(swapRaw);

    const openParsed = parseTradeDateTime(openTimeRaw);
    const closeParsed = parseTradeDateTime(closeTimeRaw || openTimeRaw);

    // pipsの決定（CSV内指定優先、なければ価格から自動計算）
    let pips = parseNumberClean(pipsRaw);
    if (!pips && openPrice > 0 && closePrice > 0) {
      pips = calculatePips(symbol, type, openPrice, closePrice);
    }

    // 保有秒数
    const durationSec = (closeParsed.msc && openParsed.msc && closeParsed.msc >= openParsed.msc)
      ? Math.floor((closeParsed.msc - openParsed.msc) / 1000)
      : 0;

    trades.push({
      id: `trade_${detectedBroker}_${i}_${Date.now()}`,
      ticket: ticketRaw,
      source: detectedBroker,
      sourceName: fileName,
      symbol,
      type,
      lots,
      open_time: openParsed.formatted,
      open_time_msc: openParsed.msc,
      open_price: openPrice,
      close_time: closeParsed.formatted,
      close_time_msc: closeParsed.msc,
      close_price: closePrice,
      profit,
      pips,
      commission,
      swap,
      comment: commentRaw || undefined,
      durationSec,
      hourJst: openParsed.hourJst,
      dayJst: openParsed.dayJst
    });
  }

  // 時間順にソートしてエントリー間隔 (entryIntervalSec) を算出
  trades.sort((a, b) => a.open_time_msc - b.open_time_msc);
  trades.forEach((t, idx) => {
    if (idx > 0) {
      const prev = trades[idx - 1];
      t.entryIntervalSec = Math.max(0, Math.floor((t.open_time_msc - prev.close_time_msc) / 1000));
    } else {
      t.entryIntervalSec = 0;
    }
  });

  const uniqueSymbols = Array.from(new Set(trades.map(t => t.symbol).filter(Boolean)));
  const dateRange = {
    start: trades.length > 0 ? trades[0].open_time : "",
    end: trades.length > 0 ? trades[trades.length - 1].close_time : ""
  };

  return {
    broker: detectedBroker,
    brokerNameJa: getBrokerNameJa(detectedBroker),
    sourceFileName: fileName,
    totalRecords: trades.length,
    trades,
    dateRange,
    symbols: uniqueSymbols
  };
}
