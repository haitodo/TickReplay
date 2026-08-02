import React from "react";

interface HeaderBarProps {
  status: string;
  isAlwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  isRemoteMode: boolean;
  onToggleRemoteMode: () => void;
  hotkeysEnabled: boolean;
  onToggleHotkeys: () => void;
  onOpenHotkeysModal: () => void;
  onOpenImportModal: () => void;
  onRefreshTerminals?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  status,
  isAlwaysOnTop,
  onToggleAlwaysOnTop,
  isRemoteMode,
  onToggleRemoteMode,
  hotkeysEnabled,
  onToggleHotkeys,
  onOpenHotkeysModal,
  onOpenImportModal,
  onRefreshTerminals
}) => {
  const getStatusBadge = () => {
    switch (status) {
      case "CONNECTED":
        return <span className="status-badge connected">接続完了</span>;
      case "READY":
        return <span className="status-badge ready">準備完了</span>;
      case "ACTIVE":
        return <span className="status-badge active">再生中</span>;
      case "ERROR":
        return <span className="status-badge error">エラー</span>;
      default:
        return (
          <button className="status-badge-btn disconnected" onClick={onRefreshTerminals}>
            EA接続待ち... (クリックで再読み込み)
          </button>
        );
    }
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <h1 className="app-title">TickReplay Controller</h1>
        {getStatusBadge()}
      </div>
      <div className="header-right">
        <button className="icon-btn" onClick={onOpenImportModal} title="カスタムシンボル一括インポート">
          📁 データ取込
        </button>
        <button className="icon-btn" onClick={onOpenHotkeysModal} title="ショートカット一覧">
          ⌨️ ショートカット一覧
        </button>
        <button
          className={`toggle-btn ${hotkeysEnabled ? "active" : ""}`}
          onClick={onToggleHotkeys}
          title="グローバルショートカットの有効/無効"
        >
          ショートカット: {hotkeysEnabled ? "ON" : "OFF"}
        </button>
        <button
          className={`toggle-btn ${isAlwaysOnTop ? "active" : ""}`}
          onClick={onToggleAlwaysOnTop}
          title="最前面に固定"
        >
          📌 最前面固定
        </button>
        <button
          className={`toggle-btn ${isRemoteMode ? "active" : ""}`}
          onClick={onToggleRemoteMode}
          title="リモコンミニモード切り替え"
        >
          📺 リモコン
        </button>
      </div>
    </header>
  );
};
