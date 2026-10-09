import { getErrorMessage } from "./getErrorMessage";

function isAbortOrTimeoutError(error: unknown): boolean {
  return (
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")) ||
    getErrorMessage(error).includes("aborted")
  );
}

function forwardAbortSignal(signal: AbortSignal | null | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;

  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }

  return () => signal.removeEventListener("abort", abort);
}

async function withTimedFetch<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs: number,
  consumeResponse: (response: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const removeAbortListener = forwardAbortSignal(options.signal, controller);
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException("The request timed out.", "TimeoutError")),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return await consumeResponse(response);
  } finally {
    clearTimeout(timeoutId);
    removeAbortListener();
  }
}

/** JSON本文の読み込みまでタイムアウトと呼び出し元のAbortSignalで制御する。 */
export function fetchJsonWithTimeout<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<T> {
  return withTimedFetch(url, options, timeoutMs, async (response) => {
    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}`);
    }
    return await response.json() as T;
  });
}

async function fetchWithCorsFallbackUsing<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  consumeResponse: (response: Response) => Promise<T>
): Promise<T> {
  try {
    return await withTimedFetch(url, options, timeoutMs, consumeResponse);
  } catch (directError: unknown) {
    if (options.signal?.aborted || isAbortOrTimeoutError(directError)) {
      throw directError;
    }

    // 直接通信が失敗した場合（主にブラウザのCORS制限によるFailed to fetch）、CORSプロキシを試行
    const corsProxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    ];

    for (const proxyUrl of corsProxies) {
      try {
        return await withTimedFetch(proxyUrl, options, timeoutMs, consumeResponse);
      } catch (proxyError: unknown) {
        if (options.signal?.aborted || isAbortOrTimeoutError(proxyError)) {
          throw proxyError;
        }
        // 次のプロキシ試行へ
      }
    }

    // 全プロキシも失敗した場合は元のエラーを投げる
    throw directError;
  }
}

/**
 * CORS制限のある外部API（例: FRED API, GDELT API）向けに、直接通信失敗時にCORSプロキシ経由で自動フォールバックするfetch関数
 */
export function fetchWithCorsFallback(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  return fetchWithCorsFallbackUsing(url, options, timeoutMs, async (response) => response);
}

/** JSON本文の読み込みまでタイムアウトとキャンセルを適用して取得する。 */
export function fetchJsonWithCorsFallback<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<{ response: Response; data?: T }> {
  return fetchWithCorsFallbackUsing(url, options, timeoutMs, async (response) => {
    if (!response.ok) return { response };

    return {
      response,
      data: await response.json() as T,
    };
  });
}

