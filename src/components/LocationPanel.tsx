import { en } from "../locales/en";
import { getProtectionAdvice, getFirstHourAtOrAbove, PROTECTION_THRESHOLD, type DailyUvSummary } from "../lib/uv";
import { toApproxLocalTime } from "../lib/forecast";

interface Props {
  lat: number;
  lon: number;
  isDay: boolean;
  uv: number;
  uvClear: number;
  dailySummary: DailyUvSummary;
  todaySeriesForThreshold: { time: string; uv: number }[];
}

export function LocationPanel({ lat, lon, isDay, uv, uvClear, dailySummary, todaySeriesForThreshold }: Props) {
  if (!isDay) {
    const nextAboveThreshold = getFirstHourAtOrAbove(todaySeriesForThreshold, PROTECTION_THRESHOLD);
    return (
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
    );
  }

  const advice = getProtectionAdvice(uv);
  const category = en.categoryLabel[advice.category];

  return (
    <div className={advice.recommended ? "location-panel warn" : "location-panel ok"}>
      <div className="headline">{advice.recommended ? en.protectionYes.toUpperCase() : en.protectionNo.toUpperCase()}</div>

      <div className="uv-row">
        <span className="uv-value">
          {en.currentUv} {uv.toFixed(1)}
        </span>
        <span className="uv-category">{category}</span>
      </div>

      {!advice.recommended && <p className="body-text">{en.protectionNoBody}</p>}

      {advice.recommended && dailySummary.protectionWindow && (
        <p className="body-text protection-window">
          {en.protectionWindow(
            toApproxLocalTime(dailySummary.protectionWindow.start, lon),
            toApproxLocalTime(dailySummary.protectionWindow.end, lon)
          )}
        </p>
      )}

      {!advice.recommended && (() => {
        const next = getFirstHourAtOrAbove(todaySeriesForThreshold, PROTECTION_THRESHOLD);
        return next ? (
          <p className="body-text">
            {en.willReachThreshold(PROTECTION_THRESHOLD, toApproxLocalTime(next.time, lon))}
          </p>
        ) : null;
      })()}

      {dailySummary.peak && (
        <div className="peak-block">
          <div className="peak-label">{en.peakToday}</div>
          <div className="peak-value">
            {en.peakAt(dailySummary.peak.uv.toFixed(1), toApproxLocalTime(dailySummary.peak.time, lon))}
          </div>
        </div>
      )}

      <div className="clear-sky">
        {en.clearSkyPotential}: {uvClear.toFixed(1)}
      </div>

      {/* Hook point for a future, clearly-separated commercial section
          (e.g. SPF product suggestions). Intentionally empty in the MVP. */}
      <div className="protection-shop-slot" />

      <Coords lat={lat} lon={lon} />
    </div>
  );
}

function Coords({ lat, lon }: { lat: number; lon: number }) {
  return (
    <div className="coords">
      {lat.toFixed(2)}, {lon.toFixed(2)}
    </div>
  );
}
