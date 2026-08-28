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
  itself is bilinearly interpolated into a `dayFactor` over a ±6° band
  around the horizon (a soft, naturally-curved terminator, not a jagged
  one-grid-cell edge). On land, `dayFactor` drives the pixel's **alpha**
  (full UV colour in daylight, fading to fully transparent — revealing the
  basemap's own static land colour — at night); it is never used to tint
  the pixel toward a "night colour", and it has no effect on ocean at all
  (see Land masking below).
- **Land masking** (`src/lib/landMask.ts`,
  `scripts/landmask/generate-land-mask.mjs`): the UV overlay is painted
  **only on land** — the ocean is always fully transparent (alpha 0),
  day or night, so it never carries a UV tint and the basemap's ocean
  styling shows through unchanged. A precomputed raster (`public/data/
  land-mask.png`, white = land / black = ocean, 1440×721 — the same
  extent and resolution as the UV raster) is generated **once**, offline,
  from Natural Earth land polygons (`world-atlas`'s 50m dataset) via a
  scanline polygon fill (not per-pixel point-in-polygon, which would be
  far too slow at ~1M pixels — see the script for the antimeridian-edge
  handling this required to avoid corrupting the fill). At runtime the app
  fetches this PNG once, decodes it to a `Uint8Array` via canvas, and
  `computeUvFrame` looks up each output pixel's land/ocean state before
  deciding whether to draw anything there at all — ocean pixels are
  `continue`'d immediately, leaving alpha at its default of 0. Regenerate
  the mask with `npm run generate:landmask` (rarely needed — it depends
  only on coastlines, not on CAMS data).
- **Performance** (measured, see the accompanying report for exact
  numbers): computing the 65,160-point solar-altitude grid and the
  ~1.04M-pixel bilinear/colour pass together take well under 100ms, and
  only run once per hour — each rendered frame is cached in memory
  (`frameCacheRef` in `MapView.tsx`) keyed by timestamp, so re-selecting an
  already-viewed hour (e.g. flipping back to "Now") is instant.
- **Web Mercator cannot represent the poles** (`MercatorCoordinate.fromLngLat`
  returns `Infinity` at lat=-90 and a huge out-of-range value at lat=+90).
  A real bug shipped briefly where the `image` source's corner coordinates
  used the grid's raw +/-90 extent, corrupting the whole image quad's
  transform (not just the polar pixels) and making the *entire* globe
  render as night. Fixed by clamping the raster's bounds to
  `MERCATOR_LAT_LIMIT` (the exact Web Mercator latitude limit,
  `atan(sinh(pi))` in degrees ≈ 85.0511288°, derived rather than
  approximated) in `computeUvFrame`, and having `MapView.tsx` build
  MapLibre's image-source coordinates from that function's *returned*
  bounds rather than recomputing them separately.
- **The raster's row spacing must itself be in Web Mercator, not
  equirectangular.** A second, separate bug: even with correct corner
  bounds, `computeUvFrame` was placing row `py` at a latitude *linear* in
  `py` (`lat = north + (south-north)*py/(h-1)`). MapLibre's `image` source
  stretches the bitmap *linearly in Web Mercator space* between the given
  corners, not linearly in latitude — so a linear-in-latitude raster
  systematically misplaces every row except the poles and the equator,
  worse at higher latitudes (Web Mercator increasingly stretches out
  latitude spacing near the poles relative to equirectangular). This
  showed up as UV colour bleeding into the ocean west of Iberia/NW Africa
  and coastlines not lining up for the UK/Scandinavia. Fixed by generating
  each row's latitude via the inverse Web Mercator formula
  (`mercatorPyToLat` in `mapRender.ts`: `n = pi - 2*pi*py/(h-1)`,
  `lat = atan(sinh(n))` in degrees) instead of linear interpolation, with
  the corresponding forward projection (`mercatorLatToPy`) used wherever a
  lat/lon needs to be located within an already-computed frame (tests,
  point sampling). CAMS's own internal grid and the land mask's own
  internal raster remain ordinary equirectangular lookup tables — both are
  only ever queried *by* lat/lon, never displayed directly by MapLibre, so
  neither needed to change; only the *displayed* UV raster's row spacing
  did. Verified via `src/lib/mercatorProjection.test.ts` (round-trip tests
  at named cities and reference latitudes, including a test that an
  equirectangular mapping would fail the same round-trip) and, more
  importantly, a real-browser check: a solid-colour land/ocean debug
  overlay rendered through the exact same MapLibre `image` source path was
  confirmed to trace the actual basemap coastline for Iberia/NW Africa,
  UK/Ireland/Norway/Sweden, Japan, and Australia before UV colour was
  re-enabled.

## Frontend data flow

1. On load, fetch `manifest.json`, then eagerly fetch every listed hourly
   file (typically ~25 files, a few hundred KB gzipped in total — see
   "Actual data sizes" in the final report). Once loaded, everything else
   is synchronous, in-memory math; there is no per-click network request.
2. "Now" is resolved to the closest available hour in the manifest
   (`resolveNow` in `forecast.ts`); "+1h..+5h" are relative to that index,
   not to the run's start time. `resolveNow` also reports how far that
   resolved frame is from the real current instant (`staleMs`) — if the
   committed data hasn't been refreshed recently enough for "closest
   available" to still mean "now" (more than 90 minutes off), the app
   shows a banner rather than silently presenting a stale frame's
   day/night/UV state as current. This is what caused a real bug: with
   data whose last hour was ~9h in the past, "Now" silently resolved to a
   genuinely-nighttime frame for a location that was actually in daylight
   at the real current time — the day/night calculation itself
   (`src/lib/daynight.ts`, real solar altitude via SunCalc from lat/lon/UTC
   instant, never local/browser time) was always correct *for the
   timestamp it was given*; the bug was that the timestamp it was given
   wasn't actually "now". See `src/lib/daynight.test.ts` for the
   regression tests (multiple cities, same-instant/different-longitude,
   near the date line, and explicit browser-timezone independence).
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

## Forecast detail: hourly chart, 5-day forecast, cloud impact

Three additions on top of the same location series described above — no new
data source, no new backend.

**One derived representation.** `src/lib/locationForecast.ts` builds a
single `LocationForecast` (`{ today, days }`) from one location's
`PointSample[]` series. `today` and every entry in `days` are
`DayForecast`s built via `getDailyUvSummary`/`getProtectionAdvice` — the
*exact same functions* the primary result card has always used. The primary
card, the hourly chart, the 5-day strip, and the cloud-impact card in
`LocationPanel.tsx` all read from this one object (via `App.tsx`'s
`locationData`), so they cannot independently disagree about "today's peak".

**Local-day grouping** (`groupByLocalDate` in `forecast.ts`) buckets a
chronological series by each sample's own `localDateKey` (the existing
longitude/15 approximation — see Limitations) rather than grouping by UTC
date and relabelling. `filterToday` is now implemented on top of
`groupByLocalDate` for the same reason: one grouping implementation, not
two that could drift apart. See `forecast.test.ts` and
`locationForecast.test.ts` for regression coverage across London, New York,
Tokyo, Sydney, and Auckland (date-line-adjacent).

**5-day forecast horizon.** `buildLocationForecast` walks local-day groups
forward from "today" and stops at 5, but a day only appears in `days` if it
has real coverage (`hasMeaningfulDaylightCoverage` in `locationForecast.ts`):
`today` is always included (the primary card already answers for it
regardless of how many hours are loaded), but any later day needs at least
`MIN_SAMPLES_FOR_FUTURE_DAY` (6) hourly samples *and* a nonzero peak —
otherwise the CAMS horizon's trailing edge (sometimes a handful of
post-midnight, all-night hours) would render as a bogus "tomorrow: UV 0.0,
peak 00:00" card. This logic was verified end-to-end against the exact
tiered-leadtime shape the pipeline now produces (see
`locationForecast.test.ts`'s "end-to-end with the real tiered CAMS leadtime
shape" suite): a run starting on its own local day yields 5 real days for
London (and every other tested city); a run whose "today" has already
rolled over to the day after the run's own UTC day yields 4 (the 5th day's
tail doesn't clear the coverage bar) — both are correct, expected outcomes
of the rule, not bugs.

*Root cause of the "only Today" symptom (found investigating this issue):*
this was **not** a grouping/parsing/rendering bug. `.github/workflows/
refresh-cams-data.yml`'s scheduled trigger had simply never fired since the
tiered-download code shipped — confirmed via the GitHub Actions API
(`GET /repos/.../actions/workflows/refresh-cams-data.yml/runs` returned
`total_count: 0`, while `deploy.yml` had run and succeeded on every push).
The committed `public/data/*` was still the old single-run, ~37h dataset
from before that change, which — correctly, per the rule above — only ever
produces 1-2 local days. No code fix was needed for this part; the tiered
download logic added previously was already correct, just never executed.
GitHub scheduled workflows are documented to be delayed (sometimes
significantly) around the top of the hour under platform load, which is
exactly when a `cron: "0 */6 * * *"` schedule fires — worth keeping in mind
if a future refresh looks similarly "stuck".

**Hourly chart** (`HourlyUvChart.tsx`) is a hand-rolled responsive SVG —
this project had no charting library, and one bell-curve-shaped line for a
few dozen points didn't justify adding one. `trimToDaylightWindow` in
`locationForecast.ts` trims the day's samples to the first/last hour with
UV > 0 (±1h padding) so the chart doesn't waste width on the flat overnight
stretch; it never claims a separate sunrise/sunset — CAMS's own near-zero
night values are the trim signal. The chart never recomputes peak/window
itself; it's passed the same `DailyUvSummary` the primary card renders.
Unchanged since it was already working well.

**5-day strip layout.** `DailyForecastStrip.tsx` renders each day as a
`.daily-card` with `flex: 1 1 58px; max-width: 120px` inside a
`justify-content: flex-start` row — deliberately not CSS Grid's
`repeat(N, 1fr)`, which would still stretch a single available day into one
"giant" card filling the whole row (`1fr` always divides 100% of the
container between however many columns exist, regardless of N). Capped
flex-grow instead lets cards share the row when there's room without ever
growing past `max-width`, so 1-2 real days render as compact, left-aligned
cards with empty trailing space, and 5 real days on a typical phone width
settle close to their natural ~60-70px each. Also removed the old repeated
"Protection recommended" line under every card in favour of a single small
dot (`.daily-card-protection-dot`) next to the UV number on days that cross
the threshold — the category swatch colour already carries most of the
signal.

**Cloud impact** (`getCloudImpact` in `uv.ts`) was redesigned from a
percentage-tier ladder into an action-oriented, mostly-hidden decision:
consumers don't primarily care that "cloud is reducing UV by 45%" — they
care whether their sun-protection decision could change if the sky clears.
`CloudImpactKind` is `"none" | "adviceChange" | "limiting"`:

| Case | Condition | Message |
|---|---|---|
| `adviceChange` (shown prominently — the highest-value case) | `forecastUv < PROTECTION_THRESHOLD && clearUv >= PROTECTION_THRESHOLD` — **any** crossing, no minimum-gap floor | "If the clouds clear — UV could rise from X to Y — Sun protection may be needed if skies clear." |
| `limiting` | `forecastUv >= PROTECTION_THRESHOLD && diff >= CLOUD_IMPACT_MATERIAL_ABS_DIFF (1.0)` | "Clouds are limiting UV — Forecast UV is X, but could reach around Y if skies clear." |
| `none` | neither of the above, or `!isDay`, or `clearUv < CLOUD_IMPACT_MIN_CLEAR_UV (0.5)` | section renders nothing |

`isDay` is threaded in from the same real solar-altitude day/night check the
primary card already uses (`daynight.ts`) rather than inferred from the UV
values alone. `diff` is clamped to `>= 0` (independent rounding between the
two fields can occasionally put `forecastUv` fractionally above `clearUv`).
Percentage is still computed and returned (`percent`) for tests/debugging,
but the UI never leads with it — see `CloudImpact.tsx`. Wording deliberately
avoids "will rise" (→ "could rise .. if skies clear") and never calls
`uvbed` "actual"/"live" UV (→ "Forecast UV"), since CAMS is model guidance,
not a sensor reading. See `uv.test.ts` for the full case matrix, including
the exact spec examples (2.3→4.2 advice-change; 4.1→6.3 limiting; 5.7→5.9
and 5.9→6.0 hidden; the 2.9→3.1 threshold-crossing case; and explicit
divide-by-zero/night coverage).

**Extending the CAMS horizon for the 5-day forecast.**
`scripts/cams/download_forecast.py` fetches a *tiered* leadtime: hourly out
to 36h (unchanged — this is what the map and the hourly chart need), then
every 3h out to 120h (CAMS's own max horizon) for the 5-day forecast. This
was a deliberate choice over a flat hourly fetch to 120h: the frontend still
eagerly downloads every listed hourly file (see above), so a flat
120h-hourly fetch would ~3.3x that payload, while this tiering keeps it
under ~1.8x. `process_forecast.py` needed no format changes — it already
derives everything from the GRIB's own `valid_time`s, so it works
identically whether the leadtimes it's given are contiguous or not.
`.github/workflows/refresh-cams-data.yml` runs `pytest
test_download_forecast.py` (pure leadtime-math tests, no network/credentials
needed) before downloading, then passes
`--hours 120 --hourly-until 36 --long-range-step 3`. This is a pipeline
change, not a frontend one — the next scheduled refresh (every 6h, already
configured with its existing secrets) will start producing enough days for
a real 5-day forecast with no frontend redeploy required, which is the
whole point of keeping forecast refreshes and frontend deploys decoupled.
No Cloudflare R2, database, or second API was introduced — forecast data
still flows CAMS → GitHub Actions → `public/data/*` committed to the repo →
GitHub Pages → static frontend, exactly as before.

## Deployment

GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`): on every
push to `main`, install, run tests, `vite build`, publish `dist/` as a
Pages artifact, deploy. No servers, no containers, no secrets required for
this workflow because the forecast data is already committed as static
files under `public/data/`.

A second workflow (`.github/workflows/refresh-cams-data.yml`) re-runs the
download/process pipeline in CI and commits the refreshed `public/data/*`
back to `main` (which then triggers the deploy workflow). It needs two
repository secrets: `CDSAPI_URL` and `CDSAPI_KEY` (see README for how to
obtain and set them). It runs on a `cron` schedule every 6h and can also be
triggered by hand from the Actions tab. Each run's `process_forecast.py`
step prunes `public/data/hourly/*.json` files the fresh manifest no longer
references, so the accumulated hourly files don't grow unbounded across
scheduled refreshes. It is equally acceptable to run the two Python scripts
locally and commit the resulting `public/data/*` files yourself.

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
- **Data refresh cadence**: CAMS data is refreshed on a 6h cron schedule
  (`.github/workflows/refresh-cams-data.yml`, plus manual Action trigger or
  local run); this doesn't guarantee freshness beyond that, since the
  upstream CAMS run itself is only published twice daily and can lag by
  over 12h (see "Forecast horizon fetched" above).
- **Land mask resolution**: Natural Earth 50m polygons at 1440×721 —
  coastlines are visually accurate at normal map zoom (verified for
  Britain/Ireland, Scandinavia, Japan, the Philippines, Indonesia) but not
  survey-precise; very small islands/reefs may be a pixel or two off or
  missing entirely. CAMS UV values are still available for ocean points on
  click — only the map's visual overlay is land-clipped, per the project's
  explicit requirement not to lose ocean data, just its display.

## Per-city SEO pages

`spfyesorno.com/london`, `/tokyo`, etc. (up to 20 cities, `src/data/cities.json`)
are real static HTML files, not client-side routes -- GitHub Pages is a
plain static file server, so the common "SPA on GitHub Pages" 404.html
redirect trick would serve a genuine HTTP 404 to the first request and
nothing at all to crawlers/link-preview bots that don't execute JS, which
defeats the actual goal.

`scripts/seo/generate-city-pages.mjs` runs after `vite build` (see
`package.json`'s `build` script) and, for each city, clones the already-built
`dist/index.html` (correct hashed asset filenames included), swaps its
title/description/canonical/OG tags for that city, injects
`window.__PRESET_CITY__` (read once on mount by `App.tsx` via
`lib/presetCity.ts` to seed `selectedLocation` -- the map opens already
pinned there, no router needed), and injects a visually-hidden (`.sr-only`)
fallback heading/paragraph as a sibling of `#root` for crawlers that never
run JS. `main.tsx` removes that fallback element once the real app mounts,
so a real browser never carries two `<h1>`s. The fallback text and the
text the hydrated app actually shows (`en.cityHeading`/`en.cityIntro`) are
kept identical on purpose -- serving different content to bots than to
users is a real SEO risk (cloaking), even unintentionally. Also generates
`dist/sitemap.xml` (homepage + every city's trailing-slash URL); `robots.txt`
pointing at it lives in `public/` and is copied verbatim like `CNAME`.

**This only works because of two related fixes made alongside it:**
`vite.config.ts`'s `base` changed from `"./"` (relative) to `"/"` (root):
a relative `./assets/...` resolves correctly from `/index.html` but
resolves to the wrong place (`/london/assets/...`) from a page one
directory deep. `loadManifest`/`loadHour`/`loadAllHours` (`forecast.ts`)
and `loadLandMask` (`landMask.ts`) had the same bug with their own
`baseUrl = "./data/"` defaults, now `"/data/"` -- every page, at any depth,
fetches the one shared `public/data/*` copy from its real, single location.
Both were safe to make absolute specifically because the site now has a
fixed custom domain served from root (`public/CNAME`) -- no more GitHub
Pages subpath ambiguity to stay compatible with.

## What would need to change for production

- Self-host (or vendor) the basemap style instead of depending on
  `demotiles.maplibre.org`.
- A real timezone lookup (e.g. a timezone-boundary dataset) instead of the
  longitude/15 approximation, for an accurate local "today"/midnight
  boundary.
- Monitoring/alerting for failed or stale scheduled refresh runs (the cron
  GitHub Action currently just fails silently in the Actions tab).
- Decide on the real spatial/temporal resolution tradeoff (higher-res grid,
  longer horizon) once there's evidence the product is worth the extra
  bandwidth/build-size cost.
- Address history / place search, once validated as wanted (currently out
  of scope, no paid geocoding service integrated).
- Real internationalisation (multiple locale files, a language switcher)
  once `src/locales/en.ts` has proven the string-extraction approach.
- Only then consider affiliate/commercial integration in the
  already-reserved `.protection-shop-slot` hook point.
