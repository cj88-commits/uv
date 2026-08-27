# CAMS UV data — verified findings

This document records what was verified about the Copernicus Atmosphere Monitoring
Service (CAMS) global UV data before any code was written against it, per the
project's "do not guess" requirement. All facts below are sourced from official
Copernicus / ECMWF documentation (linked at the end).

## Dataset

- **Name:** CAMS global atmospheric composition forecasts
- **Dataset ID (ADS API name):** `cams-global-atmospheric-composition-forecasts`
- **Access point:** Atmosphere Data Store (ADS) — https://ads.atmosphere.copernicus.eu/datasets/cams-global-atmospheric-composition-forecasts
- **Temporal coverage:** 2015-09-03 to present, continuously updated
- **DOI:** 10.24381/04a0b097

## UV variables

The dataset provides two UV fields relevant to this project (there is also a
"downward UV radiation at the surface" energy field, which we do not use):

| Field | ADS API `variable` string | GRIB shortName | GRIB paramId | Meaning |
|---|---|---|---|---|
| Total-sky UV dose rate | `uv_biologically_effective_dose` | `uvbed` | 214002 | Erythemally-weighted (sunburn-weighted) UV irradiance actually expected, including cloud/aerosol/ozone effects |
| Clear-sky UV dose rate | `uv_biologically_effective_dose_clear_sky` | `uvbedcs` | 214003 | Same quantity computed as if the sky were cloud-free — the UV "ceiling" for the day |

**Units:** both fields are the erythemal dose **rate**, in W m⁻² (instantaneous,
single-level fields, available hourly). They are not itself "the UV Index" —
they are the physical quantity the UV Index is derived from.

**How the fields are computed (per ECMWF/CAMS methodology):** the CAMS model
computes surface downwelling spectral solar irradiance at 5 nm resolution across
280–400 nm, then convolves it with the McKinlay–Diffey erythemal action
spectrum, accounting for the model's cloud, aerosol and ozone fields. The
result is the biologically effective dose rate.

## UV Index conversion — verified

```
UV Index = uvbed × 40
```

Equivalently, the dose rate is divided by the reference value 0.025 W m⁻²
(one UV Index unit ≡ 25 mW m⁻² of erythemally-weighted irradiance). This is
the official CAMS convention and is what CAMS's own public UV Index maps use.
The same formula applies to the clear-sky field: `clear-sky UV Index = uvbedcs × 40`.

This matches exactly what was assumed in the project brief — it did not need
to be revised.

## Forecast characteristics

- **Run frequency:** new forecast twice daily, base times **00:00 UTC** and **12:00 UTC**
- **Forecast horizon:** 5 days (120 hours) ahead of the base time
- **Time resolution:** single-level fields (which includes `uvbed`/`uvbedcs`) are
  available **hourly** across the forecast horizon
- **Spatial resolution:** global regular grid, **0.4° × 0.4°**
- **File format:** GRIB natively; optional conversion to NetCDF via the API request
- **Vertical levels:** not relevant — UV dose rate is a single-level (surface) field

## API / client

- **Client library:** `cdsapi` (Python), version **>= 0.7.7**, `pip install "cdsapi>=0.7.7"`
- **Endpoint:** the ADS runs on ECMWF's current unified CDS/ADS infrastructure.
  The API URL is `https://ads.atmosphere.copernicus.eu/api`.
- **Config file** (`~/.cdsapirc`):
  ```
  url: https://ads.atmosphere.copernicus.eu/api
  key: <YOUR-PERSONAL-ACCESS-TOKEN>
  ```
- **Environment variable alternative** (used for CI/GitHub Actions in this
  project): `cdsapi.Client()` also accepts credentials directly, or reads
  `CDSAPI_URL` / `CDSAPI_KEY` from the environment. This project's scripts pass
  them explicitly to `cdsapi.Client(url=..., key=...)` to avoid a known
  env-var-only edge case in some cdsapi versions.
- **Authentication setup:** register/log in at https://ads.atmosphere.copernicus.eu,
  open your user profile, and copy the **personal access token** shown there.
  There is no separate UID:key pair in the current system — the token is the key.
- **Mandatory manual step:** you must open the dataset page on ADS and accept
  its Terms of Use / licence **once**, logged in, before the API will serve
  any data for that dataset to your account. This cannot be automated.

## Licence & attribution

- **Licence:** Creative Commons Attribution 4.0 International (CC-BY 4.0), under
  the Copernicus "Licence to use Copernicus Products"
- **Attribution requirement:** any public use must carry a visible attribution
  notice. Copernicus's recommended wording (used in this project's UI footer):
  > Generated using Copernicus Atmosphere Monitoring Service information [year]
- CC-BY 4.0 additionally requires linking to the licence and indicating if
  changes were made — this project notes that data is spatially thinned and
  converted from dose rate to UV Index, which is disclosed in-app and in
  `docs/MVP_ARCHITECTURE.md`.

## Implications for this project's design

- We only need `uvbed` and `uvbedcs` — no other CAMS species.
- Hourly resolution means the app must never claim sub-hourly precision
  (e.g. "UV reaches 3 at 10:00" is an hourly-grid estimate, not a minute-exact one).
- 0.4° (~40 km at the equator) spatial resolution means the map is regional
  guidance, not street-level — this is stated explicitly in the UI and docs.
- Because forecasts run at 00/12 UTC with a 120 h horizon, a single downloaded
  run comfortably covers "today" for any longitude if enough leadtime hours
  (this project fetches 0–24h) are pulled relative to a run whose validity
  window overlaps the request time.
- Night must be derived independently of `uvbed` (CAMS reports it near zero at
  night, but relying on that alone conflates "low daytime UV" with "no sun
  above the horizon"), so day/night in this project is computed client-side
  from real solar geometry (see `docs/MVP_ARCHITECTURE.md`).

## Sources

- [CAMS global atmospheric composition forecasts — ADS dataset page](https://ads.atmosphere.copernicus.eu/datasets/cams-global-atmospheric-composition-forecasts?tab=overview)
- [CAMS: Global atmospheric composition forecast data documentation — ECMWF Confluence](https://confluence.ecmwf.int/display/CKB/CAMS%3A+Global+atmospheric+composition+forecast+data+documentation)
- [The Copernicus Atmosphere Monitoring Service UV Index — background & methodology (EEA Climate-ADAPT)](https://climate-adapt.eea.europa.eu/en/observatory/evidence/projections-and-tools/cams-uv-index-forecast/uv_index_cams_background_and_methodology.pdf)
- [CDSAPI setup — Atmosphere Data Store](https://ads.atmosphere.copernicus.eu/how-to-api)
- [ecmwf/cdsapi on GitHub](https://github.com/ecmwf/cdsapi)
- [Licence to use Copernicus Products (rev. 12)](https://cds.climate.copernicus.eu/licences/licence-to-use-copernicus-products)
- [Creative Commons Attribution 4.0 International Public Licence (rev. 1) — as adopted by Copernicus](https://cds.climate.copernicus.eu/licences/creative-commons-attribution-4-0-international-public-licence)
