import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIME_STEPS,
  PRESET_TIME_OPTIONS,
  formatSecondsToLabel,
  formatTimeStepLabel,
} from "../timeSteps";

describe("timeSteps domain utilities", () => {
  describe("formatSecondsToLabel", () => {
    it("formats seconds < 60 with 'S'", () => {
      expect(formatSecondsToLabel(1)).toBe("1S");
      expect(formatSecondsToLabel(10)).toBe("10S");
      expect(formatSecondsToLabel(59)).toBe("59S");
    });

    it("formats exact minutes < 3600 with 'M'", () => {
      expect(formatSecondsToLabel(60)).toBe("1M");
      expect(formatSecondsToLabel(300)).toBe("5M");
      expect(formatSecondsToLabel(600)).toBe("10M");
      expect(formatSecondsToLabel(1800)).toBe("30M");
    });

    it("formats fractional minutes < 3600 with decimals", () => {
      expect(formatSecondsToLabel(90)).toBe("1.5M");
      expect(formatSecondsToLabel(150)).toBe("2.5M");
    });

    it("formats exact hours >= 3600 with 'H'", () => {
      expect(formatSecondsToLabel(3600)).toBe("1H");
      expect(formatSecondsToLabel(7200)).toBe("2H");
      expect(formatSecondsToLabel(14400)).toBe("4H");
    });

    it("formats non-exact hours >= 3600 with decimals", () => {
      expect(formatSecondsToLabel(5400)).toBe("1.5H");
    });
  });

  describe("formatTimeStepLabel", () => {
    it("formats seconds < 60 with 'S'", () => {
      expect(formatTimeStepLabel(15)).toBe("15S");
      expect(formatTimeStepLabel(45)).toBe("45S");
    });

    it("formats minutes < 3600 with 'M'", () => {
      expect(formatTimeStepLabel(60)).toBe("1.0M");
      expect(formatTimeStepLabel(90)).toBe("1.5M");
      expect(formatTimeStepLabel(300)).toBe("5.0M");
    });

    it("formats hours >= 3600 and < 86400 with 'H'", () => {
      expect(formatTimeStepLabel(3600)).toBe("1H");
      expect(formatTimeStepLabel(7200)).toBe("2H");
      expect(formatTimeStepLabel(14400)).toBe("4H");
    });

    it("formats days >= 86400 with 'D'", () => {
      expect(formatTimeStepLabel(86400)).toBe("1D");
      expect(formatTimeStepLabel(172800)).toBe("2D");
    });
  });

  describe("DEFAULT_TIME_STEPS and PRESET_TIME_OPTIONS", () => {
    it("has 4 default time steps sorted ascending", () => {
      expect(DEFAULT_TIME_STEPS).toHaveLength(4);
      for (let i = 1; i < DEFAULT_TIME_STEPS.length; i++) {
        expect(DEFAULT_TIME_STEPS[i].seconds).toBeGreaterThan(DEFAULT_TIME_STEPS[i - 1].seconds);
      }
    });

    it("has all preset options sorted ascending", () => {
      expect(PRESET_TIME_OPTIONS.length).toBeGreaterThan(0);
      for (let i = 1; i < PRESET_TIME_OPTIONS.length; i++) {
        expect(PRESET_TIME_OPTIONS[i].seconds).toBeGreaterThan(PRESET_TIME_OPTIONS[i - 1].seconds);
      }
    });
  });
});
