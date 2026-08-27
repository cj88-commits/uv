# SunCheck UV (working name)

A small, deliberately simple MVP that answers one question:

> **Do I need sunscreen right now?**

A global map, real forecast data from Copernicus's CAMS service, click (or
geolocate) a spot, get a plain-language answer plus today's peak UV and the
approximate window where protection is recommended.

This exists to test whether the idea is worth investing in further — not as
production infrastructure. See `docs/MVP_ARCHITECTURE.md` for the full
design and its explicit limitations, and `docs/CAMS_UV.md` for the sourced
CAMS data findings this project was built against.

## Stack

React + TypeScript + Vite, MapLibre GL JS, Vitest, and a Python/`cdsapi`
pipeline that turns a CAMS GRIB download into static JSON the frontend
reads directly. No backend, no database — see "Data architecture" below.

## Quick start (frontend)

```bash
npm install
npm test        # Vitest — UV math, categories, protection window, parsing
npm run dev     # http://localhost:5173
npm run build   # type-check + production build to dist/
```

The frontend reads forecast data from `public/data/manifest.json` and
`public/data/hourly/*.json`. Those files are committed to the repo (they're
small, generated static assets — see `docs/MVP_ARCHITECTURE.md` for sizes)
so `npm run dev` works immediately without needing CAMS credentials.

## Getting real CAMS data (only needed to refresh the data)

1. **Register / log in** at https://ads.atmosphere.copernicus.eu
2. Open your **user profile** and copy your **personal access token**.
3. Create `~/.cdsapirc` (do **not** commit this file — it's already in
   `.gitignore`):
   ```
   url: https://ads.atmosphere.copernicus.eu/api
   key: <your-personal-access-token>
   ```
4. Open the dataset page for
   [`cams-global-atmospheric-composition-forecasts`](https://ads.atmosphere.copernicus.eu/datasets/cams-global-atmospheric-composition-forecasts)
   while logged in and accept its Terms of Use once — the API refuses
   requests until you do this manually.
5. Install the Python deps:
   ```bash
   pip install -r scripts/cams/requirements.txt
   ```
6. **Run the tiny proof-of-concept first** — a small area, 4 leadtime
   hours, prints diagnostics:
   ```bash
   cd scripts/cams
   python poc_download.py
   ```
7. Once that works, fetch the full global 0-24h dataset and turn it into
   the static files the frontend reads:
   ```bash
   python download_forecast.py --hours 24
   RUN=$(cat _raw/forecast.grib.run.txt)
   python process_forecast.py --grib _raw/forecast.grib --run "$RUN"
   ```
   This overwrites `public/data/manifest.json` and `public/data/hourly/*`.
   Commit those files like any other generated asset when you want to
   publish a refresh.

Raw GRIB downloads land in `scripts/cams/_raw/` and processed
diagnostics-only output from the POC in `scripts/cams/_out/` — both are
gitignored; only the final `public/data/*` files are committed.

## Deploying to GitHub Pages (from your own account)

1. Create a new, empty repository under your GitHub account and push this
   project to it:
   ```bash
   git init
   git add -A
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In the repo on GitHub: **Settings → Pages → Build and deployment →
   Source: GitHub Actions**.
3. Push to `main` — `.github/workflows/deploy.yml` builds and deploys
   automatically. Your site will be live at
   `https://<you>.github.io/<repo>/`.
4. Update the placeholder `<link rel="canonical">` in `index.html` to that
   URL once you know it (it's a placeholder until first deploy, per the
   MVP's minimal-SEO scope).

### Refreshing data via GitHub Actions (optional)

`.github/workflows/refresh-cams-data.yml` is a manual (`workflow_dispatch`)
workflow that runs the same two Python scripts in CI and commits the
result back to `main`. To use it, add two **repository secrets**
(Settings → Secrets and variables → Actions):

- `CDSAPI_URL` — `https://ads.atmosphere.copernicus.eu/api`
- `CDSAPI_KEY` — your personal access token

Never commit these values. If you'd rather not set this up yet, just run
the scripts locally (above) and commit `public/data/*` yourself — that is
an equally valid way to "deploy" a refresh for this MVP.

## Attribution & licence

CAMS data is CC-BY 4.0 under the Copernicus "Licence to use Copernicus
Products". The app footer carries the required attribution
("Generated using Copernicus Atmosphere Monitoring Service information
[year]"), generated automatically into `manifest.json` by
`process_forecast.py`.

## Known limitations

See `docs/MVP_ARCHITECTURE.md#limitations-mvp-quality-by-design`. In
short: ~40 km CAMS resolution (thinned further to 1° here), hourly time
steps, an approximate (longitude-based) local-time boundary for "today",
forecast rather than live-sensor data, and deliberately simplified
protection advice (a single UV ≥ 3 threshold, no SPF mapping).
