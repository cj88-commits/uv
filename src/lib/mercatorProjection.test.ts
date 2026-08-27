import { describe, it, expect } from "vitest";
import { mercatorPyToLat, mercatorLatToPy, MERCATOR_LAT_LIMIT } from "./mapRender";

// Regression coverage for the actual bug reported: the UV raster's row-to-
// latitude mapping was linear in latitude (equirectangular), but MapLibre
// stretches an `image` source's pixel grid linearly in Web Mercator space
// between its corner coordinates, not linearly in latitude. That mismatch
// is ~0 at the equator and grows with latitude — exactly the "Scandinavia/
// UK coastline doesn't line up, Iberia bleeds into the Atlantic" symptom.
// These tests pin the row<->latitude conversion itself, independent of any
// land-mask or UV data.

const HEIGHT = 721; // matches the real raster's output height

describe("mercatorPyToLat / mercatorLatToPy — fixed reference rows", () => {
  it("top row (py=0) is the Web Mercator latitude limit", () => {
    expect(mercatorPyToLat(0, HEIGHT)).toBeCloseTo(MERCATOR_LAT_LIMIT, 6);
  });

  it("bottom row (py=height-1) is the negative Web Mercator latitude limit", () => {
    expect(mercatorPyToLat(HEIGHT - 1, HEIGHT)).toBeCloseTo(-MERCATOR_LAT_LIMIT, 6);
  });

  it("middle row is the equator", () => {
    expect(mercatorPyToLat((HEIGHT - 1) / 2, HEIGHT)).toBeCloseTo(0, 6);
  });

  it("is NOT linear in latitude (would fail for an equirectangular raster)", () => {
    // For a genuinely Mercator-spaced raster, the row 1/4 of the way down
    // must be well poleward of 1/4 * MERCATOR_LAT_LIMIT — Mercator
    // compresses latitude spacing near the equator relative to the poles,
    // the opposite of what a naive linear-in-latitude raster would give.
    const quarterRowLat = mercatorPyToLat((HEIGHT - 1) / 4, HEIGHT);
    const linearEquivalent = MERCATOR_LAT_LIMIT / 2; // what equirectangular would give
    expect(quarterRowLat).toBeGreaterThan(linearEquivalent);
  });
});

describe("mercatorPyToLat <-> mercatorLatToPy round-trip", () => {
  it.each([
    ["equator", 0, 0],
    ["London", 51.5, -0.1],
    ["Madrid", 40.4, -3.7],
    ["Dakar", 14.7, -17.5],
    ["Cape Town", -33.9, 18.4],
    ["Stockholm", 59.3, 18.1],
    ["Tokyo", 35.7, 139.7],
    ["Sydney", -33.9, 151.2],
    ["60N reference", 60, 0],
    ["80N reference", 80, 0],
    ["60S reference", -60, 0],
  ] as const)("round-trips %s (lat=%d) within a tight tolerance", (_name, lat, _lon) => {
    const py = mercatorLatToPy(lat, HEIGHT);
    const roundTripLat = mercatorPyToLat(py, HEIGHT);
    expect(roundTripLat).toBeCloseTo(lat, 6);
  });

  it("rejects an equirectangular (linear) mapping as a false positive", () => {
    // Sanity check that this test suite would actually have caught the
    // original bug: an equirectangular py->lat function should NOT
    // round-trip correctly through the real (Mercator) inverse for a
    // representative mid/high latitude.
    const linearPyToLat = (py: number, height: number) =>
      MERCATOR_LAT_LIMIT - (py / (height - 1)) * (2 * MERCATOR_LAT_LIMIT);
    const stockholmLat = 59.3;
    const py = mercatorLatToPy(stockholmLat, HEIGHT); // correct Mercator row for Stockholm
    const linearReconstruction = linearPyToLat(py, HEIGHT); // what the OLD buggy code would have placed there
    expect(Math.abs(linearReconstruction - stockholmLat)).toBeGreaterThan(1); // meaningfully wrong
  });
});
