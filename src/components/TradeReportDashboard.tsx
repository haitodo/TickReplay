import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertServerStrToJstStr as convertServerToJstStr } from "../utils/timeUtils";
import { calculateTradeStats } from "../domain/tradeStatistics";

interface TradeReportDashboardProps {
  account: any;
  positions: any[];
  history: any[];
  sendCommand: (cmd: any) => Promise<void>;
  setCurrentViewMode: (mode: "replay" | "trade") => void;
  initialBalance: number;
  leverage: number;
  holdingTimeMode: "pc" | "server";
}

export const TradeReportDashboard: React.FC<TradeReportDashboardProps> = ({
  account,
  positions,
  history,
  sendCommand,
  setCurrentViewMode,
  initialBalance,
  leverage,
  holdingTimeMode
}) => {
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isDepositConfirmOpen, setIsDepositConfirmOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isWithdrawConfirmOpen, setIsWithdrawConfirmOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState<number>(500000);
  const [withdrawAmount, setWithdrawAmount] = useState<number>(500000);
  const [actionError, setActionError] = useState("");

  const depositCancelRef = useRef<HTMLButtonElement>(null);
  const withdrawCancelRef = useRef<HTMLButtonElement>(null);
  const resetCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isDepositConfirmOpen && depositCancelRef.current) {
      depositCancelRef.current.focus();
    }
  }, [isDepositConfirmOpen]);

  useEffect(() => {
    if (isWithdrawConfirmOpen && withdrawCancelRef.current) {
      withdrawCancelRef.current.focus();
    }
  }, [isWithdrawConfirmOpen]);

  useEffect(() => {
    if (isResetConfirmOpen && resetCancelRef.current) {
      resetCancelRef.current.focus();
    }
  }, [isResetConfirmOpen]);


  // 統計情報の算出
  const { totalTrades, wins, losses, winRate } = calculateTradeStats(history);

  const balance = account ? account.balance : 1000000;
  const equity = account ? account.equity : 1000000;
  const margin = account ? account.margin : 0;
  const freeMargin = account ? account.free_margin : 1000000;
  const marginLevel = account ? account.margin_level : 0;
  const totalPL = account ? (account.equity - account.balance) : 0;

  const handleClosePosition = (ticket: number, volume: number) => {
    sendCommand({
      command: "ORDER_CLOSE",
      ticket,
      volume
    });
  };

  const handleRowClick = (closeTimeStr: string) => {
    const jstTimeStr = convertServerToJstStr(closeTimeStr);
    setCurrentViewMode("replay");
    sendCommand({
      command: "SEEK_TIME",
      target_time: jstTimeStr
    });
  };

  const formatPL = (val: number) => {
    const formatted = val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    if (val > 0) return <span className="profit-green">+{formatted}</span>;
    if (val < 0) return <span className="loss-red">{formatted}</span>;
    return <span>0.00</span>;
  };

  return (
    <div className="trade-dashboard-container">
      {/* 口座サマリーカード */}
      <div className="dashboard-stats-grid">
        <div className="stat-card">
          <div className="stat-card-label">口座残高</div>
          <div className="stat-card-val">{balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div>

          <div className="funding-btn-row">
            <button
              type="button"
              className="funding-btn primary-action"
              onClick={() => setIsDepositOpen(true)}
              title="仮想入金"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>add_circle</span>
              <span>入金</span>
            </button>
            <button
              type="button"
              className="funding-btn"
              onClick={() => {
                setActionError("");
                setIsWithdrawOpen(true);
              }}
              title="仮想出金"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>remove_circle</span>
              <span>出金</span>
            </button>
            <button
              type="button"
              className="funding-btn danger-action"
              onClick={() => setIsResetConfirmOpen(true)}
              title="口座初期化"
            >
              <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>restart_alt</span>
              <span>初期化</span>
            </button>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">有効残高</div>
          <div className="stat-card-val">{equity.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">評価損益</div>
          <div className="stat-card-val">{formatPL(totalPL)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">証拠金維持率</div>
          <div className="stat-card-val">{marginLevel > 0 ? `${marginLevel.toFixed(1)}%` : "N/A"}</div>
          <div className="stat-card-sub text-[10px]" style={{ color: "var(--on-surface-variant)" }}>
            証拠金: {margin.toLocaleString()} / 余剰: {freeMargin.toLocaleString()}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">勝率</div>
          <div className="stat-card-val">{winRate.toFixed(1)}%</div>
          <div className="stat-card-sub text-[10px]" style={{ color: "var(--on-surface-variant)" }}>
            勝数: {wins} / 負数: {losses} / 総取引: {totalTrades}
          </div>
        </div>
      </div>

      {/* 取引情報テーブル */}
      <div className="dashboard-tables-grid">
        {/* 保有ポジション一覧 */}
        <div className="pro-panel table-panel">
          <div className="pro-panel-header">
            <h3 className="pro-panel-title">
              <span className="material-symbols-outlined icon-accent">list_alt</span>
              保有ポジション
            </h3>
            <span className="pro-panel-meta">{positions.length} Positions</span>
          </div>
          <div className="pro-panel-body" style={{ padding: 0 }}>
            <div className="dashboard-table-wrapper">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Type</th>
                    <th>Lots</th>
                    <th>Open Price</th>
                    <th>SL</th>
                    <th>TP</th>
                    <th>Current</th>
                    <th>Profit</th>
                    <th style={{ textAlign: "center" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.ticket}>
                      <td className="font-data">{p.ticket}</td>
                      <td>
                        <span className={`type-badge ${p.type.toLowerCase()}`}>{p.type}</span>
                      </td>
                      <td className="font-data">{p.volume.toFixed(2)}</td>
                      <td className="font-data">{p.open_price.toFixed(5)}</td>
                      <td className="font-data">{p.sl > 0 ? p.sl.toFixed(5) : "-"}</td>
                      <td className="font-data">{p.tp > 0 ? p.tp.toFixed(5) : "-"}</td>
                      <td className="font-data">{p.current_price.toFixed(5)}</td>
                      <td className="font-data">{formatPL(p.profit)}</td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          className="pro-btn danger"
                          style={{ padding: "2px 8px", fontSize: "10px" }}
                          onClick={() => handleClosePosition(p.ticket, p.volume)}
                        >
                          決済
                        </button>
                      </td>
                    </tr>
                  ))}
                  {positions.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: "center", color: "var(--on-surface-variant)", padding: "16px 0", fontSize: "11px" }}>
                        現在、保有しているポジションはありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 取引履歴ログ */}
        <div className="pro-panel table-panel">
          <div className="pro-panel-header">
            <h3 className="pro-panel-title">
              <span className="material-symbols-outlined icon-accent">history</span>
              取引履歴
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {history.length > 0 && (
                <button
                  type="button"
                  className="pro-btn primary pro-glow"
                  style={{ padding: "4px 8px", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
                  onClick={async () => {
                    try {
                      await invoke("open_trade_analysis_window");
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  title="取引分析画面を開く"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>analytics</span>
                  <span>取引分析</span>
                </button>
              )}
              <span className="pro-panel-meta">{history.length} Trades</span>
            </div>
          </div>
          <div className="pro-panel-body" style={{ padding: 0 }}>
            <div className="dashboard-table-wrapper">
              <table className="dashboard-table clickable-rows">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Type</th>
                    <th>Lots</th>
                    <th>Open Price</th>
                    <th>Close Price</th>
                    <th>Close Time (Server)</th>
                    <th>保有時間</th>
                    <th>Profit</th>
                    <th>Reason</th>
                    <th style={{ textAlign: "center" }}>Seek</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice().reverse().map((h) => {
                    const serverDuration = h.close_time_msc && h.open_time_msc ? (h.close_time_msc - h.open_time_msc) : 0;
                    
                    let pcDuration = h.accumulated_real_time;
                    if (pcDuration === undefined || pcDuration === 0) {
                      try {
                        const storedTimesStr = localStorage.getItem("speed-order-position-real-times");
                        if (storedTimesStr) {
                          const storedTimes = JSON.parse(storedTimesStr);
                          pcDuration = storedTimes[h.ticket] || 0;
                        }
                      } catch (e) {
                        console.error("Failed to parse storedTimes in history render", e);
                      }
                    }

                    const formatHoldingTime = (ms: number) => {
                      if (ms < 0) ms = 0;
                      const totalSeconds = Math.floor(ms / 1000);
                      const hours = Math.floor(totalSeconds / 3600);
                      const minutes = Math.floor((totalSeconds % 3600) / 60);
                      const seconds = totalSeconds % 60;
                      
                      if (hours > 0) {
                        return `${hours}時間${minutes}分${seconds}秒`;
                      }
                      if (minutes > 0) {
                        return `${minutes}分${seconds}秒`;
                      }
                      return `${seconds}秒`;
                    };

                    let holdingTimeStr = "";
                    if (holdingTimeMode === "pc" && pcDuration > 0) {
                      holdingTimeStr = `${formatHoldingTime(pcDuration)} (PC)`;
                    } else if (serverDuration > 0) {
                      holdingTimeStr = `${formatHoldingTime(serverDuration)} (Chart)`;
                    } else {
                      holdingTimeStr = "0秒";
                    }

                    return (
                      <tr key={h.ticket} onClick={() => handleRowClick(h.close_time)} title="クリックしてこの約定時間へジャンプ">
                        <td className="font-data">{h.ticket}</td>
                        <td>
                          <span className={`type-badge ${h.type.toLowerCase()}`}>{h.type}</span>
                        </td>
                        <td className="font-data">{h.volume.toFixed(2)}</td>
                        <td className="font-data">{h.open_price.toFixed(5)}</td>
                        <td className="font-data">{h.close_price.toFixed(5)}</td>
                        <td className="font-data" style={{ fontSize: "10px" }}>{h.close_time}</td>
                        <td className="font-data" style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>{holdingTimeStr}</td>
                        <td className="font-data">{formatPL(h.profit)}</td>
                        <td>
                          <span className={`reason-badge ${h.close_reason.toLowerCase()}`}>
                            {h.close_reason}
                          </span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span className="material-symbols-outlined text-[14px] text-accent">location_searching</span>
                        </td>
                      </tr>
                    );
                  })}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: "center", color: "var(--on-surface-variant)", padding: "16px 0", fontSize: "11px" }}>
                        取引履歴はありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Deposit Modal */}
      {isDepositOpen && (
        <div className="modal-overlay" onClick={() => setIsDepositOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "360px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined icon-accent">add_circle</span>
                仮想入金
              </h3>
              <button className="modal-close-btn" onClick={() => setIsDepositOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px" }}>
              <label className="form-label" style={{ marginBottom: 0 }}>入金額 (JPY)</label>
              <input
                type="number"
                step="10000"
                min="0"
                className="pro-input"
                value={depositAmount}
                onChange={(e) => setDepositAmount(Math.max(0, parseInt(e.target.value) || 0))}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {[100000, 500000, 1000000, 5000000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="pro-btn"
                    style={{ padding: "4px 8px", fontSize: "10px" }}
                    onClick={() => setDepositAmount(preset)}
                  >
                    +{preset.toLocaleString()}円
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button className="pro-btn" onClick={() => setIsDepositOpen(false)}>
                キャンセル
              </button>
              <button
                className="pro-btn primary"
                onClick={() => {
                  if (depositAmount <= 0) return;
                  setIsDepositOpen(false);
                  setIsDepositConfirmOpen(true);
                }}
              >
                入金確認へ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Confirmation Modal */}
      {isDepositConfirmOpen && (
        <div className="modal-overlay" onClick={() => setIsDepositConfirmOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined icon-accent">warning</span>
                仮想入金の警告と確認
              </h3>
              <button className="modal-close-btn" onClick={() => setIsDepositConfirmOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
              <div style={{ backgroundColor: "rgba(var(--primary-rgb), 0.05)", border: "1px solid rgba(var(--primary-rgb), 0.2)", borderRadius: "6px", padding: "12px", fontSize: "11px", color: "var(--primary-color)" }}>
                <strong>【心理的警告】</strong><br />
                リプレイ検証中の追加入金は、実際のトレードにおける「ナンピン逃れのための自己欺瞞的な資金追加」や「リスク管理規則の無視」を無意識のうちに肯定してしまう危険性があります。本番の取引環境で同様の行動をとると、取り返しのつかない致命的な損失を招く恐れがあります。
              </div>
              <div style={{ fontSize: "12px", textAlign: "center", marginTop: "8px" }}>
                本当に <strong>{depositAmount.toLocaleString()} JPY</strong> の仮想入金を実行しますか？
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              <button
                ref={depositCancelRef}
                className="pro-btn primary"
                style={{ width: "100%" }}
                onClick={() => setIsDepositConfirmOpen(false)}
              >
                キャンセルする（推奨）
              </button>
              <button
                className="pro-btn"
                style={{ width: "100%" }}
                onClick={async () => {
                  await sendCommand({
                    command: "ACCOUNT_TRANSACTION",
                    type: "DEPOSIT",
                    amount: depositAmount
                  });
                  setIsDepositConfirmOpen(false);
                }}
              >
                ルールを理解した上で実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Withdraw Modal */}
      {isWithdrawOpen && (
        <div className="modal-overlay" onClick={() => setIsWithdrawOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "360px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined icon-accent">remove_circle</span>
                仮想出金
              </h3>
              <button className="modal-close-btn" onClick={() => setIsWithdrawOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px" }}>
              <label className="form-label" style={{ marginBottom: 0 }}>出金額 (JPY)</label>
              <input
                type="number"
                step="10000"
                min="0"
                className="pro-input"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(Math.max(0, parseInt(e.target.value) || 0))}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {[100000, 500000, 1000000, 5000000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="pro-btn"
                    style={{ padding: "4px 8px", fontSize: "10px" }}
                    onClick={() => setWithdrawAmount(preset)}
                  >
                    {preset.toLocaleString()}円
                  </button>
                ))}
              </div>
              <div style={{ fontSize: "10px", color: "var(--on-surface-variant)", marginTop: "4px" }}>
                出金可能額 (余剰証拠金): {freeMargin.toLocaleString()} JPY
              </div>
              {actionError && (
                <div style={{ fontSize: "11px", color: "var(--status-danger)", marginTop: "4px" }}>
                  {actionError}
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button className="pro-btn" onClick={() => setIsWithdrawOpen(false)}>
                キャンセル
              </button>
              <button
                className="pro-btn primary"
                onClick={() => {
                  if (withdrawAmount <= 0) return;
                  if (withdrawAmount > freeMargin) {
                    setActionError("出金額が余剰証拠金を超えています。");
                    return;
                  }
                  setActionError("");
                  setIsWithdrawOpen(false);
                  setIsWithdrawConfirmOpen(true);
                }}
              >
                出金確認へ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Withdraw Confirmation Modal */}
      {isWithdrawConfirmOpen && (
        <div className="modal-overlay" onClick={() => setIsWithdrawConfirmOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined icon-accent">warning</span>
                仮想出金の警告と確認
              </h3>
              <button className="modal-close-btn" onClick={() => setIsWithdrawConfirmOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
              <div style={{ backgroundColor: "rgba(var(--primary-rgb), 0.05)", border: "1px solid rgba(var(--primary-rgb), 0.2)", borderRadius: "6px", padding: "12px", fontSize: "11px", color: "var(--primary-color)" }}>
                <strong>【資金管理上の警告】</strong><br />
                検証中の資金出金は、取引口座の複利効果や必要証拠金比率、当初作成した長期的な資金運用計画を崩す行為となります。計画外の出金は、トレードの一貫性と統計的信頼性を損なう原因になります。
              </div>
              <div style={{ fontSize: "12px", textAlign: "center", marginTop: "8px" }}>
                本当に <strong>{withdrawAmount.toLocaleString()} JPY</strong> の仮想出金を実行しますか？
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              <button
                ref={withdrawCancelRef}
                className="pro-btn primary"
                style={{ width: "100%" }}
                onClick={() => setIsWithdrawConfirmOpen(false)}
              >
                キャンセルする（推奨）
              </button>
              <button
                className="pro-btn"
                style={{ width: "100%" }}
                onClick={async () => {
                  await sendCommand({
                    command: "ACCOUNT_TRANSACTION",
                    type: "WITHDRAWAL",
                    amount: withdrawAmount
                  });
                  setIsWithdrawConfirmOpen(false);
                }}
              >
                計画外の出金を実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {isResetConfirmOpen && (
        <div className="modal-overlay" onClick={() => setIsResetConfirmOpen(false)}>
          <div className="modal-container" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined text-accent" style={{ color: "var(--status-danger)" }}>warning</span>
                口座初期化の心理的警告と確認
              </h3>
              <button className="modal-close-btn" onClick={() => setIsResetConfirmOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px", lineHeight: "1.6" }}>
              <div style={{ backgroundColor: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "6px", padding: "12px", fontSize: "11px", color: "var(--status-danger)" }}>
                <strong>【トレード心理の警告】</strong><br />
                口座の初期化（リセット）は、損失が出た取引履歴や自身の選択ミスから目を背け、「なかったことにする」というトレーダーとしての最も好ましくない現実逃避の癖を助長する危険性があります。負けトレードの原因を分析し受け入れることこそが、実力を高める唯一の手段です。
              </div>
              <div style={{ fontSize: "12px", textAlign: "center", marginTop: "8px" }}>
                本当に口座を初期化し、<strong>すべての保有ポジションおよび過去の取引履歴を永久に消去</strong>しますか？
              </div>
            </div>
            <div className="modal-footer" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px", width: "100%", boxSizing: "border-box" }}>
              <button
                ref={resetCancelRef}
                className="pro-btn primary"
                style={{ width: "100%" }}
                onClick={() => setIsResetConfirmOpen(false)}
              >
                キャンセルする（履歴を残す・推奨）
              </button>
              <button
                className="pro-btn danger"
                style={{ width: "100%" }}
                onClick={async () => {
                  await sendCommand({
                    command: "ACCOUNT_RESET",
                    initial_balance: initialBalance,
                    leverage: leverage
                  });
                  setIsResetConfirmOpen(false);
                }}
              >
                現実を受け入れず初期化を実行
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
