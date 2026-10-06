import React, { useState, useEffect, useRef } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { useDataSources } from "../hooks/useDataSources";
import { getErrorMessage } from "../utils/getErrorMessage";
import {
  formatJstTime,
  formatServerTime,
  parseTimeStrToUtcMs,
  getServerToUtcOffsetHours,
  convertJstStrToServerStr,
  getNewsTimeForDisplay
} from "../utils/timeUtils";

interface ReplayNewsItem {
  id: number;
  time: string;
  currency: string;
  event: string;
  importance: string;
  actual: string;
  forecast: string;
  previous: string;
}

interface AIAnalysisPanelProps {
  isOpen: boolean;
  onClose: () => void;
  virtualTimeMsc: number;
  symbol: string;
  newsItems: ReplayNewsItem[];
  openRouterApiKey: string;
  openRouterModel: string;
  fredApiKey?: string;
  finnhubApiKey?: string;
  timezoneMode: "JST" | "SERVER";
}

export const AIAnalysisPanel: React.FC<AIAnalysisPanelProps> = ({
  isOpen,
  onClose,
  virtualTimeMsc,
  symbol,
  newsItems,
  openRouterApiKey,
  openRouterModel,
  fredApiKey,
  finnhubApiKey,
  timezoneMode
}) => {
  const [rangeHours, setRangeHours] = useState<number>(3);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisText, setAnalysisText] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);

  const { progress, fetchContextData } = useDataSources();
  const abortControllerRef = useRef<AbortController | null>(null);

  // 日時文字列フォーマット
  const formatTime = (msc: number) => {
    if (!msc) return "N/A";
    if (timezoneMode === "JST") {
      return `${formatJstTime(msc)} JST`;
    }
    const serverUtcOffset = getServerToUtcOffsetHours(msc);
    const sign = serverUtcOffset >= 0 ? "+" : "";
    return `${formatServerTime(msc)} SRV (GMT${sign}${serverUtcOffset})`;
  };

  const handleStartAnalysis = async () => {
    if (!openRouterApiKey) {
      setErrorMessage("OpenRouter API Keyが設定されていません。システム設定 → AIタブでAPI Keyを入力してください。");
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsAnalyzing(true);
    setErrorMessage("");
    setAnalysisText("");
    setCopied(false);
    setSaved(false);

    try {
      // 1. 周辺のMT5経済指標を抽出 (±rangeHours)
      const rangeMs = rangeHours * 3600 * 1000;
      const targetTimeStr = formatTime(virtualTimeMsc);
      const filteredNews = newsItems.filter(item => {
        const newsServerMsc = parseTimeStrToUtcMs(convertJstStrToServerStr(item.time));
        if (isNaN(newsServerMsc)) return false;
        return Math.abs(newsServerMsc - virtualTimeMsc) <= rangeMs;
      });

      const newsStr =
        filteredNews.length > 0
          ? filteredNews
              .map(
                n =>
                  `- [${getNewsTimeForDisplay(n.time, timezoneMode)}] ${n.currency} ${n.event} (重要度:${n.importance}) -> 結果:${n.actual} / 予想:${n.forecast} / 前回:${n.previous}`
              )
              .join("\n")
          : "指定時間帯に発表された掲載指標なし";

      // 2. GDELT / FRED / Finnhub からデータ収集
      const contextData = await fetchContextData(virtualTimeMsc, symbol, {
        rangeHours,
        fredApiKey,
        finnhubApiKey
      });

      // 3. LLMプロンプトの作成
      const systemPrompt = `あなたはFX・為替市場の最高峰アナリストです。
提供された経済指標・GDELTニュース・政策データを総合分析し、指定日時における急変動やトレンド発生の背景・要因を正確かつ論理的に説明してください。

特に【総理大臣・大統領・財務相・財務官の口頭介入・中銀総裁の発言・SNS投稿・地政学動向】が価格変動の引き金になった可能性を優先的に検証してください。

回答は必ず以下のMarkdownフォーマットに従ってください：

## 🗣️ 要人発言・政治要因（確信度: 高/中/低）
（大統領・総理大臣・財務相・財務官・中銀総裁の発言や介入、政治イベントの影響）

## 📌 経済指標・テクニカル要因（確信度: 高/中/低）
（経済指標結果のサプライズや、関連するテクニカル/流動性イベント）

## 🌍 マクロ背景・センチメント
（その時点までに形成されていた市場全体の強弱バランスや思惑）

## ⚠️ 情報の限界とGoogle検索キーワード
（AI知識カットオフやデータ不足で不確定な点と、ユーザーがGoogleで検索すべき具体的キーワード）`;

      const userPrompt = `【リプレイ分析リクエスト】
- 通貨ペア: ${symbol}
- リプレイ対象日時: ${targetTimeStr}
- 検索範囲: ±${rangeHours}時間

【MT5 経済指標データ (±${rangeHours}時間)】
${newsStr}

【取得されたニュース・要人・地政学コンテキスト】
${contextData.summaryText}`;

      // 4. OpenRouter Streaming Call
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://github.com/haitodo/TickReplay",
          "X-Title": "TickReplay AI Analyzer"
        },
        body: JSON.stringify({
          model: openRouterModel || "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          stream: true
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP エラー ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");

      if (!reader) {
        throw new Error("レスポンスストリームの取得に失敗しました。");
      }

      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.replace(/^data:\s*/, "").trim();
            if (dataStr === "[DONE]") break;

            try {
              const parsed = JSON.parse(dataStr);
              const content = parsed.choices?.[0]?.delta?.content || "";
              accumulated += content;
              setAnalysisText(accumulated);
            } catch (e) {
              // Parse error for partial chunk ignored
            }
          }
        }
      }
    } catch (e: unknown) {
      if (!(e instanceof Error && e.name === "AbortError")) {
        setErrorMessage(getErrorMessage(e) || "AI解析中にエラーが発生しました。");
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // モーダルオープン時に自動解析発火
  useEffect(() => {
    if (isOpen && virtualTimeMsc && openRouterApiKey && !analysisText && !isAnalyzing) {
      handleStartAnalysis();
    }
  }, [isOpen, virtualTimeMsc]);

  const handleCopy = () => {
    if (!analysisText) return;
    navigator.clipboard.writeText(analysisText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToLog = () => {
    if (!analysisText) return;
    try {
      const existingLogs = JSON.parse(localStorage.getItem(STORAGE_KEYS.tickreplayAiNotes) || "[]");
      const newEntry = {
        id: Date.now(),
        timeStr: formatTime(virtualTimeMsc),
        symbol,
        text: analysisText
      };
      localStorage.setItem(STORAGE_KEYS.tickreplayAiNotes, JSON.stringify([newEntry, ...existingLogs]));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to save note:", e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="ai-panel-overlay" onClick={onClose}>
      <div className="ai-panel-container" onClick={e => e.stopPropagation()}>
        {/* ヘッダー */}
        <div className="ai-panel-header">
          <div className="ai-panel-title">
            <span className="material-symbols-outlined icon-accent animated-pulse">auto_awesome</span>
            <span>急変動・トレンドAI解析</span>
          </div>
          <button className="pro-icon-btn" onClick={onClose} title="閉じる">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* ターゲット情報バー */}
        <div className="ai-target-bar">
          <div className="ai-target-info">
            <span className="ai-symbol-badge">{symbol}</span>
            <span className="ai-time-text">{formatTime(virtualTimeMsc)}</span>
          </div>
          <div className="ai-range-selector">
            <span className="range-label">時間範囲:</span>
            {[1, 3, 6, 24].map(h => (
              <button
                key={h}
                className={`range-btn ${rangeHours === h ? "active" : ""}`}
                onClick={() => setRangeHours(h)}
                disabled={isAnalyzing}
              >
                ±{h}h
              </button>
            ))}
          </div>
        </div>

        {/* データ収集進捗インジケーター */}
        <div className="ai-progress-bar">
          <div className={`progress-step ${progress.gdeltStatus}`}>
            <span className="step-dot"></span> GDELTニュース
          </div>
          <div className="progress-step success">
            <span className="step-dot"></span> MT5指標
          </div>
          {fredApiKey && (
            <div className={`progress-step ${progress.fredStatus}`}>
              <span className="step-dot"></span> FRED金利
            </div>
          )}
          {finnhubApiKey && (
            <div className={`progress-step ${progress.finnhubStatus}`}>
              <span className="step-dot"></span> Finnhub
            </div>
          )}
        </div>

        {/* エラーメッセージ */}
        {errorMessage && (
          <div className="ai-error-banner">
            <span className="material-symbols-outlined">error</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 本文エリア */}
        <div className="ai-content-body">
          {isAnalyzing && !analysisText && (
            <div className="ai-loading-state">
              <div className="replay-loading-spinner"></div>
              <p className="loading-text">OpenRouter LLM問い合わせ中...</p>
              <p className="loading-subtext">要人発言・地政学ニュース・経済指標データを分析しています</p>
            </div>
          )}

          {analysisText && (
            <div className="ai-markdown-output">
              {analysisText.split("\n").map((line, i) => {
                if (line.startsWith("## ")) {
                  return (
                    <h3 key={i} className="ai-h2">
                      {line.replace(/^##\s*/, "")}
                    </h3>
                  );
                }
                if (line.startsWith("- ")) {
                  return (
                    <li key={i} className="ai-li">
                      {line.replace(/^- /, "")}
                    </li>
                  );
                }
                if (!line.trim()) {
                  return <div key={i} style={{ height: "8px" }} />;
                }
                return (
                  <p key={i} className="ai-p">
                    {line}
                  </p>
                );
              })}
            </div>
          )}
        </div>

        {/* フッターアクション */}
        <div className="ai-panel-footer">
          <button className="pro-btn primary" onClick={handleStartAnalysis} disabled={isAnalyzing}>
            <span className="material-symbols-outlined">refresh</span>
            {isAnalyzing ? "解析中..." : "再解析"}
          </button>

          <div style={{ flex: 1 }} />

          <button className="pro-btn secondary" onClick={handleCopy} disabled={!analysisText}>
            <span className="material-symbols-outlined">{copied ? "check" : "content_copy"}</span>
            {copied ? "コピー完了" : "コピー"}
          </button>

          <button className="pro-btn secondary" onClick={handleSaveToLog} disabled={!analysisText}>
            <span className="material-symbols-outlined">{saved ? "bookmark_added" : "bookmark_add"}</span>
            {saved ? "保存完了" : "メモ保存"}
          </button>
        </div>
      </div>
    </div>
  );
};
