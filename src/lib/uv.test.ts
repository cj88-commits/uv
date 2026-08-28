import { describe, it, expect } from "vitest";
import {
  getUvCategory,
  getProtectionAdvice,
  getDailyUvSummary,
  getFirstHourAtOrAbove,
  uvIndexFromDoseRate,
  getCloudImpact,
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

describe("getCloudImpact", () => {
  describe("case A: advice-changing (forecast below threshold, clear-sky at/above it)", () => {
    it("spec example: forecast=2.3, clear=4.2 -> shows the advice-change message", () => {
      const result = getCloudImpact(2.3, 4.2, true);
      expect(result.kind).toBe("adviceChange");
      expect(result.diff).toBeCloseTo(1.9);
    });

    it("threshold crossing: forecast=2.9, clear=3.1 triggers even though the gap is small", () => {
      // The advice-change case has no minimum-difference floor -- ANY
      // crossing of the protection threshold is the highest-value case
      // regardless of how numerically small the gap is.
      const result = getCloudImpact(2.9, 3.1, true);
      expect(result.kind).toBe("adviceChange");
    });

    it("does not trigger when forecast is already at the threshold (no advice change possible)", () => {
      expect(getCloudImpact(3.0, 3.0, true).kind).toBe("none");
    });
  });

  describe("case B: clouds limiting an already-recommended forecast", () => {
    it("spec example: forecast=4.1, clear=6.3 -> shows the 'clouds are limiting UV' message", () => {
      const result = getCloudImpact(4.1, 6.3, true);
      expect(result.kind).toBe("limiting");
      expect(result.diff).toBeCloseTo(2.2, 5);
    });

    it("does not trigger for a small gap even when protection is already recommended", () => {
      // 5.9 vs 6.0: both fields are independently rounded/computed -- a 0.1
      // gap is model noise, not a real cloud effect.
      expect(getCloudImpact(5.9, 6.0, true).kind).toBe("none");
    });
  });

  describe("case C: negligible difference", () => {
    it("spec example: forecast=5.7, clear=5.9 -> hides the section entirely", () => {
      expect(getCloudImpact(5.7, 5.9, true).kind).toBe("none");
    });
  });

  describe("night / zero", () => {
    it("never divides by zero when both values are zero", () => {
      const result = getCloudImpact(0, 0, false);
      expect(result.kind).toBe("none");
      expect(result.percent).toBeNull();
      expect(Number.isFinite(result.diff)).toBe(true);
    });

    it("hides the section at night regardless of the numeric values", () => {
      // Even if the two values would otherwise cross the threshold, isDay
      // false (from the existing real solar-altitude day/night check) wins.
      expect(getCloudImpact(1, 5, false).kind).toBe("none");
    });

    it("hides tiny dawn/dusk values even when isDay is true", () => {
      expect(getCloudImpact(0.1, 0.4, true).kind).toBe("none");
    });
  });

  describe("other guards", () => {
    it("clamps a forecast value that slightly exceeds clear-sky (independent rounding) to zero diff", () => {
      const result = getCloudImpact(6.05, 6.0, true);
      expect(result.diff).toBe(0);
      expect(result.kind).toBe("none");
    });

    it("does not trigger the 'limiting' case for both-low values with no threshold crossing", () => {
      // forecast=1, clear=2.8: neither an advice-change (clear stays below
      // the threshold) nor a material difference on an already-recommended
      // day (forecast is below the threshold) -- nothing actionable to say.
      expect(getCloudImpact(1, 2.8, true).kind).toBe("none");
    });
  });
});
