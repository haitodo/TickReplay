import React, { useState, useEffect, useCallback } from "react";
import type { ExecutionAuditRecord } from "../../types/replay";
import { getExecutionAuditLog } from "../../utils/command";
import { formatJstTime } from "../../utils/timeUtils";

interface ExecutionAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExecutionAuditModal: React.FC<ExecutionAuditModalProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<ExecutionAuditRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const records = await getExecutionAuditLog();
      // 最新の約定が上に来るように逆順
      setLogs([...records].reverse());
    } catch (err) {
      console.error("Failed to fetch execution audit log", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  if (!isOpen) return null;

  const formatMscTime = (msc: number) => {
    if (!msc || msc <= 0) return "--:--:--";
    const base = formatJstTime(msc);
    const ms = String(Math.abs(Math.floor(msc % 1000))).padStart(3, "0");
    return `${base}.${ms}`;
  };

  const handleExportCsv = () => {
    if (logs.length === 0) return;
    const headers = [
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
    const rows = logs.map((log) => [
      log.ticket,
      log.symbol,
      log.side,
      log.volume,
      formatMscTime(log.click_time_msc),
      formatMscTime(log.fill_time_msc),
      log.latency_ms,
      log.request_price,
      log.fill_price,
      log.slippage_pips.toFixed(2),
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `execution_audit_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopy = () => {
    if (logs.length === 0) return;
    const text = logs
      .map(
        (l) =>
          `[#${l.ticket}] ${l.side} ${l.volume}lot @ ${l.fill_price} (Req: ${l.request_price}, Slip: ${
            l.slippage_pips >= 0 ? "+" : ""
          }${l.slippage_pips.toFixed(2)}pips, Latency: ${l.latency_ms}ms)`
      )
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal-content execution-audit-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "820px",
          maxWidth: "95vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--surface)",
          border: "1px solid var(--outline-variant)",
          borderRadius: "8px",
          overflow: "hidden",
          boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
        }}
      >
        <div
          className="modal-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid var(--outline-variant)",
            backgroundColor: "var(--surface-container-high)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="material-symbols-outlined" style={{ color: "var(--primary)", fontSize: "20px" }}>
              verified_user
            </span>
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--on-surface)" }}>
              約定監査ログ (Execution Audit Log)
            </h3>
            <span
              style={{
                fontSize: "11px",
                padding: "2px 6px",
                borderRadius: "4px",
                backgroundColor: "rgba(59, 130, 246, 0.15)",
                color: "var(--primary)",
                fontWeight: 500,
              }}
            >
              Core v2 決定論的約定
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={fetchLogs}
              disabled={isLoading}
              title="再読み込み"
              style={{
                background: "transparent",
                border: "1px solid var(--outline-variant)",
                borderRadius: "4px",
                color: "var(--on-surface)",
                padding: "4px 8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "12px",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "14px", animation: isLoading ? "spin 1s linear infinite" : "none" }}
              >
                refresh
              </span>
              更新
            </button>
            <button
              onClick={handleCopy}
              disabled={logs.length === 0}
              title="クリップボードにコピー"
              style={{
                background: "transparent",
                border: "1px solid var(--outline-variant)",
                borderRadius: "4px",
                color: "var(--on-surface)",
                padding: "4px 8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "12px",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                {copied ? "check" : "content_copy"}
              </span>
              {copied ? "コピー済" : "コピー"}
            </button>
            <button
              onClick={handleExportCsv}
              disabled={logs.length === 0}
              title="CSV形式でダウンロード"
              style={{
                background: "transparent",
                border: "1px solid var(--outline-variant)",
                borderRadius: "4px",
                color: "var(--on-surface)",
                padding: "4px 8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "12px",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                download
              </span>
              CSV出力
            </button>
            <button
              className="close-btn"
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--on-surface-variant)",
                fontSize: "20px",
                cursor: "pointer",
                padding: "0 4px",
              }}
            >
              &times;
            </button>
          </div>
        </div>

        <div
          className="modal-body"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px",
            backgroundColor: "var(--surface)",
          }}
        >
          {logs.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "40px 20px",
                color: "var(--on-surface-variant)",
                textAlign: "center",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "40px", marginBottom: "8px", opacity: 0.5 }}>
                receipt_long
              </span>
              <p style={{ margin: "4px 0", fontSize: "14px", fontWeight: 500 }}>約定ログがまだありません</p>
              <p style={{ margin: "4px 0", fontSize: "12px", opacity: 0.7 }}>
                Replay Core v2 有効時に成行注文を発注すると、物理遅延やスリッページがここにミリ秒・0.1pip単位で確定記録されます。
              </p>
            </div>
          ) : (
            <table
              className="audit-table font-data"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "12px",
              }}
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: "var(--surface-container)",
                    borderBottom: "1px solid var(--outline-variant)",
                    textAlign: "left",
                  }}
                >
                  <th style={{ padding: "8px 10px" }}>Ticket</th>
                  <th style={{ padding: "8px 10px" }}>銘柄</th>
                  <th style={{ padding: "8px 10px" }}>売買</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>数量</th>
                  <th style={{ padding: "8px 10px" }}>発注時刻 (Click)</th>
                  <th style={{ padding: "8px 10px" }}>約定時刻 (Fill)</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>遅延</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>要求価格</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>約定価格</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>スリッページ</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((record) => {
                  const isBuy = record.side === "BUY";
                  const slip = record.slippage_pips;
                  const slipClass =
                    slip > 0.05
                      ? { color: "var(--pl-loss, #f87171)" } // 不利
                      : slip < -0.05
                      ? { color: "var(--pl-profit, #4ade80)" } // 有利
                      : { color: "var(--on-surface-variant)" };

                  return (
                    <tr
                      key={record.ticket}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      <td style={{ padding: "8px 10px" }}>#{record.ticket}</td>
                      <td style={{ padding: "8px 10px" }}>{record.symbol}</td>
                      <td
                        style={{
                          padding: "8px 10px",
                          fontWeight: 600,
                          color: isBuy ? "var(--order-buy, #3b82f6)" : "var(--order-sell, #ef4444)",
                        }}
                      >
                        {record.side}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{record.volume.toFixed(2)}</td>
                      <td style={{ padding: "8px 10px", color: "var(--on-surface-variant)", fontSize: "11px" }}>
                        {formatMscTime(record.click_time_msc)}
                      </td>
                      <td style={{ padding: "8px 10px", color: "var(--on-surface-variant)", fontSize: "11px" }}>
                        {formatMscTime(record.fill_time_msc)}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>
                        <span
                          style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            backgroundColor: record.latency_ms > 50 ? "rgba(239, 68, 68, 0.15)" : "rgba(59, 130, 246, 0.1)",
                            color: record.latency_ms > 50 ? "#f87171" : "var(--on-surface)",
                          }}
                        >
                          {record.latency_ms} ms
                        </span>
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--on-surface-variant)" }}>
                        {record.request_price.toFixed(3)}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>
                        {record.fill_price.toFixed(3)}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          textAlign: "right",
                          fontWeight: 700,
                          ...slipClass,
                        }}
                      >
                        {slip > 0 ? `+${slip.toFixed(2)}` : slip.toFixed(2)} pip
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div
          className="modal-footer"
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--outline-variant)",
            backgroundColor: "var(--surface-container)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "11px",
            color: "var(--on-surface-variant)",
          }}
        >
          <span>合計 {logs.length} 件の約定監査ログ（リプレイ巻き戻し・再約定にも完全対応）</span>
          <button
            onClick={onClose}
            style={{
              padding: "4px 12px",
              backgroundColor: "var(--surface-container-high)",
              border: "1px solid var(--outline-variant)",
              borderRadius: "4px",
              color: "var(--on-surface)",
              cursor: "pointer",
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
