import React, { useState, useEffect, useRef } from "react";
import { EVENTS } from "../constants/events";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { listen } from "@tauri-apps/api/event";
import { formatRate } from "../utils/rateUtils";
import { useTheme } from "../hooks/useTheme";
import { VirtualAccount, VirtualPosition } from "../types/trading";
import { ReplayProgressPayload } from "../types/replay";
import { ReplayCommand, sendReplayCommand } from "../utils/command";

export const PositionsWindowContent: React.FC = () => {
  useTheme();

  const [positions, setPositions] = useState<VirtualPosition[]>([]);
  const [account, setAccount] = useState<VirtualAccount | null>(null);
  const [status, setStatus] = useState<string>("DISCONNECTED");
  const [contractSize] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.speedOrderContractSize);
    return saved ? parseInt(saved, 10) : 10000;
  });

  // 資金操作モーダル用State
  const [activeFundingAction, setActiveFundingAction] = useState<"none" | "deposit" | "withdraw" | "reset">("none");
  const [depositAmount, setDepositAmount] = useState<number>(500000);
  const [withdrawAmount, setWithdrawAmount] = useState<number>(500000);
  const [actionError, setActionError] = useState("");
  const [isDepositConfirmOpen, setIsDepositConfirmOpen] = useState(false);
  const [isWithdrawConfirmOpen, setIsWithdrawConfirmOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  const depositCancelRef = useRef<HTMLButtonElement>(null);
  const withdrawCancelRef = useRef<HTMLButtonElement>(null);
  const resetCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isDepositConfirmOpen && depositCancelRef.current) depositCancelRef.current.focus();
  }, [isDepositConfirmOpen]);

  useEffect(() => {
    if (isWithdrawConfirmOpen && withdrawCancelRef.current) withdrawCancelRef.current.focus();
  }, [isWithdrawConfirmOpen]);

  useEffect(() => {
    if (isResetConfirmOpen && resetCancelRef.current) resetCancelRef.current.focus();
  }, [isResetConfirmOpen]);

  // ESCキーで資金操作パネルを閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isDepositConfirmOpen) setIsDepositConfirmOpen(false);
        else if (isWithdrawConfirmOpen) setIsWithdrawConfirmOpen(false);
        else if (isResetConfirmOpen) setIsResetConfirmOpen(false);
        else if (activeFundingAction !== "none") setActiveFundingAction("none");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDepositConfirmOpen, isWithdrawConfirmOpen, isResetConfirmOpen, activeFundingAction]);

  const sendCommand = async (cmd: ReplayCommand) => {
    try {
      await sendReplayCommand(cmd);
    } catch (e) {
      console.error("Failed to send command from account & positions window:", e);
    }
  };

  useEffect(() => {
    const unlisten = listen<string>(EVENTS.mt5Status, (event) => {
      try {
        const data = JSON.parse(event.payload) as ReplayProgressPayload;
        if (data.status) setStatus(data.status);
        if (data.account) {
          setAccount((prev) => {
            if (JSON.stringify(prev) === JSON.stringify(data.account)) return prev;
            return data.account ?? prev;
          });
        }
        if (data.positions) {
          setPositions((prev) => {
            if (JSON.stringify(prev) === JSON.stringify(data.positions)) return prev;
            return data.positions ?? prev;
          });
        }
        if (data.status === "DISCONNECTED") {
          setPositions((prev) => (prev.length > 0 ? [] : prev));
          setAccount((prev) => (prev !== null ? null : prev));
        }
      } catch (e) {
        console.error("Failed to parse mt5-status in account & positions window:", e);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleClosePosition = (ticket: number, volume: number) => {
    sendCommand({
      command: "ORDER_CLOSE",
      ticket,
      volume
    });
  };

  const handleCloseAll = () => sendCommand({ command: "ORDER_CLOSE_ALL" });
  const handleCloseBuy = () => sendCommand({ command: "ORDER_CLOSE_BUY" });
  const handleCloseSell = () => sendCommand({ command: "ORDER_CLOSE_SELL" });

  const safePositions = Array.isArray(positions) ? positions : [];

  const balance = account ? Number(account.balance) || 1000000 : 1000000;
  const equity = account ? Number(account.equity) || 1000000 : 1000000;
  const margin = account ? Number(account.margin) || 0 : 0;
  const freeMargin = account ? Number(account.free_margin) || 1000000 : 1000000;
  const marginLevel = account ? Number(account.margin_level) || 0 : 0;
  const totalPL = account ? Number(account.equity) - Number(account.balance) : safePositions.reduce((sum, p) => sum + (Number(p.profit) || 0), 0);
  const leverage = account?.leverage || 25;

  const totalBuyLots = safePositions
    .filter((p) => p && p.type === "BUY")
    .reduce((sum, p) => sum + (Number(p.volume) || 0), 0);
  const totalSellLots = safePositions
    .filter((p) => p && p.type === "SELL")
    .reduce((sum, p) => sum + (Number(p.volume) || 0), 0);

  const formatCurrency = (val: number | undefined | null) => {
    const num = Number(val) || 0;
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " 円";
  };

  const formatPL = (val: number | undefined | null) => {
    const num = Number(val) || 0;
    const formatted = num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    if (num > 0) return <span className="profit-green">+{formatted} 円</span>;
    if (num < 0) return <span className="loss-red">{formatted} 円</span>;
    return <span>0 円</span>;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "var(--surface)",
        color: "var(--on-surface)",
        fontFamily: "var(--font-ui)",
        userSelect: "none",
        overflow: "hidden"
      }}
    >
      {/* ウィンドウヘッダー */}
      <div
        data-tauri-drag-region
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 16px",
          backgroundColor: "var(--surface-container-high)",
          borderBottom: "1px solid var(--outline-variant)",
          flexShrink: 0
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }} data-tauri-drag-region>
          <span className="material-symbols-outlined icon-accent" style={{ fontSize: "18px" }} data-tauri-drag-region>
            account_balance_wallet
          </span>
          <span style={{ fontWeight: 600, fontSize: "13px" }} data-tauri-drag-region>
            口座・ポジション管理
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "var(--on-surface-variant)",
              backgroundColor: "var(--surface-container)",
              padding: "2px 6px",
              borderRadius: "4px"
            }}
          >
            建玉 {safePositions.length} 件
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }} data-tauri-drag-region>
          <div
            className="speed-order-status"
            title={`Status: ${status}`}
            data-tauri-drag-region
          >
            <span className={`status-dot ${status.toLowerCase()}`}></span>
          </div>
        </div>
      </div>

      {/* 1. 口座サマリー & 資金操作セクション */}
      <div
        style={{
          padding: "12px 16px",
          backgroundColor: "var(--surface-container-low)",
          borderBottom: "1px solid var(--outline-variant)",
          flexShrink: 0
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "8px" }}>
          {/* 口座残高 */}
          <div style={{ padding: "8px 10px", backgroundColor: "var(--surface-container)", borderRadius: "6px", border: "1px solid var(--outline-variant)" }}>
            <div style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>口座残高 (Balance)</div>
            <div style={{ fontSize: "14px", fontWeight: 700, fontFamily: "var(--font-data)", marginTop: "2px" }}>
              {formatCurrency(balance)}
            </div>
          </div>

          {/* 有効残高 */}
          <div style={{ padding: "8px 10px", backgroundColor: "var(--surface-container)", borderRadius: "6px", border: "1px solid var(--outline-variant)" }}>
            <div style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>有効残高 (Equity)</div>
            <div style={{ fontSize: "14px", fontWeight: 700, fontFamily: "var(--font-data)", marginTop: "2px" }}>
              {formatCurrency(equity)}
            </div>
          </div>

          {/* 評価損益 */}
          <div style={{ padding: "8px 10px", backgroundColor: "var(--surface-container)", borderRadius: "6px", border: "1px solid var(--outline-variant)" }}>
            <div style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>評価損益 (P/L)</div>
            <div style={{ fontSize: "14px", fontWeight: 700, fontFamily: "var(--font-data)", marginTop: "2px" }}>
              {formatPL(totalPL)}
            </div>
          </div>

          {/* 証拠金維持率 */}
          <div style={{ padding: "8px 10px", backgroundColor: "var(--surface-container)", borderRadius: "6px", border: "1px solid var(--outline-variant)" }}>
            <div style={{ fontSize: "10px", color: "var(--on-surface-variant)" }}>証拠金維持率 / 余剰証拠金</div>
            <div style={{ fontSize: "14px", fontWeight: 700, fontFamily: "var(--font-data)", marginTop: "2px", display: "flex", justifyContent: "space-between" }}>
              <span>{margin > 0 ? `${marginLevel.toFixed(1)}%` : "--"}</span>
              <span style={{ fontSize: "10px", color: "var(--on-surface-variant)", alignSelf: "flex-end" }}>余剰: {formatCurrency(freeMargin)}</span>
            </div>
          </div>
        </div>

        {/* 資金操作ボタン群 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>
            レバレッジ: <strong>{leverage}倍</strong> / ロット単位: <strong>{contractSize.toLocaleString()}通貨</strong>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              className={`pro-btn ${activeFundingAction === "deposit" ? "primary" : ""}`}
              style={{ padding: "4px 10px", fontSize: "11px" }}
              onClick={() => setActiveFundingAction(activeFundingAction === "deposit" ? "none" : "deposit")}
            >
              + 仮想入金
            </button>
            <button
              className={`pro-btn ${activeFundingAction === "withdraw" ? "primary" : ""}`}
              style={{ padding: "4px 10px", fontSize: "11px" }}
              onClick={() => {
                setActionError("");
                setActiveFundingAction(activeFundingAction === "withdraw" ? "none" : "withdraw");
              }}
            >
              - 仮想出金
            </button>
            <button
              className={`pro-btn danger ${activeFundingAction === "reset" ? "active-loop" : ""}`}
              style={{ padding: "4px 10px", fontSize: "11px" }}
              onClick={() => setActiveFundingAction(activeFundingAction === "reset" ? "none" : "reset")}
            >
              口座初期化
            </button>
          </div>
        </div>

        {/* 資金操作インラインパネル */}
        {activeFundingAction === "deposit" && (
          <div style={{ marginTop: "10px", padding: "10px", backgroundColor: "var(--surface-container-high)", borderRadius: "6px", border: "1px solid var(--outline-variant)", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: 600 }}>仮想入金額の指定</span>
              <button className="modal-close-btn" style={{ padding: "2px" }} onClick={() => setActiveFundingAction("none")}>
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
              </button>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="number"
                step="10000"
                min="0"
                className="pro-input"
                style={{ flex: 1 }}
                value={depositAmount}
                onChange={(e) => setDepositAmount(Math.max(0, parseInt(e.target.value) || 0))}
                placeholder="入金額 (JPY)"
              />
              <button
                className="pro-btn primary"
                style={{ padding: "6px 14px", fontSize: "11px" }}
                onClick={() => {
                  if (depositAmount <= 0) return;
                  setIsDepositConfirmOpen(true);
                }}
              >
                入金確認へ
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {[100000, 300000, 500000, 1000000, 3000000, 5000000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="pro-btn"
                  style={{ padding: "2px 6px", fontSize: "10px" }}
                  onClick={() => setDepositAmount(preset)}
                >
                  +{preset.toLocaleString()}円
                </button>
              ))}
            </div>
          </div>
        )}

        {activeFundingAction === "withdraw" && (
          <div style={{ marginTop: "10px", padding: "10px", backgroundColor: "var(--surface-container-high)", borderRadius: "6px", border: "1px solid var(--outline-variant)", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: 600 }}>仮想出金額の指定 (出金可能額: {formatCurrency(freeMargin)})</span>
              <button className="modal-close-btn" style={{ padding: "2px" }} onClick={() => setActiveFundingAction("none")}>
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
              </button>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="number"
                step="10000"
                min="0"
                className="pro-input"
                style={{ flex: 1 }}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(Math.max(0, parseInt(e.target.value) || 0))}
                placeholder="出金額 (JPY)"
              />
              <button
                className="pro-btn primary"
                style={{ padding: "6px 14px", fontSize: "11px" }}
                onClick={() => {
                  if (withdrawAmount <= 0) return;
                  if (withdrawAmount > freeMargin) {
                    setActionError("出金額が余剰証拠金を超えています。");
                    return;
                  }
                  setActionError("");
                  setIsWithdrawConfirmOpen(true);
                }}
              >
                出金確認へ
              </button>
            </div>
            {actionError && (
              <div style={{ fontSize: "11px", color: "var(--status-danger)" }}>
                {actionError}
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {[100000, 300000, 500000, 1000000, 3000000, 5000000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="pro-btn"
                  style={{ padding: "2px 6px", fontSize: "10px" }}
                  onClick={() => setWithdrawAmount(preset)}
                >
                  {preset.toLocaleString()}円
                </button>
              ))}
            </div>
          </div>
        )}

        {activeFundingAction === "reset" && (
          <div style={{ marginTop: "10px", padding: "10px", backgroundColor: "var(--surface-container-high)", borderRadius: "6px", border: "1px solid var(--outline-variant)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "11px", color: "var(--on-surface-variant)" }}>
              口座残高を初期設定額（1,000,000円）にリセットし、現在保有中のポジションをすべてクリアします。
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button className="pro-btn" style={{ padding: "4px 8px", fontSize: "11px" }} onClick={() => setActiveFundingAction("none")}>
                キャンセル
              </button>
              <button className="pro-btn danger" style={{ padding: "4px 10px", fontSize: "11px" }} onClick={() => setIsResetConfirmOpen(true)}>
                初期化を実行
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. 保有ポジション一覧テーブル */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {safePositions.length === 0 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              color: "var(--on-surface-variant)",
              fontSize: "12px"
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "36px", opacity: 0.4 }}>
              layers_clear
            </span>
            <span>現在保有中のポジションはありません</span>
          </div>
        ) : (
          <table className="pro-table" style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--outline-variant)", color: "var(--on-surface-variant)" }}>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>Ticket</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>通貨ペア</th>
                <th style={{ padding: "8px 10px", textAlign: "center" }}>売買</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>数量</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>約定価格</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>SL / TP</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>評価損益</th>
                <th style={{ padding: "8px 10px", textAlign: "center" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {safePositions.map((pos) => {
                if (!pos) return null;
                const isBuy = pos.type === "BUY";
                const symbolStr = typeof pos.symbol === "string" ? pos.symbol : "";
                const isJpy = symbolStr.toUpperCase().includes("JPY") || Number(pos.open_price) > 20;
                const slNum = Number(pos.sl) || 0;
                const tpNum = Number(pos.tp) || 0;
                const sl = slNum > 0 ? formatRate(slNum, isJpy) : "-";
                const tp = tpNum > 0 ? formatRate(tpNum, isJpy) : "-";
                const volumeNum = Number(pos.volume) || 0;
                const openPriceNum = Number(pos.open_price) || 0;

                return (
                  <tr
                    key={pos.ticket}
                    style={{
                      borderBottom: "1px solid var(--outline-variant)",
                      transition: "background-color 0.15s ease"
                    }}
                  >
                    <td style={{ padding: "8px 10px", fontFamily: "var(--font-data)", color: "var(--on-surface-variant)" }}>
                      #{pos.ticket}
                    </td>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                      {symbolStr || "-"}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      <span
                        className={`badge ${isBuy ? "badge-buy" : "badge-sell"}`}
                        style={{ fontSize: "10.5px", padding: "2px 8px", fontWeight: 700, borderRadius: "4px" }}
                      >
                        {pos.type}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "var(--font-data)" }}>
                      {volumeNum.toFixed(contractSize === 100000 ? 2 : 0)}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "var(--font-data)" }}>
                      {formatRate(openPriceNum, isJpy)}
                    </td>
                    <td
                      style={{
                        padding: "8px 10px",
                        textAlign: "right",
                        fontFamily: "var(--font-data)",
                        fontSize: "11px",
                        color: "var(--on-surface-variant)"
                      }}
                    >
                      {sl} / {tp}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "var(--font-data)", fontWeight: 700 }}>
                      {formatPL(pos.profit)}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      <button
                        type="button"
                        className="pro-btn danger"
                        style={{ padding: "3px 10px", fontSize: "11px", height: "24px" }}
                        onClick={() => handleClosePosition(pos.ticket, volumeNum)}
                        title="このポジションを個別決済"
                      >
                        決済
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* フッターサマリー & クイック決済バー */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          backgroundColor: "var(--surface-container-high)",
          borderTop: "1px solid var(--outline-variant)",
          flexShrink: 0
        }}
      >
        <div style={{ display: "flex", gap: "16px", fontSize: "12px" }}>
          <span>
            BUY: <strong className="font-data">{totalBuyLots.toFixed(contractSize === 100000 ? 2 : 0)}</strong>
          </span>
          <span>
            SELL: <strong className="font-data">{totalSellLots.toFixed(contractSize === 100000 ? 2 : 0)}</strong>
          </span>
          <span>
            合計評価損益: <strong>{formatPL(totalPL)}</strong>
          </span>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          {safePositions.length > 0 && (
            <>
              {totalBuyLots > 0 && (
                <button
                  className="pro-btn"
                  style={{ padding: "4px 10px", fontSize: "11px" }}
                  onClick={handleCloseBuy}
                >
                  BUY全決済
                </button>
              )}
              {totalSellLots > 0 && (
                <button
                  className="pro-btn"
                  style={{ padding: "4px 10px", fontSize: "11px" }}
                  onClick={handleCloseSell}
                >
                  SELL全決済
                </button>
              )}
              <button
                className="pro-btn danger"
                style={{ padding: "4px 12px", fontSize: "11px", fontWeight: 600 }}
                onClick={handleCloseAll}
              >
                全決済
              </button>
            </>
          )}
        </div>
      </div>

      {/* 入金確認警告モーダル */}
      {isDepositConfirmOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setIsDepositConfirmOpen(false)}>
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
                  setActiveFundingAction("none");
                }}
              >
                ルールを理解した上で実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 出金確認警告モーダル */}
      {isWithdrawConfirmOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setIsWithdrawConfirmOpen(false)}>
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
                  setActiveFundingAction("none");
                }}
              >
                計画外の出金を実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* リセット確認警告モーダル */}
      {isResetConfirmOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setIsResetConfirmOpen(false)}>
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
                    initial_balance: 1000000,
                    leverage: leverage
                  });
                  setIsResetConfirmOpen(false);
                  setActiveFundingAction("none");
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
