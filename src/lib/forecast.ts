// Loading and querying the static CAMS-derived forecast data produced by
// scripts/cams/process_forecast.py. See docs/MVP_ARCHITECTURE.md for the
// exact file format.

export interface ManifestGrid {
  lat_start: number;
  lat_step: number;
  nlat: number;
  lon_start: number;
  lon_step: number;
  nlon: number;
  native_resolution_deg: number;
  thinned_resolution_deg: number;
}

export interface ManifestHour {
  time: string; // ISO8601 UTC
  offset_hours: number;
  file: string;
}

export interface Manifest {
  source: string;
  run: string;
  generated_at: string;
  attribution: string;
  licence: string;
  uv_index_factor: number;
  grid: ManifestGrid;
  hours: ManifestHour[];
}

export interface HourlyGrid {
  time: string;
  /** UV Index, decoded from the int16 x10 wire format. */
  uv: Float32Array;
  uvClear: Float32Array;
}

interface RawHourlyFile {
  time: string;
  uv: number[];
  uv_clear: number[];
}

export function decode(values: number[]): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / 10;
  return out;
}

export async function loadManifest(baseUrl = "./data/"): Promise<Manifest> {
  const res = await fetch(`${baseUrl}manifest.json`);
  if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
  return res.json();
}

export async function loadHour(hour: ManifestHour, baseUrl = "./data/"): Promise<HourlyGrid> {
  const res = await fetch(`${baseUrl}${hour.file}`);
  if (!res.ok) throw new Error(`Failed to load ${hour.file}: ${res.status}`);
  const raw: RawHourlyFile = await res.json();
  return { time: raw.time, uv: decode(raw.uv), uvClear: decode(raw.uv_clear) };
}

export async function loadAllHours(manifest: Manifest, baseUrl = "./data/"): Promise<Map<string, HourlyGrid>> {
  const entries = await Promise.all(
    manifest.hours.map(async (h) => [h.time, await loadHour(h, baseUrl)] as const)
  );
  return new Map(entries);
}

/** Nearest grid cell index for a lat/lon, clamped to the grid bounds. */
export function gridIndex(grid: ManifestGrid, lat: number, lon: number): { row: number; col: number } {
  const rowF = (lat - grid.lat_start) / grid.lat_step;
  let row = Math.round(rowF);
  row = Math.max(0, Math.min(grid.nlat - 1, row));

  // Normalize longitude into the grid's own range before indexing.
  let normLon = lon;
  while (normLon < grid.lon_start) normLon += 360;
  while (normLon >= grid.lon_start + 360) normLon -= 360;
  const colF = (normLon - grid.lon_start) / grid.lon_step;
  let col = Math.round(colF) % grid.nlon;
  if (col < 0) col += grid.nlon;

  return { row, col };
}

export function sampleGrid(grid: ManifestGrid, data: Float32Array, lat: number, lon: number): number {
  const { row, col } = gridIndex(grid, lat, lon);
  return data[row * grid.nlon + col];
}

export interface PointSample {
  time: string;
  uv: number;
  uvClear: number;
}

/** Builds the full loaded time series at one location, for peak/window/etc. */
export function seriesAtLocation(
  manifest: Manifest,
  hours: Map<string, HourlyGrid>,
  lat: number,
  lon: number
): PointSample[] {
  return manifest.hours
    .map((h) => hours.get(h.time))
    .filter((h): h is HourlyGrid => h !== undefined)
    .map((h) => ({
      time: h.time,
      uv: sampleGrid(manifest.grid, h.uv, lat, lon),
      uvClear: sampleGrid(manifest.grid, h.uvClear, lat, lon),
    }));
}

/** Approximate local UTC-offset for a longitude, used only to decide which
 * forecast hours count as "today" at that location (see docs/MVP_ARCHITECTURE.md
 * — this is a longitude-based approximation, not a real timezone lookup). */
export function approxUtcOffsetHours(lon: number): number {
  return Math.round(lon / 15);
}

/** Approximate local calendar date (YYYY-MM-DD) for a UTC instant at a given
 * longitude — see approxUtcOffsetHours. Exported so every "group by local
 * day" consumer (today's filter, the multi-day forecast, tests) shares this
 * one definition rather than each re-deriving it slightly differently. */
export function localDateKey(isoTimeUtc: string, lon: number): string {
  const d = new Date(isoTimeUtc);
  const shifted = new Date(d.getTime() + approxUtcOffsetHours(lon) * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

export interface LocalDayGroup {
  dateKey: string;
  samples: PointSample[];
}

/** Groups a chronological series into consecutive local calendar days at a
 * given longitude. `series` is assumed chronological (as produced by
 * seriesAtLocation, which walks manifest.hours in order) so the returned
 * groups come out in chronological order for free — no separate sort needed. */
export function groupByLocalDate(series: PointSample[], lon: number): LocalDayGroup[] {
  const groups: LocalDayGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const point of series) {
    const key = localDateKey(point.time, lon);
    let idx = indexByKey.get(key);
    if (idx === undefined) {
      idx = groups.length;
      indexByKey.set(key, idx);
      groups.push({ dateKey: key, samples: [] });
    }
    groups[idx].samples.push(point);
  }
  return groups;
}

/** Filters a location's series down to entries sharing "today" (approximate
 * local date) with `nowIso`. Implemented on top of groupByLocalDate so this
 * and the multi-day forecast can never disagree about which frames belong
 * to which local day. */
export function filterToday(series: PointSample[], lon: number, nowIso: string): PointSample[] {
  const key = localDateKey(nowIso, lon);
  return groupByLocalDate(series, lon).find((g) => g.dateKey === key)?.samples ?? [];
}

/** Formats a UTC hourly timestamp as an approximate local "HH:00" string for
 * a given longitude (see approxUtcOffsetHours — not a real timezone lookup). */
export function toApproxLocalTime(isoTimeUtc: string, lon: number): string {
  const d = new Date(isoTimeUtc);
  const shifted = new Date(d.getTime() + approxUtcOffsetHours(lon) * 3600_000);
  const hh = shifted.getUTCHours().toString().padStart(2, "0");
  const mm = shifted.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Index of the manifest hour whose timestamp is closest to `nowIso`. */
export function nearestHourIndex(manifest: Manifest, nowIso: string): number {
  const now = new Date(nowIso).getTime();
  let bestIdx = 0;
  let bestDiff = Infinity;
  manifest.hours.forEach((h, i) => {
    const diff = Math.abs(new Date(h.time).getTime() - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  });
  return bestIdx;
}

export interface NowResolution {
  index: number;
  time: string;
  /** nowIso minus the resolved frame's time, in ms. Positive means the
   * resolved frame is in the past relative to the real instant `nowIso`
   * (e.g. because the committed forecast data hasn't been refreshed
   * recently enough to cover the current moment). */
  staleMs: number;
}

/**
 * Resolves what "Now" actually means against the loaded manifest, and how
 * far that resolved frame is from the real current instant. `nearestHourIndex`
 * always returns *some* index — with no data fresher than a day-old run,
 * that can silently be many hours away from real "now", which previously
 * showed as (for example) a genuinely-nighttime frame being presented as
 * "Now" for a location that is actually in daylight. Callers should treat
 * a large `staleMs` as "this isn't really live data" rather than trusting
 * the resolved frame's day/night/UV state as current.
 */
export function resolveNow(manifest: Manifest, nowIso: string): NowResolution {
  const index = nearestHourIndex(manifest, nowIso);
  const time = manifest.hours[index].time;
  const staleMs = new Date(nowIso).getTime() - new Date(time).getTime();
  return { index, time, staleMs };
}
