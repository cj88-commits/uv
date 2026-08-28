// Central place for all UV thresholds and derived-metric logic. Nothing
// outside this file should hard-code a UV category boundary or the
// protection threshold.

export type UvCategory = "low" | "moderate" | "high" | "very-high" | "extreme";

export const PROTECTION_THRESHOLD = 3;

/**
 * Verified against official CAMS/ECMWF documentation (docs/CAMS_UV.md):
 * UV Index = biologically effective UV dose rate (W m-2) x 40.
 */
export const UV_INDEX_FACTOR = 40;

export function uvIndexFromDoseRate(doseRateWm2: number): number {
  return doseRateWm2 * UV_INDEX_FACTOR;
}

/** Standard WHO/WMO UV Index categories. */
export function getUvCategory(uvIndex: number): UvCategory {
  if (uvIndex < 3) return "low";
  if (uvIndex < 6) return "moderate";
  if (uvIndex < 8) return "high";
  if (uvIndex < 11) return "very-high";
  return "extreme";
}

export interface ProtectionAdvice {
  recommended: boolean;
  category: UvCategory;
}

/**
 * Deliberately simple MVP rule: protection is recommended once UV Index
 * reaches PROTECTION_THRESHOLD. This intentionally does not map UV levels
 * to specific SPF numbers — that implies a precision the underlying advice
 * doesn't have.
 */
export function getProtectionAdvice(uvIndex: number): ProtectionAdvice {
  return {
    recommended: uvIndex >= PROTECTION_THRESHOLD,
    category: getUvCategory(uvIndex),
  };
}

export interface HourlyUvPoint {
  time: string; // ISO8601 UTC
  uv: number;
}

export interface DailyUvSummary {
  /** Hour with the highest UV in the supplied series, or null if empty. */
  peak: HourlyUvPoint | null;
  /** First hour in the series where UV >= PROTECTION_THRESHOLD, or null. */
  firstProtectionHour: string | null;
  /** Last hour in the series where UV >= PROTECTION_THRESHOLD, or null. */
  lastProtectionHour: string | null;
  /**
   * Approximate window during which protection is recommended, derived
   * from the hourly series. Null if UV never reaches the threshold.
   * Hourly data means this window has hour-level precision only.
   */
  protectionWindow: { start: string; end: string } | null;
}

/**
 * Computes today's peak UV, its time, and the approximate protection
 * window from a chronologically-ordered hourly UV series (already filtered
 * to the day of interest by the caller).
 */
export function getDailyUvSummary(hourly: HourlyUvPoint[]): DailyUvSummary {
  if (hourly.length === 0) {
    return { peak: null, firstProtectionHour: null, lastProtectionHour: null, protectionWindow: null };
  }

  let peak = hourly[0];
  for (const point of hourly) {
    if (point.uv > peak.uv) peak = point;
  }

  const aboveThreshold = hourly.filter((p) => p.uv >= PROTECTION_THRESHOLD);
  const firstProtectionHour = aboveThreshold.length > 0 ? aboveThreshold[0].time : null;
  const lastProtectionHour = aboveThreshold.length > 0 ? aboveThreshold[aboveThreshold.length - 1].time : null;

  const protectionWindow =
    firstProtectionHour && lastProtectionHour
      ? { start: firstProtectionHour, end: lastProtectionHour }
      : null;

  return { peak, firstProtectionHour, lastProtectionHour, protectionWindow };
}

/** Finds the first hour in the series where UV reaches `threshold`, if any. */
export function getFirstHourAtOrAbove(hourly: HourlyUvPoint[], threshold: number): HourlyUvPoint | null {
  for (const point of hourly) {
    if (point.uv >= threshold) return point;
  }
  return null;
}

// --- Total-sky vs clear-sky ("cloud impact") -------------------------------
//
// CAMS gives us two UV fields for the same instant: uvbed (total-sky, i.e.
// this forecast's expected UV given its own cloud/aerosol/ozone fields) and
// uvbedcs (clear-sky, the same quantity as if the sky were cloud-free). The
// gap between them is how much cloud is expected to be suppressing UV below
// its clear-sky ceiling. This is presentation logic over two CAMS fields we
// already have — no separate cloud-cover model or data source.
//
// Thresholds below are deliberately conservative: a UV Index reading itself
// only carries ~0.1 of real precision, and the two fields are produced by
// independent parts of the same model, so small gaps are noise, not signal.
export type CloudImpactTier = "none" | "negligible" | "modest" | "meaningful" | "large";

export interface CloudImpact {
  tier: CloudImpactTier;
  totalUv: number;
  clearUv: number;
  /** clearUv - totalUv, clamped to >= 0 (model rounding can occasionally
   * put totalUv fractionally above clearUv; that is never a real cloud
   * effect in the other direction). */
  absoluteDiff: number;
  /** absoluteDiff as a percentage of clearUv, or null when clearUv is too
   * low for a percentage to mean anything (see CLOUD_IMPACT_MIN_CLEAR_UV). */
  percent: number | null;
}

/** Below this clear-sky UV, both total and clear are effectively "no UV"
 * (night, deep twilight) — there is nothing meaningful to compare, so no
 * cloud-impact figure is shown at all rather than dividing by a near-zero
 * number. */
export const CLOUD_IMPACT_MIN_CLEAR_UV = 0.5;

/** Below this clear-sky UV, the *category* is already "Low" regardless of
 * cloud, so even a large relative reduction isn't a meaningful claim (e.g.
 * "cloud cut UV by 70%" when clear-sky was only UV 1 reads as alarming for
 * a day that needed no protection either way). Below this floor, emphasis
 * is capped at "modest" no matter how large the percentage is. */
export const CLOUD_IMPACT_MIN_CLEAR_FOR_STRONG_CLAIM = 2.0;

/** Absolute differences smaller than this read as model/rounding noise
 * between the two independently-computed fields, not a real cloud effect —
 * e.g. total=5.9 vs clear=6.0 should never be presented as "cloud is
 * reducing UV". */
export const CLOUD_IMPACT_NEGLIGIBLE_ABS_DIFF = 0.3;

const CLOUD_IMPACT_MODEST_MAX_PERCENT = 20;
const CLOUD_IMPACT_MEANINGFUL_MAX_PERCENT = 50;

/**
 * Compares forecast (total-sky) UV against clear-sky potential UV at the
 * same instant/location and classifies how much cloud is currently expected
 * to be reducing UV, with guards against divide-by-zero and exaggerated
 * percentages at low absolute UV (see the threshold constants above).
 */
export function getCloudImpact(totalUv: number, clearUv: number): CloudImpact {
  if (clearUv < CLOUD_IMPACT_MIN_CLEAR_UV) {
    return { tier: "none", totalUv, clearUv, absoluteDiff: 0, percent: null };
  }

  const absoluteDiff = Math.max(0, clearUv - totalUv);
  const percent = (absoluteDiff / clearUv) * 100;

  let tier: CloudImpactTier;
  if (absoluteDiff < CLOUD_IMPACT_NEGLIGIBLE_ABS_DIFF) {
    tier = "negligible";
  } else if (clearUv < CLOUD_IMPACT_MIN_CLEAR_FOR_STRONG_CLAIM) {
    tier = "modest";
  } else if (percent < CLOUD_IMPACT_MODEST_MAX_PERCENT) {
    tier = "modest";
  } else if (percent < CLOUD_IMPACT_MEANINGFUL_MAX_PERCENT) {
    tier = "meaningful";
  } else {
    tier = "large";
  }

  return { tier, totalUv, clearUv, absoluteDiff, percent };
}
