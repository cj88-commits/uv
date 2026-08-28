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
// uvbedcs (clear-sky, the same quantity as if the sky were cloud-free). This
// is presentation logic over those two CAMS fields we already have — no
// separate cloud-cover model or data source.
//
// Deliberately action-oriented, not percentage-first: a consumer doesn't
// primarily care that "cloud is reducing UV by 45%" -- they care whether
// their sun-protection decision could change if the sky clears. So the
// decision here is binary-ish (does the advice change, or is clear-sky
// materially stronger than an already-recommended forecast?), not a tier
// ladder. "none" means: don't show the section at all, because there's
// nothing actionable to say.
export type CloudImpactKind =
  | "none"
  /** forecast UV is below the protection threshold but clear-sky UV is at
   * or above it -- the single highest-value case, since it's the one
   * situation where "should I protect?" itself could flip. */
  | "adviceChange"
  /** protection is already recommended at the forecast UV, and clear-sky UV
   * is materially higher still -- worth flagging, but not advice-changing. */
  | "limiting";

export interface CloudImpactResult {
  kind: CloudImpactKind;
  forecastUv: number;
  clearUv: number;
  /** clearUv - forecastUv, clamped to >= 0 (model rounding can occasionally
   * put forecastUv fractionally above clearUv; that is never a real cloud
   * effect in the other direction). */
  diff: number;
  /** diff as a percentage of clearUv, kept for tests/debugging only -- the
   * UI deliberately does not lead with this (see module comment above). Null
   * when clearUv is 0 (nothing to divide by). */
  percent: number | null;
}

/** Below this clear-sky UV, both fields are effectively "no UV" (deep
 * twilight) -- nothing meaningful to compare, and this also guards the
 * percent calculation from a near-zero denominator. Night itself is gated
 * separately by the caller passing `isDay` (see getCloudImpact) rather than
 * inferred from this alone, per the existing real solar-altitude day/night
 * logic in daynight.ts. */
export const CLOUD_IMPACT_MIN_CLEAR_UV = 0.5;

/** Once protection is already recommended at the forecast UV (case
 * "limiting"), clear-sky UV needs to be at least this much higher before
 * it's worth flagging as "materially stronger" -- e.g. 5.9 vs 6.0 (a 0.1
 * gap between two independently-computed fields) is rounding noise, not a
 * real cloud effect, and should never be presented as meaningful. 1.0 (a
 * full UV Index step) was chosen as a round, easily-justified "this is
 * clearly more than noise" bar -- roughly half the width of a UV category
 * band. Note the "adviceChange" case has no such floor: ANY crossing of the
 * protection threshold is inherently the highest-value case regardless of
 * how numerically small the gap is (e.g. forecast 2.9 vs clear 3.1). */
export const CLOUD_IMPACT_MATERIAL_ABS_DIFF = 1.0;

/**
 * Compares forecast (total-sky) UV against clear-sky potential UV at the
 * same instant/location and decides whether there's an actionable "cloud
 * impact" story worth showing, per the two cases above. `isDay` should come
 * from the same real solar-altitude day/night check already used elsewhere
 * (daynight.ts) -- night is never shown here, however the two UV values
 * happen to compare.
 */
export function getCloudImpact(forecastUv: number, clearUv: number, isDay: boolean): CloudImpactResult {
  const diff = Math.max(0, clearUv - forecastUv);
  const percent = clearUv > 0 ? (diff / clearUv) * 100 : null;

  if (!isDay || clearUv < CLOUD_IMPACT_MIN_CLEAR_UV) {
    return { kind: "none", forecastUv, clearUv, diff, percent: null };
  }

  if (forecastUv < PROTECTION_THRESHOLD && clearUv >= PROTECTION_THRESHOLD) {
    return { kind: "adviceChange", forecastUv, clearUv, diff, percent };
  }

  if (forecastUv >= PROTECTION_THRESHOLD && diff >= CLOUD_IMPACT_MATERIAL_ABS_DIFF) {
    return { kind: "limiting", forecastUv, clearUv, diff, percent };
  }

  return { kind: "none", forecastUv, clearUv, diff, percent };
}
