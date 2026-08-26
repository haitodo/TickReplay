import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  testOpenRouterKey,
  testFredKey,
  testFinnhubKey,
  testGdeltApi,
} from "../apiKeyTester";

describe("apiKeyTester utility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("testOpenRouterKey", () => {
    it("returns error when API key is empty", async () => {
      const result = await testOpenRouterKey("", "google/gemini-2.5-flash");
      expect(result.success).toBe(false);
      expect(result.status).toBe("error");
      expect(result.message).toContain("API Keyが入力されていません");
    });
  });

  describe("testFredKey", () => {
    it("returns error when API key is empty", async () => {
      const result = await testFredKey("");
      expect(result.success).toBe(false);
      expect(result.status).toBe("error");
      expect(result.message).toContain("API Keyが入力されていません");
    });
  });

  describe("testFinnhubKey", () => {
    it("returns error when API key is empty", async () => {
      const result = await testFinnhubKey("");
      expect(result.success).toBe(false);
      expect(result.status).toBe("error");
      expect(result.message).toContain("API Keyが入力されていません");
    });
  });

  describe("testGdeltApi", () => {
    it("exports testGdeltApi function", () => {
      expect(typeof testGdeltApi).toBe("function");
    });
  });
});
