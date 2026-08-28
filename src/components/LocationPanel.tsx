import { en } from "../locales/en";
import { getProtectionAdvice, getFirstHourAtOrAbove, PROTECTION_THRESHOLD, type DailyUvSummary } from "../lib/uv";
import { toApproxLocalTime, type PointSample } from "../lib/forecast";
import { trimToDaylightWindow, type DayForecast } from "../lib/locationForecast";
import { HourlyUvChart } from "./HourlyUvChart";
import { DailyForecastStrip } from "./DailyForecastStrip";
import { CloudImpact } from "./CloudImpact";

interface Props {
  lat: number;
  lon: number;
  isDay: boolean;
  uv: number;
  uvClear: number;
  /** The currently selected hour's ISO timestamp, so the hourly chart can
   * highlight it if it falls within today's daylight window. */
  selectedTime: string | null;
  /** Today's peak/protection-window summary -- the exact same object the
   * hourly chart renders from, so the two can never disagree. */
  todaySummary: DailyUvSummary;
  /** Today's full local-day sample series (unfiltered), used for the
   * "reaches UV 3 at around..." lookups and as the hourly chart's source. */
  todaySamples: PointSample[];
  /** Local days from today onward (however many the loaded forecast
   * actually covers, up to 5) -- see buildLocationForecast. */
  days: DayForecast[];
}

export function LocationPanel({
  lat,
  lon,
  isDay,
  uv,
  uvClear,
  selectedTime,
  todaySummary,
  todaySamples,
  days,
}: Props) {
  const chartPoints = trimToDaylightWindow(todaySamples).map((s) => ({ time: s.time, uv: s.uv }));

  if (!isDay) {
    const nextAboveThreshold = getFirstHourAtOrAbove(todaySamples, PROTECTION_THRESHOLD);
    return (
      <>
        <div className="location-panel night">
          <div className="headline">{en.night}</div>
          <p className="body-text">{en.nightBody}</p>
          <div className="uv-value">
            {en.currentUv} {uv.toFixed(1)}
          </div>
          {nextAboveThreshold && (
            <p className="body-text">
              {en.willReachThreshold(PROTECTION_THRESHOLD, toApproxLocalTime(nextAboveThreshold.time, lon))}
            </p>
          )}
          <Coords lat={lat} lon={lon} />
        </div>
        <HourlyUvChart points={chartPoints} summary={todaySummary} lon={lon} selectedTime={selectedTime} />
        <DailyForecastStrip days={days} />
        <CloudImpact forecastUv={uv} clearUv={uvClear} isDay={isDay} />
      </>
    );
  }

  const advice = getProtectionAdvice(uv);
  const category = en.categoryLabel[advice.category];

  return (
    <>
      <div className={advice.recommended ? "location-panel warn" : "location-panel ok"}>
        <div className="headline">{advice.recommended ? en.protectionYes.toUpperCase() : en.protectionNo.toUpperCase()}</div>

        <div className="uv-row">
          <span className="uv-value">
            {en.currentUv} {uv.toFixed(1)}
          </span>
          <span className="uv-category">{category}</span>
        </div>

        {!advice.recommended && <p className="body-text">{en.protectionNoBody}</p>}

        {advice.recommended && todaySummary.protectionWindow && (
          <p className="body-text protection-window">
            {en.protectionWindow(
              toApproxLocalTime(todaySummary.protectionWindow.start, lon),
              toApproxLocalTime(todaySummary.protectionWindow.end, lon)
            )}
          </p>
        )}

        {!advice.recommended && (() => {
          const next = getFirstHourAtOrAbove(todaySamples, PROTECTION_THRESHOLD);
          return next ? (
            <p className="body-text">
              {en.willReachThreshold(PROTECTION_THRESHOLD, toApproxLocalTime(next.time, lon))}
            </p>
          ) : null;
        })()}

        {todaySummary.peak && (
          <div className="peak-block">
            <div className="peak-label">{en.peakToday}</div>
            <div className="peak-value">
              {en.peakAt(todaySummary.peak.uv.toFixed(1), toApproxLocalTime(todaySummary.peak.time, lon))}
            </div>
          </div>
        )}

        {/* Hook point for a future, clearly-separated commercial section
            (e.g. SPF product suggestions). Intentionally empty in the MVP. */}
        <div className="protection-shop-slot" />

        <Coords lat={lat} lon={lon} />
      </div>

      <HourlyUvChart points={chartPoints} summary={todaySummary} lon={lon} selectedTime={selectedTime} />
      <DailyForecastStrip days={days} />
      <CloudImpact forecastUv={uv} clearUv={uvClear} isDay={isDay} />
    </>
  );
}

function Coords({ lat, lon }: { lat: number; lon: number }) {
  return (
    <div className="coords">
      {lat.toFixed(2)}, {lon.toFixed(2)}
    </div>
  );
}
