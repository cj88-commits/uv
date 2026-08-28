// Single derived-data representation for a selected location: today's
// summary, the hourly chart series, and the multi-day forecast all come
// from this one module so they can never disagree with each other (each is
// just a different view over the same PointSample[] series and the same
// getDailyUvSummary/getProtectionAdvice calls uv.ts already uses for the
// primary result card).
import { groupByLocalDate, localDateKey, toApproxLocalTime, type PointSample } from "./forecast";
import { getDailyUvSummary, getProtectionAdvice, type DailyUvSummary, type UvCategory } from "./uv";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Short weekday label for a local calendar-date key (YYYY-MM-DD), e.g.
 * "Sat". Parsed as UTC noon so the label is a pure calendar-date lookup,
 * unaffected by the browser's own timezone. */
export function weekdayShortLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  return WEEKDAY_SHORT[d.getUTCDay()];
}

export interface DayForecast {
  /** Local calendar date (YYYY-MM-DD) this day represents, per
   * groupByLocalDate's longitude-based approximation. */
  dateKey: string;
  /** true for the local day containing `referenceIso`. */
  isToday: boolean;
  /** All loaded samples belonging to this local day, chronological. */
  samples: PointSample[];
  /** Same shape/derivation as the primary card's summary — peak +
   * protection window — just scoped to this one day. */
  summary: DailyUvSummary;
  category: UvCategory | null;
  protectionRecommended: boolean;
  /** Approximate local "HH:mm" time of this day's peak, or null if the day
   * has no samples (shouldn't happen — groupByLocalDate only creates
   * groups that have at least one sample). */
  peakLocalTime: string | null;
}

export interface LocationForecast {
  /** The local day containing `referenceIso` (usually the selected hour),
   * or null if that day isn't present in the loaded series at all (e.g. the
   * series is empty). */
  today: DayForecast | null;
  /** Local days from `today` onward, in chronological order, limited to
   * `maxDays`. Deliberately not padded out to a fixed length — a day only
   * appears here if the loaded forecast actually has meaningful coverage
   * for it (see hasMeaningfulDaylightCoverage: MIN_SAMPLES_FOR_FUTURE_DAY
   * samples AND a nonzero peak). `today` is always kept, however sparse —
   * the primary card is already answering for it regardless. Beyond that,
   * the CAMS horizon's last loaded day is often just its trailing edge
   * (e.g. a single post-midnight hour), and reporting that one low/zero
   * night-time sample as "Saturday's peak" would be exactly the kind of
   * manufactured, misleading day this list must avoid — so if the loaded
   * horizon covers 5 full local days, 5 appear here; if it only reaches
   * partway into a 5th day, only 4 do (see MVP_ARCHITECTURE.md). */
  days: DayForecast[];
}

/** A future (non-"today") local day needs at least this many loaded hourly
 * samples before it's considered a real daily summary rather than a bare
 * sliver of the CAMS horizon's trailing edge. 6 hours is a low bar (a
 * quarter of a day) chosen only to exclude near-empty tail days, not to
 * demand full coverage. Combined with requiring a nonzero peak (see
 * hasMeaningfulDaylightCoverage below) so a day whose few loaded samples
 * happen to all be night-time hours doesn't pass on count alone. */
export const MIN_SAMPLES_FOR_FUTURE_DAY = 6;

function toDayForecast(dateKey: string, samples: PointSample[], lon: number, referenceKey: string): DayForecast {
  const summary = getDailyUvSummary(samples);
  const advice = summary.peak ? getProtectionAdvice(summary.peak.uv) : null;
  return {
    dateKey,
    isToday: dateKey === referenceKey,
    samples,
    summary,
    category: advice?.category ?? null,
    protectionRecommended: advice?.recommended ?? false,
    peakLocalTime: summary.peak ? toApproxLocalTime(summary.peak.time, lon) : null,
  };
}

/** A future day counts as having a "meaningful daily peak" (see #6 in the
 * spec: showing a real day, not a manufactured placeholder) only if it has
 * enough samples AND at least one of them is actually above zero -- a
 * handful of loaded samples that all happen to land at night would
 * otherwise pass the sample-count check alone and render as a bogus
 * "peak UV 0.0" day. */
function hasMeaningfulDaylightCoverage(day: DayForecast): boolean {
  return day.samples.length >= MIN_SAMPLES_FOR_FUTURE_DAY && (day.summary.peak?.uv ?? 0) > 0;
}

/**
 * Builds today's summary and the multi-day forecast from one loaded series,
 * grouped into local calendar days at `lon` (see groupByLocalDate).
 * `referenceIso` picks which loaded day counts as "today" — pass the
 * currently selected hour (Now/+1h../+5h), matching how the existing
 * primary card already scopes "today" to the selected hour's local day.
 */
export function buildLocationForecast(
  series: PointSample[],
  lon: number,
  referenceIso: string,
  maxDays = 5
): LocationForecast {
  const groups = groupByLocalDate(series, lon);
  const referenceKey = localDateKey(referenceIso, lon);

  const days: DayForecast[] = [];
  let today: DayForecast | null = null;
  let startCollecting = false;

  for (const group of groups) {
    if (!startCollecting) {
      if (group.dateKey !== referenceKey) continue;
      startCollecting = true;
    }
    const day = toDayForecast(group.dateKey, group.samples, lon, referenceKey);
    if (day.isToday) today = day;
    if (!day.isToday && !hasMeaningfulDaylightCoverage(day)) continue;
    days.push(day);
    if (days.length >= maxDays) break;
  }

  return { today, days };
}

/**
 * Trims a local day's hourly samples down to the "useful daylight period"
 * for the hourly chart: the contiguous run from the first to the last
 * sample with UV > 0, padded by `padHours` on each side for context. CAMS
 * itself reports ~0 at night, so this is a simple, self-contained way to
 * drop the long flat overnight stretch without needing a separate sunrise/
 * sunset calculation. Falls back to the full input when every sample is 0
 * (e.g. polar night) so the chart still renders something coherent.
 */
export function trimToDaylightWindow(samples: PointSample[], padHours = 1): PointSample[] {
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].uv > 0) {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (first === -1) return samples;
  const start = Math.max(0, first - padHours);
  const end = Math.min(samples.length - 1, last + padHours);
  return samples.slice(start, end + 1);
}
