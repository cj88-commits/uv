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
