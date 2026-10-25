import type { ExecutionAuditRecord } from "../types/replay";
import { formatJstTime } from "./timeUtils";

const CSV_HEADERS = [
  "Ticket",
  "Symbol",
  "Side",
  "Volume",
  "ClickTime",
  "FillTime",
  "LatencyMs",
  "RequestPrice",
  "FillPrice",
  "SlippagePips",
];

export const formatExecutionAuditTime = (msc: number): string => {
  if (!msc || msc <= 0) return "--:--:--";
  const base = formatJstTime(msc);
  const milliseconds = String(Math.abs(Math.floor(msc % 1000))).padStart(3, "0");
  return `${base}.${milliseconds}`;
};

export const formatExecutionAuditCsv = (logs: readonly ExecutionAuditRecord[]): string => {
  const rows = logs.map((log) => [
    log.ticket,
    log.symbol,
    log.side,
    log.volume,
    formatExecutionAuditTime(log.click_time_msc),
    formatExecutionAuditTime(log.fill_time_msc),
    log.latency_ms,
    log.request_price,
    log.fill_price,
    log.slippage_pips.toFixed(2),
  ]);
  return [CSV_HEADERS.join(","), ...rows.map((row) => row.join(","))].join("\n");
};

export const formatExecutionAuditCopyText = (logs: readonly ExecutionAuditRecord[]): string =>
  logs
    .map(
      (log) =>
        `[#${log.ticket}] ${log.side} ${log.volume}lot @ ${log.fill_price} (Req: ${log.request_price}, Slip: ${
          log.slippage_pips >= 0 ? "+" : ""
        }${log.slippage_pips.toFixed(2)}pips, Latency: ${log.latency_ms}ms)`
    )
    .join("\n");
