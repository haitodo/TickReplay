import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchJsonWithCorsFallback,
  fetchJsonWithTimeout,
  fetchWithCorsFallback,
} from "../fetchHelper";

describe("fetchWithCorsFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not try the proxy when the direct request is aborted", async () => {
    const abortError = new Error("The request was aborted.");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithCorsFallback("https://example.test/data")).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries the proxy after an ordinary direct request failure", async () => {
    const response = new Response("ok", { status: 200 });
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);
    const url = "https://example.test/data";

    await expect(fetchWithCorsFallback(url)).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    );
  });

  it("rethrows a timeout from the proxy request", async () => {
    const directError = new TypeError("Failed to fetch");
    const timeoutError = Object.assign(new Error("Proxy request timed out"), {
      name: "TimeoutError",
    });
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(directError)
      .mockRejectedValueOnce(timeoutError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithCorsFallback("https://example.test/data")).rejects.toBe(timeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forwards caller cancellation to the request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      const signal = init?.signal;
      if (!signal) return Promise.reject(new Error("Missing abort signal"));
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const request = fetchWithCorsFallback("https://example.test/data", { signal: controller.signal });

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out while reading a JSON response body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      const signal = init?.signal;
      if (!signal) return Promise.reject(new Error("Missing abort signal"));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise<unknown>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJsonWithTimeout("https://example.test/data", {}, 0)).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("rejects non-success HTTP responses before parsing JSON", async () => {
    const json = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 503,
      json,
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJsonWithTimeout("https://example.test/data")).rejects.toThrow("HTTP 503");
    expect(json).not.toHaveBeenCalled();
  });

  it("leaves non-success CORS responses unparsed for the caller to report", async () => {
    const json = vi.fn();
    const response = {
      ok: false,
      status: 502,
      json,
    } as unknown as Response;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJsonWithCorsFallback<unknown>("https://example.test/data");

    expect(result).toEqual({ response });
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
