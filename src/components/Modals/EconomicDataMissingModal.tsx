import React from "react";
import { formatYearMonthJapanese } from "../../utils/economicDataUtils";

export interface EconomicDataMissingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProceed: () => void;
  symbol: string;
  missingMonths: string[];
  availableMonths: string[];
  startTime: string;
  endTime: string;
}

export const EconomicDataMissingModal: React.FC<EconomicDataMissingModalProps> = ({
  isOpen,
  onClose,
  onProceed,
  symbol,
  missingMonths,
  availableMonths,
  startTime,
  endTime,
}) => {
  if (!isOpen) return null;

  const startFormatted = startTime ? startTime.substring(0, 16) : "";
  const endFormatted = endTime ? endTime.substring(0, 16) : "";

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal-card economic-missing-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "520px", width: "92%" }}
      >
        {/* モーダルヘッダー */}
        <div className="modal-header">
          <div className="modal-title-with-icon">
            <span className="material-symbols-outlined modal-header-icon text-warning">
              warning
            </span>
            <h3 className="modal-title">経済指標データの確認</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="閉じる">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* モーダル本体 */}
        <div className="modal-body">
          {/* 対象情報サマリー */}
          <div className="economic-summary-box">
            <div className="summary-row">
              <span className="summary-label">対象シンボル:</span>
              <span className="summary-val-badge font-data">{symbol || "USDJPY"}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">指定期間:</span>
              <span className="summary-val-time font-data">
                {startFormatted} 〜 {endFormatted}
              </span>
            </div>
          </div>

          {/* 未同期・不足月の一覧 */}
          <div className="economic-missing-section">
            <div className="missing-section-title">
              <span className="material-symbols-outlined icon text-warning">event_busy</span>
              <span>以下の年月の経済指標データ（Parquet）が存在しません：</span>
            </div>
            <div className="missing-months-list">
              {missingMonths.map((ym) => (
                <span className="missing-month-tag font-data" key={ym}>
                  <span className="dot" />
                  {formatYearMonthJapanese(ym)}
                </span>
              ))}
            </div>
            {availableMonths.length > 0 && (
              <div className="available-months-note">
                <span className="note-label">※ 取得済み期間:</span>
                <span className="note-val font-data">
                  {availableMonths.map((ym) => formatYearMonthJapanese(ym)).join(", ")}
                </span>
              </div>
            )}
          </div>

          {/* 動作に関する説明ボックス */}
          <div className="economic-info-alert">
            <span className="material-symbols-outlined alert-icon">info</span>
            <div className="alert-text">
              <p className="alert-main-desc">
                経済指標データがない期間では、指標発表前の先行スプレッド拡大モデル（動的スプレッド制御）は無効となり、
                <strong>通常スプレッドモード</strong>（平時固定スプレッド等）で動作します。
              </p>
              <p className="alert-sub-desc">
                ※ Drenhisアプリから該当期間のParquetデータを出力すると、指標連動モードが有効になります。
              </p>
            </div>
          </div>

          <p className="economic-confirm-prompt">このままリプレイを開始しますか？</p>
        </div>

        {/* モーダルフッター */}
        <div className="modal-footer">
          <button className="pro-btn secondary" onClick={onClose}>
            キャンセル
          </button>
          <button className="pro-btn primary btn-proceed" onClick={onProceed}>
            <span className="material-symbols-outlined icon">play_arrow</span>
            このまま開始する
          </button>
        </div>
      </div>
    </div>
  );
};
