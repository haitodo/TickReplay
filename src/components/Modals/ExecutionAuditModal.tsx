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

  const fetchLogs = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    try {
      const records = await getExecutionAuditLog();
      // 最新の約定が上に来るように逆順
      setLogs([...records].reverse());
    } catch (err) {
      console.error("Failed to fetch execution audit log", err);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchLogs(true);
    const timer = setInterval(() => {
      fetchLogs(false);
    }, 1000);
    return () => clearInterval(timer);
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
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
      }}
    >
      <div
        className="modal-container execution-audit-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "96%",
          maxWidth: "820px",
          height: "90vh",
          maxHeight: "560px",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--surface, #1e1e1e)",
          border: "1px solid var(--outline-variant, rgba(255,255,255,0.15))",
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
            padding: "8px 12px",
            borderBottom: "1px solid var(--outline-variant)",
            backgroundColor: "var(--surface-container-high, #252525)",
            gap: "8px",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, flex: 1 }}>
            <span className="material-symbols-outlined" style={{ color: "var(--primary, #3b82f6)", fontSize: "18px", flexShrink: 0 }}>
              verified_user
            </span>
            <h3
              style={{
                margin: 0,
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--on-surface)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title="約定監査ログ (Execution Audit Log)"
            >
              約定監査ログ
            </h3>
            <span
              style={{
                fontSize: "10px",
                padding: "1px 5px",
                borderRadius: "3px",
                backgroundColor: "rgba(59, 130, 246, 0.15)",
                color: "var(--primary, #3b82f6)",
                fontWeight: 500,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              Core v2
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
            <button
              onClick={() => fetchLogs(true)}
              disabled={isLoading}
              title="再読み込み"
              style={{
                background: "transparent",
                border: "1px solid var(--outline-variant, rgba(255,255,255,0.15))",
                borderRadius: "4px",
                color: "var(--on-surface)",
                padding: "3px 6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "2px",
                fontSize: "11px",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "14px", animation: isLoading ? "spin 1s linear infinite" : "none" }}
              >
                refresh
              </span>
            </button>
            <button
              onClick={handleCopy}
              disabled={logs.length === 0}
              title="クリップボードにコピー"
              style={{
                background: "transparent",
                border: "1px solid var(--outline-variant, rgba(255,255,255,0.15))",
                borderRadius: "4px",
                color: "var(--on-surface)",
                padding: "3px 6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "2px",
                fontSize: "11px",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                {copied ? "check" : "content_copy"}
              </span>
            </button>
            <button
              onClick={handleExportCsv}
              disabled={logs.length === 0}
              title="CSV形式でダウンロード"
              style={{
                background: "transparent",
                border: "1px solid var(--outline-variant, rgba(255,255,255,0.15))",
                borderRadius: "4px",
                color: "var(--on-surface)",
                padding: "3px 6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "2px",
                fontSize: "11px",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                download
              </span>
            </button>
            <button
              className="close-btn"
              onClick={onClose}
              title="閉じる"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--on-surface-variant)",
                fontSize: "18px",
                cursor: "pointer",
                padding: "0 4px",
                lineHeight: 1,
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
            overflowX: "auto",
            padding: "8px",
            backgroundColor: "var(--surface, #1e1e1e)",
          }}
        >
          {logs.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "32px 16px",
                color: "var(--on-surface-variant)",
                textAlign: "center",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "36px", marginBottom: "8px", opacity: 0.5 }}>
                receipt_long
              </span>
              <p style={{ margin: "4px 0", fontSize: "13px", fontWeight: 500 }}>約定ログがまだありません</p>
              <p style={{ margin: "4px 0", fontSize: "11px", opacity: 0.7, maxWidth: "260px" }}>
                Replay Core v2 有効時に成行注文を発注すると、物理遅延やスリッページがここに確定記録されます。
              </p>
            </div>
          ) : (
            <div style={{ width: "100%", overflowX: "auto" }}>
              <table
                className="audit-table font-data"
                style={{
                  width: "100%",
                  minWidth: "660px",
                  borderCollapse: "collapse",
                  fontSize: "11px",
                }}
              >
                <thead>
                  <tr
                    style={{
                      backgroundColor: "var(--surface-container, #282828)",
                      borderBottom: "1px solid var(--outline-variant, rgba(255,255,255,0.1))",
                      textAlign: "left",
                    }}
                  >
                    <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Ticket</th>
                    <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>銘柄</th>
                    <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>売買</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>数量</th>
                    <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>発注時刻 (Click)</th>
                    <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>約定時刻 (Fill)</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>遅延</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>要求価格</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>約定価格</th>
                    <th style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>スリッページ</th>
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
                        <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>#{record.ticket}</td>
                        <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{record.symbol}</td>
                        <td
                          style={{
                            padding: "6px 8px",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            color: isBuy ? "var(--order-buy, #3b82f6)" : "var(--order-sell, #ef4444)",
                          }}
                        >
                          {record.side}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{record.volume.toFixed(2)}</td>
                        <td style={{ padding: "6px 8px", color: "var(--on-surface-variant)", fontSize: "10px", whiteSpace: "nowrap" }}>
                          {formatMscTime(record.click_time_msc)}
                        </td>
                        <td style={{ padding: "6px 8px", color: "var(--on-surface-variant)", fontSize: "10px", whiteSpace: "nowrap" }}>
                          {formatMscTime(record.fill_time_msc)}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                          <span
                            style={{
                              padding: "1px 5px",
                              borderRadius: "3px",
                              fontSize: "10px",
                              backgroundColor: record.latency_ms > 50 ? "rgba(239, 68, 68, 0.15)" : "rgba(59, 130, 246, 0.1)",
                              color: record.latency_ms > 50 ? "#f87171" : "var(--on-surface)",
                            }}
                          >
                            {record.latency_ms} ms
                          </span>
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--on-surface-variant)", whiteSpace: "nowrap" }}>
                          {record.request_price.toFixed(3)}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {record.fill_price.toFixed(3)}
                        </td>
                        <td
                          style={{
                            padding: "6px 8px",
                            textAlign: "right",
                            fontWeight: 700,
                            whiteSpace: "nowrap",
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
            </div>
          )}
        </div>

        <div
          className="modal-footer"
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--outline-variant)",
            backgroundColor: "var(--surface-container, #282828)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "11px",
            color: "var(--on-surface-variant)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            合計 {logs.length} 件
          </span>
          <button
            onClick={onClose}
            style={{
              padding: "3px 10px",
              backgroundColor: "var(--surface-container-high, #333)",
              border: "1px solid var(--outline-variant, rgba(255,255,255,0.15))",
              borderRadius: "4px",
              color: "var(--on-surface)",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
