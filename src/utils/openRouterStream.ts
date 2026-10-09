interface OpenRouterStreamEvent {
  choices?: Array<{
    delta?: {
      content?: unknown;
    };
  }>;
}

/** OpenRouterのSSEストリームから、受信した文章を順次通知する。 */
export async function consumeOpenRouterStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onText: (text: string) => void
): Promise<void> {
  const decoder = new TextDecoder("utf-8");
  let pendingLine = "";
  let accumulated = "";
  let receivedDoneEvent = false;

  const processLine = (line: string): boolean => {
    if (!line.startsWith("data:")) return false;

    const data = line.slice("data:".length).trim();
    if (data === "[DONE]") return true;
    if (!data) return false;

    try {
      const event = JSON.parse(data) as OpenRouterStreamEvent;
      const content = event.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content) {
        accumulated += content;
        onText(accumulated);
      }
    } catch {
      // 完了した行の不正なJSONはスキップする。
    }

    return false;
  };

  try {
    while (!receivedDoneEvent) {
      const { done, value } = await reader.read();
      if (done) break;

      pendingLine += decoder.decode(value, { stream: true });
      const lines = pendingLine.split(/\r?\n/);
      pendingLine = lines.pop() ?? "";

      for (const line of lines) {
        if (processLine(line)) {
          receivedDoneEvent = true;
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    }

    if (!receivedDoneEvent) {
      pendingLine += decoder.decode();
      if (pendingLine) processLine(pendingLine);
    }
  } finally {
    reader.releaseLock();
  }
}
