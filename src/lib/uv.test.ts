import { describe, it, expect } from "vitest";
import {
  getUvCategory,
  getProtectionAdvice,
  getDailyUvSummary,
  getFirstHourAtOrAbove,
  uvIndexFromDoseRate,
  getCloudImpact,
  getProtectionPeriods,
  getPrimaryCardTiming,
  PROTECTION_THRESHOLD,
} from "./uv";
import { toApproxLocalTime } from "./forecast";

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

// Regression coverage for the "UV is forecast to reach 3 at around 10:00"
// bug: that sentence was generated by looking at the FIRST threshold
// crossing of the day regardless of whether it was already in the past
// relative to "now". getPrimaryCardTiming/getProtectionPeriods replace that
// with an explicitly nowIso-relative decision.
describe("getProtectionPeriods", () => {
  it("returns a single period for one continuous above-threshold stretch", () => {
    const series = [
      { time: "2026-06-01T08:00:00Z", uv: 1.8 },
      { time: "2026-06-01T09:00:00Z", uv: 2.6 },
      { time: "2026-06-01T10:00:00Z", uv: 3.2 },
      { time: "2026-06-01T11:00:00Z", uv: 4.0 },
      { time: "2026-06-01T12:00:00Z", uv: 3.5 },
      { time: "2026-06-01T13:00:00Z", uv: 2.8 },
    ];
    expect(getProtectionPeriods(series)).toEqual([{ start: "2026-06-01T10:00:00Z", end: "2026-06-01T12:00:00Z" }]);
  });

  it("does not bridge two separate above-threshold stretches into one span", () => {
    // Morning crossing, a cloudy dip below threshold, then a second
    // afternoon crossing -- must be reported as two distinct periods, not
    // one span from the first crossing to the last.
    const series = [
      { time: "2026-06-01T09:00:00Z", uv: 3.5 },
      { time: "2026-06-01T10:00:00Z", uv: 4.0 },
      { time: "2026-06-01T11:00:00Z", uv: 2.0 }, // dip below
      { time: "2026-06-01T12:00:00Z", uv: 1.5 },
      { time: "2026-06-01T13:00:00Z", uv: 2.5 },
      { time: "2026-06-01T14:00:00Z", uv: 3.2 },
      { time: "2026-06-01T15:00:00Z", uv: 3.8 },
      { time: "2026-06-01T16:00:00Z", uv: 2.9 },
    ];
    expect(getProtectionPeriods(series)).toEqual([
      { start: "2026-06-01T09:00:00Z", end: "2026-06-01T10:00:00Z" },
      { start: "2026-06-01T14:00:00Z", end: "2026-06-01T15:00:00Z" },
    ]);
  });

  it("returns no periods when UV never reaches the threshold", () => {
    const series = [
      { time: "2026-06-01T09:00:00Z", uv: 1.0 },
      { time: "2026-06-01T12:00:00Z", uv: 2.2 },
      { time: "2026-06-01T15:00:00Z", uv: 1.4 },
    ];
    expect(getProtectionPeriods(series)).toEqual([]);
  });

  it("closes a period that is still above threshold at the end of the series", () => {
    const series = [
      { time: "2026-06-01T14:00:00Z", uv: 3.1 },
      { time: "2026-06-01T15:00:00Z", uv: 3.4 },
    ];
    expect(getProtectionPeriods(series)).toEqual([{ start: "2026-06-01T14:00:00Z", end: "2026-06-01T15:00:00Z" }]);
  });
});

describe("getPrimaryCardTiming", () => {
  // The exact scenario from the reported bug: crosses 3 at 10:00, peaks at
  // 11:00, falls back below 3 by 13:00, and stays low the rest of the day.
  const bugReportSeries = [
    { time: "2026-06-01T06:00:00Z", uv: 0.5 },
    { time: "2026-06-01T07:00:00Z", uv: 1.0 },
    { time: "2026-06-01T08:00:00Z", uv: 1.8 },
    { time: "2026-06-01T09:00:00Z", uv: 2.6 },
    { time: "2026-06-01T10:00:00Z", uv: 3.2 },
    { time: "2026-06-01T11:00:00Z", uv: 4.0 },
    { time: "2026-06-01T12:00:00Z", uv: 3.5 },
    { time: "2026-06-01T13:00:00Z", uv: 2.8 },
    { time: "2026-06-01T14:00:00Z", uv: 1.9 },
    { time: "2026-06-01T15:00:00Z", uv: 1.2 },
    { time: "2026-06-01T16:00:00Z", uv: 0.8 },
  ];

  it("morning, before the window: reports the upcoming FIRST period of the day", () => {
    const timing = getPrimaryCardTiming(bugReportSeries, "2026-06-01T08:00:00Z");
    expect(timing).toEqual({ kind: "upcoming", nextStart: "2026-06-01T10:00:00Z", isFirstPeriodOfDay: true });
  });

  it("during the window: reports the current period, not just a crossing time", () => {
    const timing = getPrimaryCardTiming(bugReportSeries, "2026-06-01T12:00:00Z");
    expect(timing).toEqual({
      kind: "recommended",
      period: { start: "2026-06-01T10:00:00Z", end: "2026-06-01T12:00:00Z" },
    });
  });

  it("bug repro -- afternoon, after the window ended: must NOT report the 10:00 crossing in future tense", () => {
    // The reported bug: at 15:24, with the only crossing having been at
    // 10:00 (five hours earlier), the card said "UV is forecast to reach 3
    // at around 10:00" -- a future-tense sentence about a finished event.
    const timing = getPrimaryCardTiming(bugReportSeries, "2026-06-01T15:24:00Z");
    expect(timing).toEqual({ kind: "ended" });
    // Explicitly nail down the invariant the bug violated: "ended" must
    // never carry an "upcoming" shape a caller could mistakenly render as
    // future-tense copy.
    expect(timing.kind).not.toBe("upcoming");
  });

  it("low UV all day: reports 'none', never a phantom crossing", () => {
    const lowSeries = [
      { time: "2026-06-01T09:00:00Z", uv: 1.0 },
      { time: "2026-06-01T12:00:00Z", uv: 2.2 },
      { time: "2026-06-01T15:00:00Z", uv: 1.4 },
    ];
    expect(getPrimaryCardTiming(lowSeries, "2026-06-01T12:00:00Z")).toEqual({ kind: "none" });
  });

  it("multiple crossings: below threshold now, uses the NEXT future crossing, not the earlier one that already passed", () => {
    const twoPeriodSeries = [
      { time: "2026-06-01T09:00:00Z", uv: 3.5 },
      { time: "2026-06-01T10:00:00Z", uv: 4.0 }, // first period: 09:00-10:00
      { time: "2026-06-01T11:00:00Z", uv: 2.0 }, // dip below -- current UV, "now"
      { time: "2026-06-01T12:00:00Z", uv: 1.5 },
      { time: "2026-06-01T13:00:00Z", uv: 2.5 },
      { time: "2026-06-01T14:00:00Z", uv: 3.2 }, // second period starts here
      { time: "2026-06-01T15:00:00Z", uv: 3.8 },
    ];
    const timing = getPrimaryCardTiming(twoPeriodSeries, "2026-06-01T11:00:00Z");
    expect(timing).toEqual({ kind: "upcoming", nextStart: "2026-06-01T14:00:00Z", isFirstPeriodOfDay: false });
  });

  it("exactly at a period's start/end boundary counts as within the period", () => {
    expect(getPrimaryCardTiming(bugReportSeries, "2026-06-01T10:00:00Z").kind).toBe("recommended");
    expect(getPrimaryCardTiming(bugReportSeries, "2026-06-01T12:00:00Z").kind).toBe("recommended");
  });

  it("handles an empty series without throwing", () => {
    expect(getPrimaryCardTiming([], "2026-06-01T12:00:00Z")).toEqual({ kind: "none" });
  });
});

describe("getPrimaryCardTiming: timezone independence", () => {
  // getPrimaryCardTiming itself takes no longitude/timezone -- it compares
  // absolute instants only. This verifies that decision is identical
  // regardless of which location's local time is later displayed, and that
  // the DISPLAY layer (toApproxLocalTime, already covered independently in
  // forecast.test.ts) correctly localises the same absolute crossing time
  // very differently for two locations with substantially different UTC
  // offsets -- exercising London (offset 0) and Tokyo (offset +9).
  const series = [
    { time: "2026-06-01T00:00:00Z", uv: 1.0 },
    { time: "2026-06-01T01:00:00Z", uv: 3.4 }, // crosses the threshold
    { time: "2026-06-01T02:00:00Z", uv: 4.1 },
    { time: "2026-06-01T03:00:00Z", uv: 1.5 },
  ];
  const nowIso = "2026-05-31T22:00:00Z"; // before the crossing, at every longitude

  it("produces the same timing decision regardless of the location it will be displayed for", () => {
    const timing = getPrimaryCardTiming(series, nowIso);
    expect(timing).toEqual({ kind: "upcoming", nextStart: "2026-06-01T01:00:00Z", isFirstPeriodOfDay: true });
  });

  it("localises that same absolute crossing time very differently for London vs Tokyo", () => {
    const timing = getPrimaryCardTiming(series, nowIso);
    if (timing.kind !== "upcoming") throw new Error("expected upcoming");
    const LONDON = 0;
    const TOKYO = 139.7;
    expect(toApproxLocalTime(timing.nextStart, LONDON)).toBe("01:00");
    expect(toApproxLocalTime(timing.nextStart, TOKYO)).toBe("10:00"); // +9h
  });
});
