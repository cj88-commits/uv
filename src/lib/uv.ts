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
