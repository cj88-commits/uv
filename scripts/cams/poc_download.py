"""Tiny proof-of-concept: download a small CAMS UV forecast slice, convert
uvbed/uvbedcs to UV Index, and print diagnostics.

This intentionally requests a small area and only a few leadtime hours so it
downloads fast and cheaply. Run this BEFORE download_forecast.py (which
fetches a full global run) to confirm credentials, dataset access and the
processing logic all work.

Usage:
    python poc_download.py

Requires ~/.cdsapirc (or CDSAPI_URL / CDSAPI_KEY env vars) to already be
configured — see docs/CAMS_UV.md.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import xarray as xr

from common import DATASET, make_client, uvbed_to_uv_index

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(HERE, "_raw")
OUT_DIR = os.path.join(HERE, "_out")

# Small area around northern Europe: North, West, South, East (ADS order).
POC_AREA = [72, -15, 45, 35]
POC_LEADTIME_HOURS = ["0", "1", "2", "3"]


def pick_run_time(lag_hours: int = 9) -> tuple[str, str]:
    """Pick the most recent CAMS run (00 or 12 UTC) that should already be
    published, allowing `lag_hours` for processing latency."""
    now = datetime.now(timezone.utc) - timedelta(hours=lag_hours)
    run_hour = 12 if now.hour >= 12 else 0
    run_date = now.date()
    return run_date.isoformat(), f"{run_hour:02d}:00"


def download(date_str: str, time_str: str) -> str:
    os.makedirs(RAW_DIR, exist_ok=True)
    target = os.path.join(RAW_DIR, f"poc_{date_str}_{time_str.replace(':', '')}.grib")
    client = make_client()
    print(f"Requesting CAMS run {date_str} {time_str} UTC, area={POC_AREA}, "
          f"leadtime_hour={POC_LEADTIME_HOURS} ...")
    client.retrieve(
        DATASET,
        {
            "variable": [
                "uv_biologically_effective_dose",
                "uv_biologically_effective_dose_clear_sky",
            ],
            "date": date_str,
            "time": time_str,
            "leadtime_hour": POC_LEADTIME_HOURS,
            "type": "forecast",
            "area": POC_AREA,
            "data_format": "grib",
        },
        target,
    )
    return target


def download_with_fallback(max_tries: int = 3) -> tuple[str, str, str]:
    lag = 9
    last_err = None
    for attempt in range(max_tries):
        date_str, time_str = pick_run_time(lag_hours=lag + attempt * 12)
        try:
            path = download(date_str, time_str)
            return path, date_str, time_str
        except Exception as exc:  # noqa: BLE001 - want to try an older run on any failure
            print(f"Run {date_str} {time_str} UTC not available yet ({exc}); "
                  f"trying an earlier run.")
            last_err = exc
    raise RuntimeError(f"Could not download any recent CAMS run: {last_err}")


def process(grib_path: str, date_str: str, time_str: str) -> str:
    os.makedirs(OUT_DIR, exist_ok=True)

    ds_bed = xr.open_dataset(
        grib_path, engine="cfgrib",
        filter_by_keys={"shortName": "uvbed"},
        backend_kwargs={"indexpath": ""},
    )
    ds_bedcs = xr.open_dataset(
        grib_path, engine="cfgrib",
        filter_by_keys={"shortName": "uvbedcs"},
        backend_kwargs={"indexpath": ""},
    )

    uv = uvbed_to_uv_index(ds_bed["uvbed"].values)          # (step, lat, lon)
    uv_cs = uvbed_to_uv_index(ds_bedcs["uvbedcs"].values)   # (step, lat, lon)

    valid_times = np.atleast_1d(ds_bed["valid_time"].values)
    lats = ds_bed["latitude"].values
    lons = ds_bed["longitude"].values

    hours = []
    for i, vt in enumerate(valid_times):
        ts = np.datetime_as_string(vt, unit="s") + "Z"
        hours.append({
            "time": ts,
            "uv_min": round(float(np.nanmin(uv[i])), 3),
            "uv_max": round(float(np.nanmax(uv[i])), 3),
            "uv_clear_min": round(float(np.nanmin(uv_cs[i])), 3),
            "uv_clear_max": round(float(np.nanmax(uv_cs[i])), 3),
        })

    payload = {
        "source": "CAMS global atmospheric composition forecasts",
        "run": f"{date_str}T{time_str}Z",
        "area": {"north": POC_AREA[0], "west": POC_AREA[1],
                 "south": POC_AREA[2], "east": POC_AREA[3]},
        "grid": {"nlat": len(lats), "nlon": len(lons)},
        "uv_index_factor": 40.0,
        "hours": hours,
    }

    out_path = os.path.join(OUT_DIR, "poc_uv.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print("\n--- Diagnostics ---")
    print(f"Timestamps: {[h['time'] for h in hours]}")
    print(f"Grid dimensions: {len(lats)} lat x {len(lons)} lon "
          f"(lat {lats.min():.2f}..{lats.max():.2f}, "
          f"lon {lons.min():.2f}..{lons.max():.2f})")
    for h in hours:
        print(f"  {h['time']}: UV min={h['uv_min']} max={h['uv_max']} "
              f"| clear-sky min={h['uv_clear_min']} max={h['uv_clear_max']}")
    raw_size = os.path.getsize(grib_path)
    out_size = os.path.getsize(out_path)
    print(f"Downloaded GRIB size: {raw_size / 1024:.1f} KB")
    print(f"Processed JSON size: {out_size / 1024:.1f} KB")
    print(f"Wrote {out_path}")
    return out_path


def main() -> None:
    start = time.time()
    grib_path, date_str, time_str = download_with_fallback()
    process(grib_path, date_str, time_str)
    print(f"Done in {time.time() - start:.1f}s")


if __name__ == "__main__":
    sys.exit(main())
