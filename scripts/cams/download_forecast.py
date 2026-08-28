"""Download a global CAMS UV forecast (uvbed + uvbedcs) for the most recent
available run, out to a configurable horizon.

This is the "real" MVP download step, run after poc_download.py has proven
the pipeline works.

Leadtime resolution is tiered, not a flat hourly fetch out to `--hours`:
- 0..HOURLY_UNTIL (default 36h) at every hour -- this is what the map's
  Now/+1h..+5h control and the hourly "UV Today" chart need, and matches
  this project's original 36h-only fetch. 36h (not 24h) is deliberate:
  observed real-world publish latency for this dataset can be well over
  12h, so by the time a run is downloaded and used it may already be ~24h
  past its base time -- a 24h fetch would then leave almost no lookahead.
- HOURLY_UNTIL..`--hours` at LONG_RANGE_STEP_HOURS (default every 3h) -- the
  5-day forecast only needs enough resolution to find each day's
  approximate peak and protection window, not full hourly precision that
  far out (the frontend already treats every derived time as approximate).
  This keeps the *number* of hourly files -- and so the static frontend's
  total payload, all of which is still eagerly fetched per
  docs/MVP_ARCHITECTURE.md -- from scaling linearly with the horizon: full
  120h hourly would be ~3.3x today's per-hour file count; this tiering
  keeps it under ~1.8x while still covering up to 5 days.

Usage:
    python download_forecast.py [--hours 120] [--hourly-until 36] [--long-range-step 3] [--out _raw/forecast.grib]
"""
from __future__ import annotations

import argparse
import os
import time
from datetime import datetime, timedelta, timezone

from common import DATASET, make_client

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(HERE, "_raw")

# CAMS's own published forecast horizon (see docs/CAMS_UV.md) -- requesting
# beyond this is simply not available.
CAMS_MAX_HORIZON_HOURS = 120


def pick_run_time(lag_hours: int) -> tuple[str, str]:
    now = datetime.now(timezone.utc) - timedelta(hours=lag_hours)
    run_hour = 12 if now.hour >= 12 else 0
    run_date = now.date()
    return run_date.isoformat(), f"{run_hour:02d}:00"


def build_leadtime_hours(hours: int, hourly_until: int, long_range_step: int) -> list[int]:
    """Every hour up to `hourly_until`, then every `long_range_step` hours out
    to `hours` -- see the module docstring for why."""
    hourly_until = min(hourly_until, hours)
    leadtimes = list(range(0, hourly_until + 1))
    next_h = hourly_until + long_range_step
    while next_h <= hours:
        leadtimes.append(next_h)
        next_h += long_range_step
    return leadtimes


def download(date_str: str, time_str: str, hours: int, hourly_until: int, long_range_step: int, out_path: str) -> str:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    client = make_client()
    leadtime_hours = build_leadtime_hours(hours, hourly_until, long_range_step)
    leadtimes = [str(h) for h in leadtime_hours]
    print(f"Requesting CAMS run {date_str} {time_str} UTC, global area, "
          f"leadtime_hour={leadtimes[0]}..{leadtimes[-1]} "
          f"({len(leadtimes)} steps: hourly to {hourly_until}h, every {long_range_step}h beyond) ...")
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


def download_with_fallback(
    hours: int, hourly_until: int, long_range_step: int, out_path: str, max_tries: int = 3
) -> tuple[str, str, str]:
    lag = 9
    last_err = None
    for attempt in range(max_tries):
        date_str, time_str = pick_run_time(lag_hours=lag + attempt * 12)
        try:
            path = download(date_str, time_str, hours, hourly_until, long_range_step, out_path)
            return path, date_str, time_str
        except Exception as exc:  # noqa: BLE001
            print(f"Run {date_str} {time_str} UTC not available yet ({exc}); "
                  f"trying an earlier run.")
            last_err = exc
    raise RuntimeError(f"Could not download any recent CAMS run: {last_err}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=int, default=CAMS_MAX_HORIZON_HOURS,
                         help=f"Leadtime hours to fetch, 0..N (default {CAMS_MAX_HORIZON_HOURS}, "
                              "CAMS's own max horizon)")
    parser.add_argument("--hourly-until", type=int, default=36,
                         help="Fetch every hour up to this leadtime (default 36); coarser beyond it")
    parser.add_argument("--long-range-step", type=int, default=3,
                         help="Hour step beyond --hourly-until (default 3)")
    parser.add_argument("--out", default=os.path.join(RAW_DIR, "forecast.grib"))
    args = parser.parse_args()

    start = time.time()
    path, date_str, time_str = download_with_fallback(
        args.hours, args.hourly_until, args.long_range_step, args.out
    )
    size_mb = os.path.getsize(path) / (1024 * 1024)
    print(f"Downloaded {path} ({size_mb:.1f} MB) for run {date_str}T{time_str}Z "
          f"in {time.time() - start:.1f}s")
    # Small manifest fragment used by process_forecast.py so it doesn't have
    # to re-derive which run was actually fetched.
    with open(path + ".run.txt", "w", encoding="utf-8") as f:
        f.write(f"{date_str}T{time_str}Z\n")


if __name__ == "__main__":
    main()
