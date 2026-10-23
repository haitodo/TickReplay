import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ClearAllSessionsConfirmModal,
  ResetReplayConfirmModal,
  ResetTradingConfirmModal,
  MaxBarsWarningModal,
  SaveSessionModal,
  TimeStepsModal,
  SpeedPresetsModal,
} from "../Modals";

describe("Extracted Modal components", () => {
  describe("ClearAllSessionsConfirmModal", () => {
    it("renders nothing when isOpen is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(ClearAllSessionsConfirmModal, { isOpen: false, onConfirm: vi.fn(), onClose: vi.fn() })
      );
      expect(html).toBe("");
    });

    it("renders modal dialog when isOpen is true", () => {
      const html = renderToStaticMarkup(
        React.createElement(ClearAllSessionsConfirmModal, { isOpen: true, onConfirm: vi.fn(), onClose: vi.fn() })
      );
      expect(html).toContain("全セッションデータの削除");
      expect(html).toContain("一括削除");
    });
  });

  describe("ResetReplayConfirmModal", () => {
    it("renders nothing when isOpen is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(ResetReplayConfirmModal, { isOpen: false, onConfirm: vi.fn(), onClose: vi.fn() })
      );
      expect(html).toBe("");
    });

    it("renders modal dialog when isOpen is true", () => {
      const html = renderToStaticMarkup(
        React.createElement(ResetReplayConfirmModal, { isOpen: true, onConfirm: vi.fn(), onClose: vi.fn() })
      );
      expect(html).toContain("リプレイ設定のリセット");
    });
  });

  describe("ResetTradingConfirmModal", () => {
    it("renders nothing when isOpen is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(ResetTradingConfirmModal, { isOpen: false, onConfirm: vi.fn(), onClose: vi.fn() })
      );
      expect(html).toBe("");
    });

    it("renders modal dialog when isOpen is true", () => {
      const html = renderToStaticMarkup(
        React.createElement(ResetTradingConfirmModal, { isOpen: true, onConfirm: vi.fn(), onClose: vi.fn() })
      );
      expect(html).toContain("取引設定のリセット");
    });
  });

  describe("MaxBarsWarningModal", () => {
    it("renders nothing when isOpen is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(MaxBarsWarningModal, { isOpen: false, maxBarsInfo: null, onProceed: vi.fn(), onClose: vi.fn() })
      );
      expect(html).toBe("");
    });

    it("renders formatted max_bars warning when isOpen is true", () => {
      const html = renderToStaticMarkup(
        React.createElement(MaxBarsWarningModal, {
          isOpen: true,
          maxBarsInfo: { max_bars: 500000, raw_value: "500000", is_unlimited: false },
          onProceed: vi.fn(),
          onClose: vi.fn(),
        })
      );
      expect(html).toContain("チャート最大バー数の確認");
      expect(html).toContain("500,000 本");
    });

    it("renders fallback when maxBarsInfo is null", () => {
      const html = renderToStaticMarkup(
        React.createElement(MaxBarsWarningModal, {
          isOpen: true,
          maxBarsInfo: null,
          onProceed: vi.fn(),
          onClose: vi.fn(),
        })
      );
      expect(html).toContain("未検出");
    });
  });

  describe("SaveSessionModal", () => {
    it("renders nothing when isOpen is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(SaveSessionModal, {
          isOpen: false,
          sessionSaveType: "manual",
          currentSessionId: null,
          currentSessionName: "",
          saveSessionName: "test",
          setSaveSessionName: vi.fn(),
          saveAsNewSnapshot: false,
          setSaveAsNewSnapshot: vi.fn(),
          onSave: vi.fn(),
          onClose: vi.fn(),
        })
      );
      expect(html).toBe("");
    });

    it("renders modal content and snapshot toggle when session exists", () => {
      const html = renderToStaticMarkup(
        React.createElement(SaveSessionModal, {
          isOpen: true,
          sessionSaveType: "terminate",
          currentSessionId: "session-1",
          currentSessionName: "USDJPY_2024",
          saveSessionName: "USDJPY_2024_Snapshot",
          setSaveSessionName: vi.fn(),
          saveAsNewSnapshot: true,
          setSaveAsNewSnapshot: vi.fn(),
          onSave: vi.fn(),
          onTerminateWithoutSaving: vi.fn(),
          onClose: vi.fn(),
        })
      );
      expect(html).toContain("セッションを保存して終了");
      expect(html).toContain("新規スナップショットとして保存");
      expect(html).toContain("保存せず終了");
    });
  });

  describe("TimeStepsModal", () => {
    it("renders nothing when isOpen is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(TimeStepsModal, {
          isOpen: false,
          timeSteps: [{ id: "1", seconds: 10, label: "10S" }],
          onApply: vi.fn(),
          onClose: vi.fn(),
        })
      );
      expect(html).toBe("");
    });

    it("renders step list and presets when isOpen is true", () => {
      const html = renderToStaticMarkup(
        React.createElement(TimeStepsModal, {
          isOpen: true,
          timeSteps: [
            { id: "1", seconds: 10, label: "10S" },
            { id: "2", seconds: 60, label: "1M" },
          ],
          onApply: vi.fn(),
          onClose: vi.fn(),
        })
      );
      expect(html).toContain("Time Steps 設定");
      expect(html).toContain("設定中のステップ (2/5)");
      expect(html).toContain("10S");
      expect(html).toContain("1M");
    });
  });

  describe("SpeedPresetsModal", () => {
    it("renders nothing when isOpen is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(SpeedPresetsModal, {
          isOpen: false,
          timePresets: [1.0, 5.0],
          tickPresets: [1, 5],
          onSave: vi.fn(),
          onClose: vi.fn(),
        })
      );
      expect(html).toBe("");
    });

    it("renders presets list when isOpen is true", () => {
      const html = renderToStaticMarkup(
        React.createElement(SpeedPresetsModal, {
          isOpen: true,
          timePresets: [1.0, 5.0],
          tickPresets: [1, 5],
          onSave: vi.fn(),
          onClose: vi.fn(),
        })
      );
      expect(html).toContain("速度プリセット設定");
      expect(html).toContain("時間比率モード (倍率)");
      expect(html).toContain("1x");
      expect(html).toContain("5x");
      expect(html).toContain("1T");
      expect(html).toContain("5T");
    });
  });
});
