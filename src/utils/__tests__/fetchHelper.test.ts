import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithCorsFallback } from "../fetchHelper";

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
});
