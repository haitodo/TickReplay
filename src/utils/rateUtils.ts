/**
 * 価格レートを発注パネルと同じ桁数（JPYペアは小数第3位、その他は小数第5位）でフォーマットする
 * 
 * @param price 価格レート
 * @param symbol 通貨ペア名（オプション）
 * @returns フォーマットされた価格レート文字列
 */
export function formatRate(price: number | undefined | null, symbol?: string): string {
  if (price === undefined || price === null || isNaN(price) || price <= 0) {
    return "-";
  }
  const isJpy = (symbol && symbol.toUpperCase().includes("JPY")) || price > 20.0;
  return price.toFixed(isJpy ? 3 : 5);
}

/**
 * 決済理由（Reason）のUI表示用ラベルを取得する
 */
export function getReasonDisplayLabel(reason: string | undefined | null): string {
  if (!reason) return "-";
  const upper = reason.toUpperCase();
  if (upper === "MANUAL" || upper === "SETTLEMENT") {
    return "手動";
  }
  if (upper === "SL") {
    return "SL";
  }
  if (upper === "TP") {
    return "TP";
  }
  return reason;
}

/**
 * 決済理由（Reason）のホバーツールチップ文字列を取得する
 */
export function getReasonTooltip(reason: string | undefined | null): string {
  if (!reason) return "";
  const upper = reason.toUpperCase();
  if (upper === "MANUAL") {
    return "手動決済 (MANUAL)";
  }
  if (upper === "SETTLEMENT") {
    return "反対売買相殺 (SETTLEMENT)";
  }
  if (upper === "SL") {
    return "損切り (Stop Loss)";
  }
  if (upper === "TP") {
    return "利確 (Take Profit)";
  }
  return reason;
}
