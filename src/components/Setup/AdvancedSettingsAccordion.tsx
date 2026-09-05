import React, { useState } from "react";
import { CustomSelect } from "../../CustomSelect";
import { HelpTooltip } from "../HelpTooltip";
import { TerminalInfo } from "../../types/terminal";
import { MaxBarsInfo } from "../../utils/hotkeyUtils";
import { getNewsTimeForDisplay } from "../../utils/timeUtils";

export interface AdvancedSettingsAccordionProps {
  terminals: TerminalInfo[];
  selectedTerminal: string;
  setSelectedTerminal: (val: string) => void;
  handleOpenTerminalNameModal: () => void;
  profiles: string[];
  selectedProfile: string;
  setSelectedProfile: (val: string) => void;
  maxBarsInfo: MaxBarsInfo | null;
  preloadMode: "BARS" | "DATE";
  setPreloadMode: (val: "BARS" | "DATE") => void;
  preloadTimeframe: string;
  setPreloadTimeframe: (val: string) => void;
  preloadedBars: number;
  setPreloadedBars: (val: number) => void;
  preloadDate: string;
  setActivePickerField: (val: "preload" | "start" | "end" | null) => void;
  timezoneMode: "JST" | "SERVER";
  limitTickHistory: boolean;
  setLimitTickHistory: (val: boolean) => void;
  tickHistoryTimeframe: string;
  setTickHistoryTimeframe: (val: string) => void;
  maxHistoryBars: number;
  setMaxHistoryBars: (val: number) => void;
  initialBalance: number;
  setInitialBalance: (val: number) => void;
  leverage: number;
  setLeverage: (val: number) => void;
  contractSize: number;
  setContractSize: (val: number) => void;
  sourceSymbol: string;
  enablePseudoRate: boolean;
  setEnablePseudoRate: (val: boolean) => void;
  pseudoMode?: "dmm" | "fixed" | "aggressive" | "custom";
  setPseudoMode?: (val: "dmm" | "fixed" | "aggressive" | "custom") => void;
  pseudoBaseSpread: number;
  setPseudoBaseSpread: (val: number) => void;
  pseudoThreshold: number;
  setPseudoThreshold: (val: number) => void;
  pseudoSensitivity: number;
  setPseudoSensitivity: (val: number) => void;
  pseudoRolloverEnabled?: boolean;
  setPseudoRolloverEnabled?: (val: boolean) => void;
  pseudoRolloverSpread?: number;
  setPseudoRolloverSpread?: (val: number) => void;
  pseudoRolloverRecoveryMin?: number;
  setPseudoRolloverRecoveryMin?: (val: number) => void;
  handleSelectPreset: (mode: "dmm" | "fixed" | "aggressive") => void;
  autoScrollSync: boolean;
  setAutoScrollSync: (val: boolean) => void;
  autoSkipWeekend: boolean;
  setAutoSkipWeekend: (val: boolean) => void;
}

export const AdvancedSettingsAccordion: React.FC<AdvancedSettingsAccordionProps> = ({
  terminals,
  selectedTerminal,
  setSelectedTerminal,
  handleOpenTerminalNameModal,
  profiles,
  selectedProfile,
  setSelectedProfile,
  maxBarsInfo,
  preloadMode,
  setPreloadMode,
  preloadTimeframe,
  setPreloadTimeframe,
  preloadedBars,
  setPreloadedBars,
  preloadDate,
  setActivePickerField,
  timezoneMode,
  limitTickHistory,
  setLimitTickHistory,
  tickHistoryTimeframe,
  setTickHistoryTimeframe,
  maxHistoryBars,
  setMaxHistoryBars,
  initialBalance,
  setInitialBalance,
  leverage,
  setLeverage,
  contractSize,
  setContractSize,
  sourceSymbol,
  enablePseudoRate,
  setEnablePseudoRate,
  pseudoMode = "dmm",
  setPseudoMode,
  pseudoBaseSpread,
  setPseudoBaseSpread,
  pseudoThreshold,
  setPseudoThreshold,
  pseudoSensitivity,
  setPseudoSensitivity,
  pseudoRolloverEnabled = true,
  setPseudoRolloverEnabled,
  pseudoRolloverSpread = 3.5,
  setPseudoRolloverSpread,
  pseudoRolloverRecoveryMin = 15,
  setPseudoRolloverRecoveryMin,
  handleSelectPreset,
  autoScrollSync,
  setAutoScrollSync,
  autoSkipWeekend,
  setAutoSkipWeekend,
}) => {
  // アコーディオン開閉状態の永続化
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    return localStorage.getItem("tickreplay_setup_advanced_open") === "true";
  });

  const toggleAccordion = () => {
    setIsOpen((prev) => {
      const next = !prev;
      localStorage.setItem("tickreplay_setup_advanced_open", String(next));
      return next;
    });
  };

  // 1Lot証拠金・Pip価値・最大ロット計算
  const estRate = sourceSymbol.toUpperCase().includes("JPY") ? 150 : 1.0;
  const levSafe = leverage > 0 ? leverage : 25;
  const reqMarginPerLot = Math.round((estRate * contractSize) / levSafe);
  const pipValue = Math.round(0.01 * contractSize);
  const maxLots = reqMarginPerLot > 0 ? ((initialBalance / reqMarginPerLot) || 0).toFixed(1) : "0.0";

  // 選択中MT5ターミナルの表示名取得
  const selectedTerminalObj = terminals.find((t) => t.path === selectedTerminal);
  const terminalTitle = selectedTerminalObj
    ? selectedTerminalObj.custom_name || selectedTerminalObj.name
    : "MT5未選択";

  return (
    <div className={`advanced-settings-accordion ${isOpen ? "open" : ""}`}>
      {/* アコーディオンヘッダー ＋ 常時可視サマリーチップ */}
      <div
        className="advanced-settings-header"
        onClick={toggleAccordion}
        title="クリックで高度な環境設定を開閉"
      >
        <div className="accordion-title-wrapper">
          <span className="material-symbols-outlined accordion-toggle-icon">
            {isOpen ? "expand_more" : "chevron_right"}
          </span>
          <span className="material-symbols-outlined accordion-header-icon">tune</span>
          <span className="accordion-title">高度な環境設定 (通常変更不要)</span>
        </div>

        {/* 常時可視の環境サマリーチップ */}
        <div className="advanced-summary-chips" onClick={(e) => e.stopPropagation()}>
          <span className="summary-chip" title={`選択中のMT5ターミナル: ${terminalTitle}`}>
            <span className="material-symbols-outlined chip-icon">terminal</span>
            <span className="chip-text">{terminalTitle}</span>
          </span>
          <span className="summary-chip" title={`チャートプロファイル: ${selectedProfile || "未選択"}`}>
            <span className="material-symbols-outlined chip-icon">monitoring</span>
            <span className="chip-text">{selectedProfile || "PF未設定"}</span>
          </span>
          <span className="summary-chip" title="仮想口座残高とレバレッジ">
            <span className="material-symbols-outlined chip-icon">account_balance_wallet</span>
            <span className="chip-text">{initialBalance.toLocaleString()}円 ({leverage}倍)</span>
          </span>
          <span className="summary-chip" title="スプレッド設定モード">
            <span className="material-symbols-outlined chip-icon">stacked_line_chart</span>
            <span className="chip-text">
              {enablePseudoRate
                ? pseudoMode === "dmm"
                  ? `DMM再現 (${pseudoBaseSpread}p)`
                  : pseudoMode === "fixed"
                  ? `固定 (${pseudoBaseSpread}p)`
                  : pseudoMode === "aggressive"
                  ? `厳格 (${pseudoBaseSpread}p)`
                  : `カスタム (${pseudoBaseSpread}p)`
                : "生レート"}
            </span>
          </span>
          <span className="summary-chip" title={`過去足プリロード設定: ${preloadMode === "BARS" ? `${preloadTimeframe} ${preloadedBars}本` : preloadDate || "日付指定"}`}>
            <span className="material-symbols-outlined chip-icon">history</span>
            <span className="chip-text">
              {preloadMode === "BARS" ? `${preloadTimeframe} ${preloadedBars}本` : "日付指定"}
            </span>
          </span>
          {autoScrollSync && (
            <span className="summary-chip-subtle" title="チャート自動追従スクロール有効">
              追従ON
            </span>
          )}
          {autoSkipWeekend && (
            <span className="summary-chip-subtle" title="土日休場スキップ有効">
              週末スキップON
            </span>
          )}
        </div>
      </div>

      {/* アコーディオン展開時コンテンツ */}
      {isOpen && (
        <div className="advanced-settings-body">
          <div className="setup-2col-layout">
            {/* ---------------- 左カラム (接続・プリロード) ---------------- */}
            <div className="setup-column">
              {/* カード1: MT5接続 & プロファイル */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">settings_ethernet</span>
                    <span className="header-title">MT5接続 &amp; チャート設定</span>
                  </div>
                  {maxBarsInfo && (
                    <div className="max-bars-badge-top">
                      {maxBarsInfo.is_unlimited ? (
                        <span className="max-bars-pill unlimited" title="チャート最大バー数は無制限に設定されています">
                          <span className="material-symbols-outlined icon">check_circle</span>
                          Unlimited
                        </span>
                      ) : (
                        <span className="max-bars-pill limited" title="チャート最大バー数に制限があります">
                          <span className="material-symbols-outlined icon">warning</span>
                          {maxBarsInfo.max_bars > 0 ? `${maxBarsInfo.max_bars.toLocaleString()}本` : "制限あり"}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="card-body-dashboard">
                  <div className="form-grid-2col">
                    <div className="form-group-compact">
                      <div className="label-row">
                        <label className="form-label-compact">
                          MT5ターミナル
                          <HelpTooltip
                            title="MT5ターミナル"
                            content="リプレイ連携を行うMetaTrader 5の実行環境を選択します。EAが配置されているターミナルを指定してください。"
                          />
                        </label>
                        {selectedTerminal && (
                          <button
                            type="button"
                            className="btn-text-accent"
                            onClick={handleOpenTerminalNameModal}
                            title="選択中のMT5ターミナルに別名を設定"
                          >
                            <span className="material-symbols-outlined icon">edit_note</span>
                            名前を変更
                          </button>
                        )}
                      </div>
                      <CustomSelect
                        value={selectedTerminal}
                        onChange={setSelectedTerminal}
                        options={
                          terminals.length > 0
                            ? terminals.map((t) => {
                                const displayTitle = t.custom_name || t.name;
                                const subText = t.origin_path || (t.id ? `ID: ${t.id}` : "");
                                return {
                                  value: t.path,
                                  triggerLabel: displayTitle,
                                  label: (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "1px", width: "100%", overflow: "hidden" }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                        <span style={{ fontWeight: 600 }}>{displayTitle}</span>
                                        {t.custom_name && t.default_name && (
                                          <span style={{ fontSize: "10px", color: "var(--on-surface-variant)", opacity: 0.8 }}>
                                            ({t.default_name})
                                          </span>
                                        )}
                                      </div>
                                      {subText && (
                                        <span style={{ fontSize: "9px", color: "var(--on-surface-variant)", opacity: 0.65, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                          {subText}
                                        </span>
                                      )}
                                    </div>
                                  ),
                                };
                              })
                            : [{ value: "", label: "No Terminals Found" }]
                        }
                      />
                    </div>

                    <div className="form-group-compact">
                      <div className="label-row">
                        <label className="form-label-compact">
                          チャートプロファイル (.chr)
                          <HelpTooltip
                            title="チャートプロファイル"
                            content="リプレイ開始時にMT5側で自動的に読み込まれるチャートの組表示テンプレートを選択します。"
                          />
                        </label>
                      </div>
                      <CustomSelect
                        value={selectedProfile}
                        onChange={setSelectedProfile}
                        options={profiles.map((p) => ({ value: p, label: p }))}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* カード2: プリロード設定 */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">history</span>
                    <span className="header-title">プリロード設定</span>
                    <HelpTooltip
                      title="プリロード設定"
                      content="リプレイ開始直前の過去ローソク足チャートやティック履歴の読み込み設定です。インジケーターの初期計算や環境認識に必要な過去データを事前に展開します。"
                    />
                  </div>
                </div>

                <div className="card-body-dashboard">
                  {/* プリロード方式 */}
                  <div className="preload-grid">
                    <div className="form-group-compact">
                      <label className="form-label-compact">
                        プリロード方式
                        <HelpTooltip
                          title="プリロード方式"
                          content="リプレイ開始直前の過去ローソク足をどう読み込むかを指定します。"
                        />
                      </label>
                      <CustomSelect
                        value={preloadMode}
                        onChange={(val) => setPreloadMode(val as "BARS" | "DATE")}
                        options={[
                          { value: "BARS", label: "過去バー本数指定" },
                          { value: "DATE", label: "過去日付指定" },
                        ]}
                      />
                    </div>

                    {preloadMode === "BARS" ? (
                      <div className="form-group-compact">
                        <label className="form-label-compact">読込バー本数 ({preloadTimeframe})</label>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <CustomSelect
                            value={preloadTimeframe}
                            onChange={setPreloadTimeframe}
                            options={[
                              { value: "AUTO", label: "自動" },
                              { value: "M1", label: "M1" },
                              { value: "M5", label: "M5" },
                              { value: "M15", label: "M15" },
                              { value: "H1", label: "H1" },
                              { value: "D1", label: "D1" },
                            ]}
                          />
                          <input
                            type="number"
                            className="input-compact font-data"
                            style={{ width: "80px" }}
                            value={preloadedBars}
                            onChange={(e) => setPreloadedBars(parseInt(e.target.value) || 0)}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="form-group-compact">
                        <label className="form-label-compact">プリロード開始日時</label>
                        <div className="input-with-icon-compact" onClick={() => setActivePickerField("preload")}>
                          <input
                            type="text"
                            readOnly
                            className="input-compact cursor-pointer font-data"
                            value={timezoneMode === "JST" ? preloadDate : getNewsTimeForDisplay(preloadDate, "SERVER")}
                          />
                          <span className="material-symbols-outlined icon">calendar_today</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 高速シーク（履歴制限） */}
                  <div className="fast-seek-box">
                    <label className="toggle-switch-label">
                      <input
                        type="checkbox"
                        checked={limitTickHistory}
                        onChange={(e) => setLimitTickHistory(e.target.checked)}
                      />
                      <span className="switch-text">直近ティック履歴制限（高速シーク・メモリ軽量化）</span>
                    </label>
                    {limitTickHistory && (
                      <div className="fast-seek-params">
                        <span className="params-label">保持範囲:</span>
                        <CustomSelect
                          value={tickHistoryTimeframe}
                          onChange={setTickHistoryTimeframe}
                          options={[
                            { value: "M1", label: "1分足" },
                            { value: "M5", label: "5分足" },
                            { value: "M15", label: "15分足" },
                            { value: "H1", label: "1時間足" },
                          ]}
                        />
                        <span className="params-label">×</span>
                        <input
                          type="number"
                          className="input-compact font-data"
                          style={{ width: "65px" }}
                          value={maxHistoryBars}
                          onChange={(e) => setMaxHistoryBars(parseInt(e.target.value) || 0)}
                        />
                        <span className="params-label">本</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ---------------- 右カラム (仮想口座・スプレッド・オプション) ---------------- */}
            <div className="setup-column">
              {/* カード3: 仮想口座 & 証拠金パラメータ */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">account_balance</span>
                    <span className="header-title">仮想口座 &amp; 証拠金パラメータ</span>
                  </div>
                </div>

                <div className="card-body-dashboard">
                  <div className="form-group-compact">
                    <label className="form-label-compact">
                      初期口座資金 (JPY)
                      <HelpTooltip
                        title="初期口座資金"
                        content="リプレイ開始時の仮想口座残高（日本円）を設定します。リプレイ中もポジション画面から追加入金や出金が可能です。"
                      />
                    </label>
                    <input
                      type="number"
                      className="input-compact font-data"
                      value={initialBalance}
                      onChange={(e) => setInitialBalance(parseInt(e.target.value) || 0)}
                    />
                  </div>

                  <div className="grid-2-col-compact">
                    <div className="form-group-compact">
                      <label className="form-label-compact">
                        レバレッジ (倍)
                        <HelpTooltip
                          title="レバレッジ"
                          content="口座の最大レバレッジ倍率です（国内FX標準は25倍、海外FX等は100〜500倍等）。"
                        />
                      </label>
                      <input
                        type="number"
                        className="input-compact font-data"
                        value={leverage}
                        onChange={(e) => setLeverage(parseInt(e.target.value) || 0)}
                      />
                    </div>
                    <div className="form-group-compact">
                      <label className="form-label-compact">
                        契約サイズ (通貨単位)
                        <HelpTooltip
                          title="契約サイズ (Contract Size)"
                          content="1.0ロットあたりの通貨単位です。国内業者や多くのミニ口座は10,000通貨、標準口座は100,000通貨です。"
                        />
                      </label>
                      <CustomSelect
                        value={contractSize.toString()}
                        onChange={(val) => setContractSize(parseInt(val) || 10000)}
                        options={[
                          { value: "1000", label: "1,000 (マイクロ)" },
                          { value: "10000", label: "10,000 (ミニ)" },
                          { value: "100000", label: "100,000 (スタンダード)" },
                        ]}
                      />
                    </div>
                  </div>

                  {/* 証拠金・Pip価値リアルタイム試算プレビュー */}
                  <div className="trading-calc-preview">
                    <div className="calc-row">
                      <span className="calc-label">1.0Lot 必要証拠金 ({sourceSymbol || "USDJPY"} 換算):</span>
                      <span className="calc-val font-data">{reqMarginPerLot.toLocaleString()} 円</span>
                    </div>
                    <div className="calc-row">
                      <span className="calc-label">1.0Lot 1Pip変動損益価値:</span>
                      <span className="calc-val font-data">{pipValue.toLocaleString()} 円 / Pip</span>
                    </div>
                    <div className="calc-row">
                      <span className="calc-label">最大発注可能ロット数 (余力全額):</span>
                      <span className="calc-val font-data text-accent">{maxLots} Lots</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* カード4: スプレッド方式 & コスト */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">stacked_line_chart</span>
                    <span className="header-title">スプレッド方式 &amp; コスト設定</span>
                    <HelpTooltip
                      title="疑似スプレッドとは"
                      placement="auto"
                      iconSize={14}
                      content={
                        <div style={{ lineHeight: 1.7, fontSize: "12px" }}>
                          <p style={{ margin: "0 0 8px" }}>
                            MT5（OANDA等）の広めの変動スプレッドから、国内ブローカー（DMM等）の実態に合わせた「原則固定スプレッド」および「早朝・指標時の適応スプレッド」を高精度に再現します。
                          </p>
                          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>📐 計算仕様</p>
                          <p style={{ margin: "0 0 4px" }}>
                            <strong>平常時（08:00〜翌05:00 JST）：</strong><br />
                            <code style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: 3 }}>
                              MT5 ≦ しきい値：平常時スプレッド（例: 0.2 pips）
                            </code>
                          </p>
                          <p style={{ margin: "0 0 4px" }}>
                            <strong>早朝ロールオーバー（06:00〜07:00 JST）：</strong><br />
                            <code style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: 3 }}>
                              DMM基準値（約3.5 pips）＋ 連動拡大（07:00〜07:15に滑らかに復帰）
                            </code>
                          </p>
                          <p style={{ margin: "0" }}>
                            <strong>急変動・指標時（MT5 ＞ しきい値）：</strong><br />
                            <code style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: 3 }}>
                              適用スプレッド = 基準値 + 感度係数 × (MT5スプレッド − しきい値)
                            </code>
                          </p>
                        </div>
                      }
                      tip="平常時は狭小固定スプレッドを維持し、早朝ロールオーバーや指標発表時はDMM実態に合わせたリアルな拡大カーブで再現します。"
                    />
                  </div>
                </div>

                <div className="card-body-dashboard">
                  <label className="toggle-switch-label">
                    <input
                      type="checkbox"
                      checked={enablePseudoRate}
                      onChange={(e) => setEnablePseudoRate(e.target.checked)}
                    />
                    <span className="switch-text">国内ブローカー風 疑似スプレッド適用</span>
                  </label>

                  {enablePseudoRate ? (
                    <div>
                      {/* プリセット選択ボタン */}
                      <div className="pseudo-preset-group">
                        <button
                          type="button"
                          className={`pseudo-preset-btn ${pseudoMode === "dmm" ? "active" : ""}`}
                          onClick={() => handleSelectPreset("dmm")}
                          title="DMMの実測挙動（0.2銭固定＋早朝3.5銭＋最適感度0.30）を高精度再現"
                        >
                          ⭐ DMM再現
                        </button>
                        <button
                          type="button"
                          className={`pseudo-preset-btn ${pseudoMode === "fixed" ? "active" : ""}`}
                          onClick={() => handleSelectPreset("fixed")}
                          title="急変動・早朝に関わらずスプレッドを0.2銭完全固定"
                        >
                          🔒 完全固定
                        </button>
                        <button
                          type="button"
                          className={`pseudo-preset-btn ${pseudoMode === "aggressive" ? "active" : ""}`}
                          onClick={() => handleSelectPreset("aggressive")}
                          title="指標時や早朝に厳しめのスプレッドで検証する高負荷モード"
                        >
                          ⚡ 厳格検証
                        </button>
                        <button
                          type="button"
                          className={`pseudo-preset-btn ${pseudoMode === "custom" ? "active" : ""}`}
                          onClick={() => { if (setPseudoMode) setPseudoMode("custom"); }}
                          title="パラメータを自由に手動調整"
                        >
                          ⚙️ カスタム
                        </button>
                      </div>

                      <div className="pseudo-spread-grid">
                        <div className="form-group-compact">
                          <label className="form-label-compact" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            平常時スプレッド (Pips)
                            <HelpTooltip
                              title="平常時スプレッド"
                              placement="auto"
                              iconSize={12}
                              content={
                                <div style={{ lineHeight: 1.7, fontSize: "12px" }}>
                                  <p style={{ margin: "0 0 6px" }}>
                                    MT5のスプレッドが「拡大しきい値」以下のとき（平常時）に適用される固定スプレッドです。
                                  </p>
                                  <p style={{ margin: "0 0 4px", fontWeight: 600 }}>推奨値の目安：</p>
                                  <ul style={{ margin: "0", paddingLeft: 16 }}>
                                    <li>USDJPY：0.2 pips（DMM標準）</li>
                                    <li>EURUSD：0.4 pips</li>
                                    <li>GBPJPY：0.9 pips</li>
                                    <li>EURJPY / AUDJPY：0.4〜0.6 pips</li>
                                    <li>XAUUSD（Gold）：1.5 pips</li>
                                  </ul>
                                </div>
                              }
                            />
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            className="input-compact font-data"
                            value={pseudoBaseSpread}
                            onChange={(e) => {
                              setPseudoBaseSpread(parseFloat(e.target.value) || 0);
                              if (setPseudoMode) setPseudoMode("custom");
                            }}
                          />
                        </div>
                        <div className="form-group-compact">
                          <label className="form-label-compact" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            拡大しきい値 (Pips)
                            <HelpTooltip
                              title="拡大しきい値"
                              placement="auto"
                              iconSize={12}
                              content={
                                <div style={{ lineHeight: 1.7, fontSize: "12px" }}>
                                  <p style={{ margin: "0 0 6px" }}>
                                    MT5の生スプレッドがこの値を超えたときにスプレッド拡大計算が始まります。
                                    通常時のMT5スプレッドがこの値以下であれば、常に「平常時スプレッド」が維持されます。
                                  </p>
                                  <p style={{ margin: "0 0 4px", fontWeight: 600 }}>推奨値の目安：</p>
                                  <ul style={{ margin: "0", paddingLeft: 16 }}>
                                    <li>USDJPY：1.8 pips（41.8万ティック実測最適値）</li>
                                    <li>EURUSD：1.0 pips</li>
                                    <li>GBPJPY：2.0 pips</li>
                                    <li>XAUUSD（Gold）：4.0 pips</li>
                                  </ul>
                                  <p style={{ margin: "6px 0 0", color: "var(--status-warning)" }}>
                                    ⚠️ 0に設定するとすべてのティックで拡大計算が適用されるため、スプレッドが常に広くなります。
                                  </p>
                                </div>
                              }
                            />
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            className="input-compact font-data"
                            value={pseudoThreshold}
                            onChange={(e) => {
                              setPseudoThreshold(parseFloat(e.target.value) || 0);
                              if (setPseudoMode) setPseudoMode("custom");
                            }}
                          />
                        </div>
                        <div className="form-group-compact" style={{ gridColumn: "span 2" }}>
                          <label className="form-label-compact" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            拡大感度係数 (0.0〜2.0)
                            <HelpTooltip
                              title="拡大感度係数"
                              placement="auto"
                              iconSize={12}
                              content={
                                <div style={{ lineHeight: 1.7, fontSize: "12px" }}>
                                  <p style={{ margin: "0 0 6px" }}>
                                    MT5スプレッドが「拡大しきい値」を超えたとき、その超過分に掛ける倍率です。
                                  </p>
                                  <p style={{ margin: "0 0 4px" }}>
                                    <strong>例（USDJPY、しきい値=1.8pips、感度=0.30、MT5スプレッド=3.0pips）：</strong><br />
                                    <code style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: 3 }}>
                                      0.2 + 0.30 × (3.0 − 1.8) = 0.56 ➔ 0.6 pips
                                    </code>
                                  </p>
                                  <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
                                    <li><strong>0.30</strong>：USDJPY実測最適推奨値。急拡大時も国内業者風に穏やかに反映</li>
                                    <li><strong>1.0</strong>：MT5スプレッド急拡大超過分をそのまま反映</li>
                                    <li><strong>0.0</strong>：急拡大時も平常時スプレッドのまま固定</li>
                                  </ul>
                                </div>
                              }
                            />
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            min="0"
                            max="2"
                            className="input-compact font-data"
                            value={pseudoSensitivity}
                            onChange={(e) => {
                              setPseudoSensitivity(parseFloat(e.target.value) || 0);
                              if (setPseudoMode) setPseudoMode("custom");
                            }}
                          />
                        </div>

                        {/* 早朝ロールオーバー詳細設定 */}
                        <div className="pseudo-rollover-box">
                          <label className="toggle-switch-label" style={{ margin: 0 }}>
                            <input
                              type="checkbox"
                              checked={pseudoRolloverEnabled}
                              onChange={(e) => {
                                if (setPseudoRolloverEnabled) setPseudoRolloverEnabled(e.target.checked);
                                if (setPseudoMode) setPseudoMode("custom");
                              }}
                            />
                            <span className="switch-text" style={{ fontSize: "11px", fontWeight: 600 }}>
                              早朝ロールオーバー自動適応（06:00〜07:15 JST）
                            </span>
                          </label>

                          {pseudoRolloverEnabled && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
                              <div className="form-group-compact">
                                <label className="form-label-compact" style={{ fontSize: "10px" }}>
                                  早朝基準スプレッド (Pips)
                                </label>
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  className="input-compact font-data"
                                  value={pseudoRolloverSpread}
                                  onChange={(e) => {
                                    if (setPseudoRolloverSpread) setPseudoRolloverSpread(parseFloat(e.target.value) || 0);
                                    if (setPseudoMode) setPseudoMode("custom");
                                  }}
                                />
                              </div>
                              <div className="form-group-compact">
                                <label className="form-label-compact" style={{ fontSize: "10px" }}>
                                  早朝復帰時間 (分)
                                </label>
                                <input
                                  type="number"
                                  step="5"
                                  min="0"
                                  max="60"
                                  className="input-compact font-data"
                                  value={pseudoRolloverRecoveryMin}
                                  onChange={(e) => {
                                    if (setPseudoRolloverRecoveryMin) setPseudoRolloverRecoveryMin(parseInt(e.target.value) || 0);
                                    if (setPseudoMode) setPseudoMode("custom");
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="spread-disabled-hint">
                      <span className="material-symbols-outlined icon">info</span>
                      <span>ヒストリカルデータに記録されている生のBid/Askスプレッドをそのまま適用します。</span>
                    </div>
                  )}
                </div>
              </div>

              {/* カード5: 表示 & 同期オプション */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">settings_suggest</span>
                    <span className="header-title">表示 &amp; 同期オプション</span>
                  </div>
                </div>

                <div className="card-body-dashboard">
                  <div className="options-checkbox-grid">
                    <label className="checkbox-compact">
                      <input
                        type="checkbox"
                        checked={autoScrollSync}
                        onChange={(e) => setAutoScrollSync(e.target.checked)}
                      />
                      <div className="checkbox-text-group">
                        <span className="cb-title">チャート自動追従スクロール</span>
                        <span className="cb-desc">再生に合わせてMT5チャートを自動で右端へスクロール</span>
                      </div>
                    </label>
                    <label className="checkbox-compact">
                      <input
                        type="checkbox"
                        checked={autoSkipWeekend}
                        onChange={(e) => setAutoSkipWeekend(e.target.checked)}
                      />
                      <div className="checkbox-text-group">
                        <span className="cb-title">土日休場スキップ</span>
                        <span className="cb-desc">時間比率モード時にティックのない週末を自動スキップ</span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* カード6: 執行ルール情報 */}
              <div className="setup-card-dashboard">
                <div className="card-header-dashboard">
                  <div className="header-title-wrapper">
                    <span className="material-symbols-outlined header-icon">gavel</span>
                    <span className="header-title">リプレイ仮想取引ルール</span>
                  </div>
                </div>

                <div className="card-body-dashboard">
                  <div className="rules-mini-list">
                    <div className="rule-item">
                      <span className="material-symbols-outlined icon text-green">check_circle</span>
                      <span><strong>バー内ティック即時約定:</strong> MT5チャートと1ms単位で完全同期</span>
                    </div>
                    <div className="rule-item">
                      <span className="material-symbols-outlined icon text-cyan">check_circle</span>
                      <span><strong>指値/逆指値自動判定:</strong> TP/SLヒット時に瞬時に自動決済</span>
                    </div>
                    <div className="rule-item">
                      <span className="material-symbols-outlined icon text-indigo">check_circle</span>
                      <span><strong>スピード発注・ホットキー連携:</strong> 成行・ドテン・全決済に完全対応</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
