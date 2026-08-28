"""Regression tests for the tiered CAMS leadtime request (see
download_forecast.py's module docstring for the rationale: hourly out to
--hourly-until, then coarser out to --hours, to keep the frontend's eager
per-hour payload from scaling linearly with the horizon).

Run with: pytest scripts/cams/test_download_forecast.py
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from download_forecast import CAMS_MAX_HORIZON_HOURS, build_leadtime_hours


def test_hourly_block_is_contiguous_from_zero():
    leadtimes = build_leadtime_hours(120, 36, 3)
    assert leadtimes[:37] == list(range(0, 37))


def test_long_range_block_steps_by_the_configured_interval():
    leadtimes = build_leadtime_hours(120, 36, 3)
    long_range = leadtimes[37:]
    assert long_range[0] == 39  # first step past the hourly block
    assert long_range[-1] == 120
    assert all(b - a == 3 for a, b in zip(long_range, long_range[1:]))


def test_total_frame_count_for_default_config():
    # 37 hourly (0..36) + 28 three-hourly (39..120 step 3) = 65.
    leadtimes = build_leadtime_hours(120, 36, 3)
    assert len(leadtimes) == 65


def test_never_exceeds_cams_own_max_horizon():
    leadtimes = build_leadtime_hours(CAMS_MAX_HORIZON_HOURS, 36, 3)
    assert leadtimes[-1] == CAMS_MAX_HORIZON_HOURS
    assert leadtimes[-1] <= CAMS_MAX_HORIZON_HOURS


def test_degrades_to_a_flat_hourly_list_when_hours_is_below_hourly_until():
    # e.g. a POC-style short fetch -- no long-range block should appear.
    leadtimes = build_leadtime_hours(6, 36, 3)
    assert leadtimes == list(range(0, 7))


def test_earliest_and_latest_valid_timestamps_for_a_known_run():
    """Mirrors what process_forecast.py derives per-frame (run + leadtime
    hours -> valid_time) -- verifies the actual wall-clock span of a
    request, independent of the leadtime-hour integers themselves."""
    run = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)
    leadtimes = build_leadtime_hours(120, 36, 3)
    valid_times = [run + timedelta(hours=h) for h in leadtimes]

    assert valid_times[0] == run
    assert valid_times[-1] == run + timedelta(hours=120)
    assert valid_times[-1] == datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
    assert len(valid_times) == 65
