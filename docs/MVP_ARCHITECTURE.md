# MVP architecture

One question this project exists to answer: **does a simple global UV map
that says "do I need sunscreen?" feel useful enough to invest further in?**
Everything below is scoped to answering that as cheaply and simply as
possible — not to production-grade infrastructure.

## Overview

```
CAMS (Copernicus ADS)
   │  cdsapi, GRIB, uvbed + uvbedcs
   ▼
scripts/cams/download_forecast.py   (Python)
   │  raw GRIB, 0-36h leadtime, global, most recent 00/12 UTC run
   ▼
scripts/cams/process_forecast.py    (Python)
   │  decode GRIB -> UV Index (uvbed x 40) -> thin 0.4° grid to 1° grid
   ▼
public/data/manifest.json + public/data/hourly/*.json   (static files)
   │  committed to the repo, served as-is by GitHub Pages
   ▼
React + TypeScript + Vite frontend (src/)
   │  fetch manifest + hourly files, MapLibre GL for the basemap,
   │  a per-hour <canvas> raster for the UV field, client-side day/night
   │  via SunCalc, client-side peak/window derivation
   ▼
Static site on GitHub Pages
```

There is no server, no database, no build-time backend. The only moving
part beyond the static frontend is the (manually triggered) data-refresh
script.

## CAMS data

See `docs/CAMS_UV.md` for the fully sourced findings. In short: the ADS
dataset `cams-global-atmospheric-composition-forecasts` provides `uvbed`
and `uvbedcs` (erythemal UV dose rate, W m⁻²) hourly, globally, at 0.4°,
for a 120 h horizon, twice daily. `UV Index = doseRate × 40`.

## Download script (`scripts/cams/`)

- `common.py` — shared cdsapi client construction and the UV Index factor.
- `poc_download.py` — the small proof-of-concept script required before any
  full download: a limited Europe-ish bounding box, only leadtime hours
  0-3, prints diagnostics (timestamps, grid shape, min/max UV, file sizes).
  Run this first to confirm credentials and the processing logic work.
- `download_forecast.py` — the real MVP download: **global** area,
  leadtime hours **0-36** (not the full 120 h horizon — this MVP only needs
  "today", and a smaller download is cheaper and faster to iterate on),
  picks the most recently-published 00/12 UTC run automatically (with a
  latency allowance, and a fallback to an older run if the newest one
  isn't published yet). 36h rather than 24h is deliberate — see below.
- `process_forecast.py` — reads the GRIB with `cfgrib`, extracts `uvbed`
  and `uvbedcs`, converts to UV Index, **thins** (nearest-neighbour
  selection, not interpolation) the native 0.4° grid down to a 1°
  grid, and writes the static JSON files described below.

Why 1° instead of the native 0.4°: it cuts each hourly file's size by
~85% with negligible loss of real information for a consumer-facing
map (CAMS itself is already a ~40 km-cell forecast, not a sensor grid).
This is disclosed to users, not hidden.

Why 0-36h and not the full 120h horizon: the app only needs "today's peak"
and a handful of near-term hours. Fetching 120h of global hourly data would
be ~3-4x the size for data the MVP doesn't use yet.

Why 36h and not 24h: verified against a real download, this dataset's
publish latency can exceed 12h — the freshest run available was sometimes
already ~22h old. A 24h fetch in that situation left almost no "+1h..+5h"
lookahead by the time the data was actually used; 36h keeps a real buffer
without meaningfully increasing file size.

## Generated data format

`public/data/manifest.json`:

```json
{
  "source": "CAMS global atmospheric composition forecasts",
  "run": "2026-08-27T00:00:00Z",
  "generated_at": "2026-08-27T09:12:00Z",
  "attribution": "Generated using Copernicus Atmosphere Monitoring Service information 2026",
  "licence": "CC-BY 4.0 (Licence to use Copernicus Products)",
  "uv_index_factor": 40,
  "value_encoding": "int16, UV Index x 10",
  "grid": {
    "lat_start": 90, "lat_step": -1, "nlat": 181,
    "lon_start": -180, "lon_step": 1, "nlon": 360,
    "order": "row-major, latitude outer loop (north to south), longitude inner loop (west to east)",
    "native_resolution_deg": 0.4,
    "thinned_resolution_deg": 1.0
  },
  "hours": [
    { "time": "2026-08-27T00:00:00Z", "offset_hours": 0, "file": "hourly/2026-08-27T00:00:00Z.json" }
  ]
}
```

`public/data/hourly/<time>.json`:

```json
{ "time": "2026-08-27T00:00:00Z", "uv": [/* 65160 int16s, UV x10 */], "uv_clear": [/* same length */] }
```

Values are encoded as `UV Index × 10` in `int16` to keep files small
without floating-point text bloat; the frontend divides by 10 on load
(`src/lib/forecast.ts::decode`).

**Two datasets, one format, on purpose.** The same per-hour grid file
serves both the map (colour the whole grid for the selected hour) and the
location panel (look up the nearest cell to the clicked point, across every
loaded hour, to derive today's peak/window). There is deliberately no
separate "point API" — the frontend does a nearest-cell lookup into the
grid it already has in memory.

## Map rendering

The UV field is the map's primary content — a continuous heat-map raster,
not a per-country political map with a data overlay bolted on.

- **Basemap**: still MapLibre GL JS with the free, no-key
  `demotiles.maplibre.org` vector tiles, but its default style (which
  fills every country with one of eight arbitrary bright colours — a
  "political map" look) is restyled after load
  (`src/components/MapView.tsx::restyleBasemap`) to neutral dark land/ocean
  fills, subtle borders, and readable halo'd labels, so it recedes behind
  the data. This is a runtime dependency on a third-party host; acceptable
  for an MVP, worth revisiting if this becomes a real product (e.g. bundle
  a static vector style). The restyle is wrapped in try/catch and simply
  no-ops if the upstream style's layer IDs ever change.
- **UV field** (`src/lib/mapRender.ts`): for the selected hour, a `<canvas>`
  is filled via `ImageData` at 4x the ~1° CAMS grid's resolution
  (1440×721 px). Each output pixel is **bilinearly interpolated** from the
  four nearest CAMS grid cells (both the UV value and, separately, solar
  altitude — see Night below), then mapped through a **continuous** UV
  colour ramp (`src/lib/colorRamp.ts`) rather than quantised into five flat
  category bands, so e.g. UV 3.1 and UV 4.9 render as visibly distinct
  hues, not identical blocks. The canvas is exported to a data URL and
  added to MapLibre as an `image` source, inserted *below* the border/label
  layers but *above* the neutral land/ocean fill, so borders and labels
  stay legible on top while the raster itself is the dominant layer.
  Changing the selected hour calls `source.updateImage(...)` with a
  freshly rendered (or cached — see Performance) canvas.
- Interpolation is **visual smoothing only** — it never implies the
  underlying forecast has finer real resolution than the native CAMS grid.
  It also does not meaningfully shift where high/low UV appears: bilinear
  interpolation between adjacent 1° cells only ever produces values between
  their two originals.
- **Night**: computed independently of the UV data via
  `SunCalc.getPosition` (real solar altitude in degrees), not by treating
  CAMS's near-zero night-time UV as "low UV" — an explicit project
  requirement. Rather than a hard day/night boolean per pixel, altitude
  itself is bilinearly interpolated and blended into a dark overlay colour
  over a ±6° band around the horizon, producing a soft, naturally-curved
  terminator (closer to how the day/night line actually looks from space)
  instead of a jagged one-grid-cell-wide edge.
- **Performance** (measured, see the accompanying report for exact
  numbers): computing the 65,160-point solar-altitude grid and the
  ~1.04M-pixel bilinear/colour pass together take well under 100ms, and
  only run once per hour — each rendered frame is cached in memory
  (`frameCacheRef` in `MapView.tsx`) keyed by timestamp, so re-selecting an
  already-viewed hour (e.g. flipping back to "Now") is instant.

## Frontend data flow

1. On load, fetch `manifest.json`, then eagerly fetch every listed hourly
   file (typically ~25 files, a few hundred KB gzipped in total — see
   "Actual data sizes" in the final report). Once loaded, everything else
   is synchronous, in-memory math; there is no per-click network request.
2. "Now" is resolved to the closest available hour in the manifest;
   "+1h..+5h" are relative to that index, not to the run's start time.
3. Clicking the map or using geolocation sets a `{lat, lon}`; the app then
   samples the nearest grid cell across every loaded hour
   (`seriesAtLocation`), filters that series to an **approximate** local
   "today" (`filterToday` — longitude ÷ 15, rounded, as a stand-in for a
   real timezone lookup — see Limitations), and runs it through
   `getDailyUvSummary` for peak/peak-time/protection-window.
4. All UV thresholds and category boundaries live in one file,
   `src/lib/uv.ts` (`getUvCategory`, `getProtectionAdvice`,
   `getDailyUvSummary`) — nothing else hard-codes a threshold.
5. All user-facing copy lives in `src/locales/en.ts`.

## Deployment

GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`): on every
push to `main`, install, run tests, `vite build`, publish `dist/` as a
Pages artifact, deploy. No servers, no containers, no secrets required for
this workflow because the forecast data is already committed as static
files under `public/data/`.

A second, **manual-only** workflow
(`.github/workflows/refresh-cams-data.yml`) re-runs the download/process
pipeline in CI and commits the refreshed `public/data/*` back to `main`
(which then triggers the deploy workflow). It needs two repository
secrets: `CDSAPI_URL` and `CDSAPI_KEY` (see README for how to obtain and
set them). This is deliberately not scheduled/cron'd for the MVP — refresh
it by hand from the Actions tab when you want new data. It is equally
acceptable to run the two Python scripts locally and commit the resulting
`public/data/*` files yourself, and to only add the scheduled/automated
version later if the MVP proves worth investing further in.

## Limitations (MVP-quality, by design)

- **Spatial resolution**: CAMS is ~40 km-per-cell (0.4°, thinned further to
  1° here); this is regional forecast guidance, not street-level or
  live-sensor accuracy.
- **Temporal resolution**: hourly. The UI never claims minute-level
  precision — "reaches 3 at around 10:00" is explicitly hedged as
  approximate.
- **"Today" boundary**: computed from longitude ÷ 15 as a rough proxy for
  local time zone, not a real timezone/DST database. Near timezone
  boundaries or in places with unusual offsets (e.g. half-hour zones,
  India, parts of Australia) the local "today" cutoff can be off by up to
  ~30-40 minutes. This only matters right at midnight; it doesn't affect
  midday peak values.
- **Forecast horizon fetched**: only 0-36h from the most recent run, so a
  stale (not-yet-refreshed) dataset can still leave less than a full day of
  "today" for locations far ahead of the run's UTC day, or fewer than the
  full +1h..+5h options if the run being used is already old (observed in
  practice: this dataset's publish latency can exceed 12h).
- **Forecast, not observation**: this is CAMS model guidance (which
  already includes forecast cloud cover), not a live UV sensor reading.
  Local, fast-moving cloud will make the real UV at a given moment differ
  from the forecast.
- **Protection advice is intentionally simplified**: a single UV ≥ 3
  threshold, no SPF-number mapping, no skin-type personalisation.
- **Basemap dependency**: relies on the free `demotiles.maplibre.org`
  style at runtime; not self-hosted.
- **No automatic data refresh**: refreshing CAMS data is a manual Action
  trigger (or local run), not a cron job.

## What would need to change for production

- Self-host (or vendor) the basemap style instead of depending on
  `demotiles.maplibre.org`.
- A real timezone lookup (e.g. a timezone-boundary dataset) instead of the
  longitude/15 approximation, for an accurate local "today"/midnight
  boundary.
- Scheduled, automated data refresh (cron'd GitHub Action, or a small
  serverless function) instead of manual triggering, plus monitoring for
  failed/stale runs.
- Decide on the real spatial/temporal resolution tradeoff (higher-res grid,
  longer horizon) once there's evidence the product is worth the extra
  bandwidth/build-size cost.
- Address history / place search, once validated as wanted (currently out
  of scope, no paid geocoding service integrated).
- Real internationalisation (multiple locale files, a language switcher)
  once `src/locales/en.ts` has proven the string-extraction approach.
- Only then consider affiliate/commercial integration in the
  already-reserved `.protection-shop-slot` hook point.
