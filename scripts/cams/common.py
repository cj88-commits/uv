"""Shared helpers for CAMS UV download/processing scripts."""
from __future__ import annotations

import os
import cdsapi

DATASET = "cams-global-atmospheric-composition-forecasts"

# UV Index = biologically effective dose rate (W m-2) x 40.
# Verified in docs/CAMS_UV.md against official CAMS/ECMWF documentation.
UV_INDEX_FACTOR = 40.0


def make_client() -> cdsapi.Client:
    """Build a cdsapi client, preferring explicit env vars (for CI) and
    falling back to the user's ~/.cdsapirc file (for local use)."""
    url = os.environ.get("CDSAPI_URL")
    key = os.environ.get("CDSAPI_KEY")
    if url and key:
        return cdsapi.Client(url=url, key=key)
    return cdsapi.Client()


def uvbed_to_uv_index(value_w_m2):
    """Convert a CAMS biologically effective UV dose rate (W m-2) to UV Index."""
    return value_w_m2 * UV_INDEX_FACTOR
