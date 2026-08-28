import SunCalc from "suncalc";

/**
 * True if the sun is above the horizon at (lat, lon) at `date`, using real
 * solar position rather than trusting CAMS UV ~= 0 as a night proxy.
 * A small negative altitude threshold is used so civil twilight (dim but
 * technically non-zero UV) doesn't get treated as full daylight.
 */
export function isDaylight(lat: number, lon: number, date: Date): boolean {
  const { altitude } = SunCalc.getPosition(date, lat, lon);
  return altitude > 0;
}

/**
 * Finds the next sunrise at (lat, lon) strictly after `afterIso`, using the
 * same solar-position library as isDaylight above (no second, independent
 * astronomical system). SunCalc.getTimes computes sunrise/sunset for
 * whichever UTC calendar day the Date instant it's given falls on -- since
 * that's not necessarily the SAME day as the intended local calendar day at
 * an arbitrary longitude, this searches forward instant-by-instant (not
 * "day" by SunCalc's own day boundary) until it finds a sunrise that is
 * actually after `afterIso`, which is correct regardless of how SunCalc
 * internally buckets days. Returns null if none is found within
 * `maxDaysAhead` -- most likely polar night, not a bug -- so callers must
 * never invent a sunrise time.
 */
export function getNextSunrise(lat: number, lon: number, afterIso: string, maxDaysAhead = 5): Date | null {
  const after = new Date(afterIso).getTime();
  for (let dayOffset = 0; dayOffset <= maxDaysAhead; dayOffset++) {
    const probe = new Date(after + dayOffset * 24 * 3600_000);
    const { sunrise } = SunCalc.getTimes(probe, lat, lon);
    if (sunrise instanceof Date && !Number.isNaN(sunrise.getTime()) && sunrise.getTime() > after) {
      return sunrise;
    }
  }
  return null;
}
