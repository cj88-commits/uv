"""Convert a downloaded CAMS GRIB (uvbed + uvbedcs) into the static JSON
files the frontend reads: public/data/manifest.json and
public/data/hourly/<hour>.json.

The native CAMS grid (0.4 deg) is thinned (nearest-neighbour, not
interpolated-up) to a 1 deg grid to keep per-hour file sizes small. This is a
resolution *reduction* for file-size reasons; it never adds detail beyond
what CAMS actually provides (see docs/MVP_ARCHITECTURE.md).

Usage:
    python process_forecast.py --grib _raw/forecast.grib --run 2026-08-27T00:00:00Z
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone

import numpy as np
import xarray as xr

from common import uvbed_to_uv_index

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA_DIR = os.path.join(REPO_ROOT, "public", "data")

# Target output grid: 1 deg, north-to-south, -180..179 longitude.
LAT_START, LAT_STEP, NLAT = 90.0, -1.0, 181
LON_START, LON_STEP, NLON = -180.0, 1.0, 360


def load_shortname(grib_path: str, short_name: str) -> xr.DataArray:
    ds = xr.open_dataset(
        grib_path, engine="cfgrib",
        filter_by_keys={"shortName": short_name},
        backend_kwargs={"indexpath": ""},
    )
    return ds[short_name]


def normalize_longitude(da: xr.DataArray) -> xr.DataArray:
    lon = da["longitude"].values
    if lon.max() > 180:
        new_lon = ((lon + 180) % 360) - 180
        da = da.assign_coords(longitude=new_lon).sortby("longitude")
    return da


def thin_to_target_grid(da: xr.DataArray) -> xr.DataArray:
    target_lats = LAT_START + LAT_STEP * np.arange(NLAT)
    target_lons = LON_START + LON_STEP * np.arange(NLON)
    return da.sel(latitude=target_lats, longitude=target_lons, method="nearest")


def prune_stale_hourly_files(hours_meta: list[dict]) -> int:
    """Delete hourly JSON files left over from previous runs that the fresh
    manifest no longer references, so public/data/hourly doesn't grow
    unbounded across scheduled refreshes."""
    hourly_dir = os.path.join(DATA_DIR, "hourly")
    keep = {os.path.basename(h["file"]) for h in hours_meta}
    removed = 0
    for name in os.listdir(hourly_dir):
        if name.endswith(".json") and name not in keep:
            os.remove(os.path.join(hourly_dir, name))
            removed += 1
    return removed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--grib", required=True)
    parser.add_argument("--run", required=True,
                         help="Run time as ISO8601 UTC, e.g. 2026-08-27T00:00:00Z")
    args = parser.parse_args()

    raw_size_mb = os.path.getsize(args.grib) / (1024 * 1024)

    bed = normalize_longitude(load_shortname(args.grib, "uvbed"))
    bedcs = normalize_longitude(load_shortname(args.grib, "uvbedcs"))

    bed = thin_to_target_grid(bed)
    bedcs = thin_to_target_grid(bedcs)

    valid_times = np.atleast_1d(bed["valid_time"].values)
    if bed.ndim == 2:  # single step edge case
        bed = bed.expand_dims("step")
        bedcs = bedcs.expand_dims("step")

    os.makedirs(os.path.join(DATA_DIR, "hourly"), exist_ok=True)

    hours_meta = []
    global_min, global_max = float("inf"), float("-inf")
    processed_bytes = 0

    for i, vt in enumerate(valid_times):
        uv = uvbed_to_uv_index(bed.values[i])
        uv_cs = uvbed_to_uv_index(bedcs.values[i])

        uv_i16 = np.clip(np.round(uv * 10), -32768, 32767).astype(np.int16)
        uv_cs_i16 = np.clip(np.round(uv_cs * 10), -32768, 32767).astype(np.int16)

        global_min = min(global_min, float(uv.min()))
        global_max = max(global_max, float(uv.max()))

        ts = np.datetime_as_string(vt, unit="s") + "Z"
        run_dt = datetime.fromisoformat(args.run.replace("Z", "+00:00"))
        offset_hours = round((datetime.fromisoformat(ts.replace("Z", "+00:00")) - run_dt)
                              .total_seconds() / 3600)

        file_name = f"{ts.replace(':', '')}.json"
        out_path = os.path.join(DATA_DIR, "hourly", file_name)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({
                "time": ts,
                "uv": uv_i16.flatten().tolist(),
                "uv_clear": uv_cs_i16.flatten().tolist(),
            }, f, separators=(",", ":"))
        processed_bytes += os.path.getsize(out_path)

        hours_meta.append({"time": ts, "offset_hours": offset_hours,
                            "file": f"hourly/{file_name}"})

    run_year = datetime.fromisoformat(args.run.replace("Z", "+00:00")).year
    manifest = {
        "source": "CAMS global atmospheric composition forecasts",
        "dataset_id": "cams-global-atmospheric-composition-forecasts",
        "run": args.run,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "attribution": f"Generated using Copernicus Atmosphere Monitoring Service information {run_year}",
        "licence": "CC-BY 4.0 (Licence to use Copernicus Products)",
        "uv_index_factor": 40,
        "value_encoding": "int16, UV Index x 10",
        "grid": {
            "lat_start": LAT_START, "lat_step": LAT_STEP, "nlat": NLAT,
            "lon_start": LON_START, "lon_step": LON_STEP, "nlon": NLON,
            "order": "row-major, latitude outer loop (north to south), longitude inner loop (west to east)",
            "native_resolution_deg": 0.4,
            "thinned_resolution_deg": 1.0,
        },
        "hours": hours_meta,
    }
    manifest_path = os.path.join(DATA_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    removed = prune_stale_hourly_files(hours_meta)

    print("\n--- Diagnostics ---")
    print(f"Timestamps ({len(hours_meta)}): {[h['time'] for h in hours_meta]}")
    print(f"Grid dimensions: {NLAT} lat x {NLON} lon (thinned from native 0.4 deg)")
    print(f"Global UV min/max across all hours: {global_min:.2f} / {global_max:.2f}")
    print(f"Downloaded GRIB size: {raw_size_mb:.2f} MB")
    print(f"Processed JSON size: {processed_bytes / (1024 * 1024):.2f} MB "
          f"across {len(hours_meta)} hourly files + manifest.json")
    print(f"Pruned {removed} stale hourly file(s) no longer in the manifest")
    print(f"Wrote data to {DATA_DIR}")


if __name__ == "__main__":
    main()
