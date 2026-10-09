import { describe, expect, it } from "vitest";
import { consumeOpenRouterStream } from "../openRouterStream";

function createReader(chunks: Uint8Array[]): ReadableStreamDefaultReader<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
  return stream.getReader();
}

describe("consumeOpenRouterStream", () => {
  it("preserves SSE records split across chunks and UTF-8 characters", async () => {
    const encoder = new TextEncoder();
    const payload =
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\r\n' +
      'data: {"choices":[{"delta":{"content":"世界"}}]}\r\n' +
      "data: [DONE]\r\n" +
      'data: {"choices":[{"delta":{"content":" ignored"}}]}\r\n';
    const bytes = encoder.encode(payload);
    const firstEventBoundary = encoder.encode(payload.slice(0, payload.indexOf("Hello") + 3)).length;
    const japaneseCharacterBoundary = encoder.encode(payload.slice(0, payload.indexOf("界"))).length + 1;
    const crlfBoundary = encoder.encode(payload.slice(0, payload.indexOf("\r\n") + 1)).length;
    const boundaries = [firstEventBoundary, japaneseCharacterBoundary, crlfBoundary]
      .sort((a, b) => a - b)
      .filter((boundary, index, all) => boundary > 0 && boundary < bytes.length && all.indexOf(boundary) === index);
    const chunks: Uint8Array[] = [];
    let offset = 0;

    for (const boundary of boundaries) {
      chunks.push(bytes.slice(offset, boundary));
      offset = boundary;
    }
    chunks.push(bytes.slice(offset));

    const textUpdates: string[] = [];
    await consumeOpenRouterStream(createReader(chunks), (text) => textUpdates.push(text));

    expect(textUpdates).toEqual(["Hello ", "Hello 世界"]);
  });

  it("processes the final data line when the stream ends without a newline", async () => {
    const payload = 'data: {"choices":[{"delta":{"content":"complete"}}]}';
    const updates: string[] = [];

    await consumeOpenRouterStream(createReader([new TextEncoder().encode(payload)]), (text) => updates.push(text));

    expect(updates).toEqual(["complete"]);
  });
});
