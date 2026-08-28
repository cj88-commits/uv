import { en } from "../locales/en";
import { getProtectionAdvice, getPrimaryCardTiming, type DailyUvSummary, type PrimaryCardTiming } from "../lib/uv";
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
  /** The currently selected hour's ISO timestamp -- both the "now" instant
   * all timing/copy decisions below are relative to, and what the hourly
   * chart highlights if it falls within today's daylight window. */
  selectedTime: string | null;
  /** Today's peak/protection-window summary -- the exact same object the
   * hourly chart renders from, so the two can never disagree. */
  todaySummary: DailyUvSummary;
  /** Today's full local-day sample series (unfiltered), used to work out
   * where `selectedTime` sits relative to today's protection period(s) and
   * as the hourly chart's source. */
  todaySamples: PointSample[];
  /** Local days from today onward (however many the loaded forecast
   * actually covers, up to 5) -- see buildLocationForecast. */
  days: DayForecast[];
}

/** The one place that turns a PrimaryCardTiming into prose, so the day and
 * night branches below can't phrase the same state differently. Returns
 * null for "recommended" (handled separately, alongside the window text)
 * and "ended" (concise by design -- see uv.ts's module comment: a past
 * crossing has nothing useful left to say once it's over). */
function upcomingNote(timing: PrimaryCardTiming, lon: number): string | null {
  if (timing.kind !== "upcoming") return null;
  const time = toApproxLocalTime(timing.nextStart, lon);
  return timing.isFirstPeriodOfDay ? en.protectionUpcoming(time) : en.protectionUpcomingAgain(time);
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
  const timing: PrimaryCardTiming = selectedTime ? getPrimaryCardTiming(todaySamples, selectedTime) : { kind: "none" };

  if (!isDay) {
    const note = upcomingNote(timing, lon);
    return (
      <>
        <div className="location-panel night">
          <div className="headline">{en.night}</div>
          <p className="body-text">{en.nightBody}</p>
          <div className="uv-value">
            {en.currentUv} {uv.toFixed(1)}
          </div>
          {note && <p className="body-text">{note}</p>}
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
  const note = upcomingNote(timing, lon);

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

        {!advice.recommended && (
          <p className="body-text">{timing.kind === "none" ? en.protectionNoBodyToday : en.protectionNoBody}</p>
        )}

        {advice.recommended && timing.kind === "recommended" && (
          <p className="body-text protection-window">
            {en.protectionWindow(toApproxLocalTime(timing.period.start, lon), toApproxLocalTime(timing.period.end, lon))}
          </p>
        )}

        {!advice.recommended && note && <p className="body-text">{note}</p>}

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
