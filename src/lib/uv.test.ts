import { describe, it, expect } from "vitest";
import {
  getUvCategory,
  getProtectionAdvice,
  getDailyUvSummary,
  getFirstHourAtOrAbove,
  uvIndexFromDoseRate,
  PROTECTION_THRESHOLD,
} from "./uv";

describe("uvIndexFromDoseRate", () => {
  it("multiplies the CAMS dose rate by 40", () => {
    expect(uvIndexFromDoseRate(0.1)).toBeCloseTo(4);
    expect(uvIndexFromDoseRate(0.025)).toBeCloseTo(1);
    expect(uvIndexFromDoseRate(0)).toBe(0);
  });
});

describe("getUvCategory boundaries", () => {
  it.each([
    [0, "low"],
    [2.9, "low"],
    [3, "moderate"],
    [5.9, "moderate"],
    [6, "high"],
    [7.9, "high"],
    [8, "very-high"],
    [10.9, "very-high"],
    [11, "extreme"],
    [15, "extreme"],
  ] as const)("uv=%s -> %s", (uv, expected) => {
    expect(getUvCategory(uv)).toBe(expected);
  });
});

describe("getProtectionAdvice", () => {
  it("recommends protection at and above the threshold", () => {
    expect(getProtectionAdvice(PROTECTION_THRESHOLD).recommended).toBe(true);
    expect(getProtectionAdvice(PROTECTION_THRESHOLD + 0.1).recommended).toBe(true);
  });

  it("does not recommend protection below the threshold", () => {
    expect(getProtectionAdvice(PROTECTION_THRESHOLD - 0.1).recommended).toBe(false);
    expect(getProtectionAdvice(0).recommended).toBe(false);
  });

  it("reports the matching category alongside the recommendation", () => {
    expect(getProtectionAdvice(1.5).category).toBe("low");
    expect(getProtectionAdvice(6.5).category).toBe("high");
  });
});

describe("getFirstHourAtOrAbove", () => {
  it("returns the first point meeting the threshold", () => {
    const series = [
      { time: "T08", uv: 1 },
      { time: "T09", uv: 2.5 },
      { time: "T10", uv: 3.2 },
      { time: "T11", uv: 5 },
    ];
    expect(getFirstHourAtOrAbove(series, 3)?.time).toBe("T10");
  });

  it("returns null when the threshold is never reached", () => {
    const series = [{ time: "T08", uv: 1 }];
    expect(getFirstHourAtOrAbove(series, 3)).toBeNull();
  });
});

describe("getDailyUvSummary", () => {
  it("finds the daily maximum and its time", () => {
    const series = [
      { time: "2026-06-01T06:00:00Z", uv: 0.5 },
      { time: "2026-06-01T10:00:00Z", uv: 4.2 },
      { time: "2026-06-01T13:00:00Z", uv: 6.8 },
      { time: "2026-06-01T17:00:00Z", uv: 2.1 },
    ];
    const summary = getDailyUvSummary(series);
    expect(summary.peak?.uv).toBe(6.8);
    expect(summary.peak?.time).toBe("2026-06-01T13:00:00Z");
  });

  it("computes the protection window from first/last hour above threshold", () => {
    const series = [
      { time: "2026-06-01T06:00:00Z", uv: 1 },
      { time: "2026-06-01T09:00:00Z", uv: 3.5 },
      { time: "2026-06-01T13:00:00Z", uv: 6.8 },
      { time: "2026-06-01T17:00:00Z", uv: 3.1 },
      { time: "2026-06-01T18:00:00Z", uv: 1.2 },
    ];
    const summary = getDailyUvSummary(series);
    expect(summary.protectionWindow).toEqual({
      start: "2026-06-01T09:00:00Z",
      end: "2026-06-01T17:00:00Z",
    });
  });

  it("returns a null window when UV never reaches the threshold", () => {
    const series = [
      { time: "2026-06-01T06:00:00Z", uv: 0.2 },
      { time: "2026-06-01T12:00:00Z", uv: 1.9 },
    ];
    expect(getDailyUvSummary(series).protectionWindow).toBeNull();
  });

  it("handles an empty series without throwing", () => {
    expect(getDailyUvSummary([])).toEqual({
      peak: null,
      firstProtectionHour: null,
      lastProtectionHour: null,
      protectionWindow: null,
    });
  });
});
