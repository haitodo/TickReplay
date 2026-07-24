import { fetchWithCorsFallback } from "./fetchHelper";

export interface ApiTestResult {
  success: boolean;
  status: "idle" | "testing" | "success" | "error";
  message: string;
  latency?: number;
}

/**
 * タイムアウト付き fetch ヘルパー
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

/**
 * OpenRouter API Key & Model 接続テスト
 */
export async function testOpenRouterKey(apiKey: string, model: string): Promise<ApiTestResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return {
      success: false,
      status: "error",
      message: "OpenRouter API Keyが入力されていません。"
    };
  }

  const startTime = performance.now();
  const targetModel = model.trim() || "google/gemini-2.5-flash";

  try {
    const response = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${trimmedKey}`
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1
      })
    });

    const latency = Math.round(performance.now() - startTime);

    if (response.ok) {
      return {
        success: true,
        status: "success",
        message: `接続成功 (${targetModel} の応答を確認)`,
        latency
      };
    }

    const errorData = await response.json().catch(() => ({}));
    const rawMsg = errorData?.error?.message || response.statusText || "";

    if (response.status === 401) {
      return {
        success: false,
        status: "error",
        message: "認証エラー (401): OpenRouter API Keyが無効か誤っています。",
        latency
      };
    }

    if (response.status === 402) {
      return {
        success: false,
        status: "error",
        message: "残高不足エラー (402): OpenRouterアカウントのクレジット残高が不足しています。",
        latency
      };
    }

    if (response.status === 404) {
      return {
        success: false,
        status: "error",
        message: `モデルエラー (404): 指定モデル "${targetModel}" が見つかりません。`,
        latency
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        status: "error",
        message: "レート制限エラー (429): APIリクエスト上限に達しました。",
        latency
      };
    }

    return {
      success: false,
      status: "error",
      message: `エラー (${response.status}): ${rawMsg || "接続リクエスト失敗"}`,
      latency
    };
  } catch (error: any) {
    const latency = Math.round(performance.now() - startTime);
    if (error.name === "AbortError") {
      return {
        success: false,
        status: "error",
        message: "タイムアウトエラー: OpenRouterサーバーからの応答が制限時間(10秒)を超過しました。",
        latency
      };
    }
    return {
      success: false,
      status: "error",
      message: `通信エラー: ${error.message || "ネットワーク接続に失敗しました"}`,
      latency
    };
  }
}

/**
 * FRED API Key 接続テスト
 */
export async function testFredKey(apiKey: string): Promise<ApiTestResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return {
      success: false,
      status: "error",
      message: "FRED API Keyが入力されていません。"
    };
  }

  const startTime = performance.now();

  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=${encodeURIComponent(
      trimmedKey
    )}&file_type=json&limit=1`;
    const response = await fetchWithCorsFallback(url);
    const latency = Math.round(performance.now() - startTime);

    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.observations)) {
        return {
          success: true,
          status: "success",
          message: "接続成功 (FRB政策金利データの正常取得を確認)",
          latency
        };
      }
      if (data && data.error_message) {
        return {
          success: false,
          status: "error",
          message: `認証エラー: ${data.error_message}`,
          latency
        };
      }
    }

    const errData = await response.json().catch(() => ({}));
    return {
      success: false,
      status: "error",
      message: `認証エラー (${response.status}): ${errData?.error_message || "FRED API Keyが無効です。"}`,
      latency
    };
  } catch (error: any) {
    const latency = Math.round(performance.now() - startTime);
    if (error.name === "AbortError") {
      return {
        success: false,
        status: "error",
        message: "タイムアウトエラー: FREDサーバーへの接続がタイムアウトしました。",
        latency
      };
    }
    return {
      success: false,
      status: "error",
      message: `通信エラー: ${error.message || "FRED APIへの接続に失敗しました"}`,
      latency
    };
  }
}

/**
 * Finnhub API Key 接続テスト
 */
export async function testFinnhubKey(apiKey: string): Promise<ApiTestResult> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return {
      success: false,
      status: "error",
      message: "Finnhub API Keyが入力されていません。"
    };
  }

  const startTime = performance.now();

  try {
    const url = `https://finnhub.io/api/v1/news?category=forex&token=${encodeURIComponent(trimmedKey)}`;
    const response = await fetchWithTimeout(url);
    const latency = Math.round(performance.now() - startTime);

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        return {
          success: true,
          status: "success",
          message: `接続成功 (Finnhub FXニュース取得完了: ${data.length}件)`,
          latency
        };
      }
      return {
        success: false,
        status: "error",
        message: "レスポンス形式が不正です。",
        latency
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        status: "error",
        message: "認証エラー (401): Finnhub API Keyが無効です。",
        latency
      };
    }

    return {
      success: false,
      status: "error",
      message: `エラー (${response.status}): Finnhub APIキーを確認してください。`,
      latency
    };
  } catch (error: any) {
    const latency = Math.round(performance.now() - startTime);
    if (error.name === "AbortError") {
      return {
        success: false,
        status: "error",
        message: "タイムアウトエラー: Finnhubサーバーへの接続がタイムアウトしました。",
        latency
      };
    }
    return {
      success: false,
      status: "error",
      message: `通信エラー: ${error.message || "Finnhub APIへの接続に失敗しました"}`,
      latency
    };
  }
}

/**
 * GDELT パブリックAPI 接続テスト (キー不要)
 */
export async function testGdeltApi(): Promise<ApiTestResult> {
  const startTime = performance.now();
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=market&mode=ArtList&maxrecords=1&format=json`;
    const response = await fetchWithCorsFallback(url, {}, 15000);
    const latency = Math.round(performance.now() - startTime);

    if (response.ok) {
      return {
        success: true,
        status: "success",
        message: "接続成功 (GDELT パブリックニュースAPIは正常に稼働中)",
        latency
      };
    }

    if (response.status === 408 || response.status === 504) {
      return {
        success: false,
        status: "error",
        message: `タイムアウトエラー (${response.status}): GDELTサーバーの応答が時間内に完了しませんでした。現在GDELT APIが混雑している可能性があります。`,
        latency
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        status: "error",
        message: `レート制限エラー (429): GDELT APIへのリクエスト数が一時的な制限を超過しました。時間をおいて再試行してください。`,
        latency
      };
    }

    if (response.status >= 500) {
      return {
        success: false,
        status: "error",
        message: `サーバーエラー (${response.status}): GDELT APIサーバーでエラーが発生しているかメンテナンス中です。`,
        latency
      };
    }

    return {
      success: false,
      status: "error",
      message: `通信エラー (${response.status}): GDELT APIへの接続に失敗しました。`,
      latency
    };
  } catch (error: any) {
    const latency = Math.round(performance.now() - startTime);
    if (
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      String(error?.message).includes("aborted") ||
      String(error?.message).includes("timeout")
    ) {
      return {
        success: false,
        status: "error",
        message: "タイムアウトエラー: GDELTサーバーからの応答が制限時間(15秒)を超過しました。現在GDELT APIサーバーが負荷集中により遅延または停止しています。",
        latency
      };
    }
    return {
      success: false,
      status: "error",
      message: `通信エラー: ${error.message || "GDELT APIへの接続に失敗しました"}`,
      latency
    };
  }
}
