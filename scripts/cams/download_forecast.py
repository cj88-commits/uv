"""Download a global CAMS UV forecast (uvbed + uvbedcs) for hours 0-24 of the
most recent available run.

This is the "real" MVP download step, run after poc_download.py has proven
the pipeline works. It intentionally limits the horizon to 0-24h: that is
already enough to compute "today's peak / protection window" for any
longitude relative to the run's validity, keeps the download small, and
avoids requesting the full 120h horizon this MVP doesn't need (see
docs/MVP_ARCHITECTURE.md).

Usage:
    python download_forecast.py [--hours 24] [--out _raw/forecast.grib]
"""
from __future__ import annotations

import argparse
import os
import time
from datetime import datetime, timedelta, timezone

from common import DATASET, make_client

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(HERE, "_raw")


def pick_run_time(lag_hours: int) -> tuple[str, str]:
    now = datetime.now(timezone.utc) - timedelta(hours=lag_hours)
    run_hour = 12 if now.hour >= 12 else 0
    run_date = now.date()
    return run_date.isoformat(), f"{run_hour:02d}:00"


def download(date_str: str, time_str: str, hours: int, out_path: str) -> str:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    client = make_client()
    leadtimes = [str(h) for h in range(hours + 1)]
    print(f"Requesting CAMS run {date_str} {time_str} UTC, global area, "
          f"leadtime_hour=0..{hours} ...")
    client.retrieve(
        DATASET,
        {
            "variable": [
                "uv_biologically_effective_dose",
                "uv_biologically_effective_dose_clear_sky",
            ],
            "date": date_str,
            "time": time_str,
            "leadtime_hour": leadtimes,
            "type": "forecast",
            "data_format": "grib",
        },
        out_path,
    )
    return out_path


def download_with_fallback(hours: int, out_path: str, max_tries: int = 3) -> tuple[str, str, str]:
    lag = 9
    last_err = None
    for attempt in range(max_tries):
        date_str, time_str = pick_run_time(lag_hours=lag + attempt * 12)
        try:
            path = download(date_str, time_str, hours, out_path)
            return path, date_str, time_str
        except Exception as exc:  # noqa: BLE001
            print(f"Run {date_str} {time_str} UTC not available yet ({exc}); "
                  f"trying an earlier run.")
            last_err = exc
    raise RuntimeError(f"Could not download any recent CAMS run: {last_err}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=int, default=24,
                         help="Leadtime hours to fetch, 0..N (default 24)")
    parser.add_argument("--out", default=os.path.join(RAW_DIR, "forecast.grib"))
    args = parser.parse_args()

    start = time.time()
    path, date_str, time_str = download_with_fallback(args.hours, args.out)
    size_mb = os.path.getsize(path) / (1024 * 1024)
    print(f"Downloaded {path} ({size_mb:.1f} MB) for run {date_str}T{time_str}Z "
          f"in {time.time() - start:.1f}s")
    # Small manifest fragment used by process_forecast.py so it doesn't have
    # to re-derive which run was actually fetched.
    with open(path + ".run.txt", "w", encoding="utf-8") as f:
        f.write(f"{date_str}T{time_str}Z\n")


if __name__ == "__main__":
    main()
