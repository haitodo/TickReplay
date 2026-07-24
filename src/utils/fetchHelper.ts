/**
 * CORS制限のある外部API（例: FRED API, GDELT API）向けに、直接通信失敗時にCORSプロキシ経由で自動フォールバックするfetch関数
 */
export async function fetchWithCorsFallback(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("TimeoutError"), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (directError: any) {
    clearTimeout(timeoutId);

    const isAbort =
      directError.name === "AbortError" ||
      directError.name === "TimeoutError" ||
      String(directError?.message).includes("aborted");

    if (isAbort) {
      throw directError;
    }

    // 直接通信が失敗した場合（主にブラウザのCORS制限によるFailed to fetch）、CORSプロキシを試行
    const corsProxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    ];

    for (const proxyUrl of corsProxies) {
      const proxyController = new AbortController();
      const proxyTimeoutId = setTimeout(() => proxyController.abort("TimeoutError"), timeoutMs);
      try {
        const proxyResponse = await fetch(proxyUrl, {
          ...options,
          signal: proxyController.signal
        });
        return proxyResponse;
      } catch (proxyError: any) {
        if (
          proxyError.name === "AbortError" ||
          proxyError.name === "TimeoutError" ||
          String(proxyError?.message).includes("aborted")
        ) {
          throw proxyError;
        }
        // 次のプロキシ試行へ
      } finally {
        clearTimeout(proxyTimeoutId);
      }
    }

    // 全プロキシも失敗した場合は元のエラーを投げる
    throw directError;
  } finally {
    clearTimeout(timeoutId);
  }
}

