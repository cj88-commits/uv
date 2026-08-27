import { describe, it, expect } from "vitest";
import SunCalc from "suncalc";
import { computeUvFrame, sampleFramePixel, NIGHT_COLOR, MERCATOR_LAT_LIMIT } from "./mapRender";
import type { ManifestGrid } from "./forecast";

// A grid matching the real production shape (1 deg, full globe), so the
// Web Mercator pole-clamping bug (bounds using the raw +/-90 grid extent)
// is exercised exactly as it happens in production, not just in a toy grid.
const GRID: ManifestGrid = {
  lat_start: 90,
  lat_step: -1,
  nlat: 181,
  lon_start: -180,
  lon_step: 1,
  nlon: 360,
  native_resolution_deg: 0.4,
  thinned_resolution_deg: 1,
};

// A representative, physically-consistent UV field: derived from the same
// real solar altitude CAMS itself would reflect, so it is exactly zero
// wherever the sun is below the horizon (like real CAMS data) rather than
// an arbitrary time-of-day curve that could disagree with the true
// terminator and spuriously trip the inconsistency fail-safe under test.
function makeUvGrid(peak: number, timeIso: string): Float32Array {
  const date = new Date(timeIso);
  const out = new Float32Array(GRID.nlat * GRID.nlon);
  for (let row = 0; row < GRID.nlat; row++) {
    const lat = GRID.lat_start + row * GRID.lat_step;
    for (let col = 0; col < GRID.nlon; col++) {
      const lon = GRID.lon_start + col * GRID.lon_step;
      const altitude = SunCalc.getPosition(date, lat, lon).altitude; // radians
      out[row * GRID.nlon + col] = peak * Math.max(0, Math.sin(altitude));
    }
  }
  return out;
}

// 12:00 UTC: solar noon near the Greenwich meridian, so Europe/Africa are
// reliably daylight. UTC-7/UTC+9/UTC+10 zones are reliably pre-dawn/night
// at this instant. Known, stable reference points (verified against real
// SunCalc altitude, not assumed).
const NOON_UTC = "2026-06-15T12:00:00Z";

const LONDON: [number, number] = [51.5, -0.1];
const KINSHASA: [number, number] = [-4.3, 15.3];
const LOS_ANGELES: [number, number] = [34.0, -118.2]; // ~05:00 PDT
const SYDNEY: [number, number] = [-33.9, 151.2]; // ~22:00 AEST

function isNightColor(rgba: [number, number, number, number], tolerance = 20): boolean {
  return (
    Math.abs(rgba[0] - NIGHT_COLOR[0]) <= tolerance &&
    Math.abs(rgba[1] - NIGHT_COLOR[1]) <= tolerance &&
    Math.abs(rgba[2] - NIGHT_COLOR[2]) <= tolerance
  );
}

describe("computeUvFrame — Mercator pole clamp (regression: whole globe rendered as night)", () => {
  it("never returns raw +/-90 bounds, even though the grid itself spans +/-90", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC);
    expect(frame.bounds.north).toBeLessThan(90);
    expect(frame.bounds.south).toBeGreaterThan(-90);
    expect(frame.bounds.north).toBeLessThanOrEqual(MERCATOR_LAT_LIMIT);
    expect(frame.bounds.south).toBeGreaterThanOrEqual(-MERCATOR_LAT_LIMIT);
  });
});

describe("computeUvFrame — day/night split", () => {
  it("has some daylight pixels and some night pixels for a representative timestamp", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC);
    let dayCount = 0;
    let nightCount = 0;
    for (let i = 0; i < frame.rgba.length; i += 4) {
      const px: [number, number, number, number] = [frame.rgba[i], frame.rgba[i + 1], frame.rgba[i + 2], frame.rgba[i + 3]];
      if (isNightColor(px)) nightCount++;
      else dayCount++;
    }
    expect(dayCount).toBeGreaterThan(0);
    expect(nightCount).toBeGreaterThan(0);
  });

  it("does not classify the entire raster as night when meaningful UV exists", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC);
    expect(frame.hadNightInconsistency).toBe(false);

    let nonNightCount = 0;
    for (let i = 0; i < frame.rgba.length; i += 4) {
      const px: [number, number, number, number] = [frame.rgba[i], frame.rgba[i + 1], frame.rgba[i + 2], frame.rgba[i + 3]];
      if (!isNightColor(px)) nonNightCount++;
    }
    // Roughly half the globe should be lit at any instant.
    expect(nonNightCount).toBeGreaterThan(frame.rgba.length / 4 / 4);
  });

  it("known locations on opposite sides of Earth produce different solar states", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC);
    const london = sampleFramePixel(frame, ...LONDON);
    const kinshasa = sampleFramePixel(frame, ...KINSHASA);
    const losAngeles = sampleFramePixel(frame, ...LOS_ANGELES);
    const sydney = sampleFramePixel(frame, ...SYDNEY);

    expect(isNightColor(london)).toBe(false);
    expect(isNightColor(kinshasa)).toBe(false);
    expect(isNightColor(losAngeles)).toBe(true);
    expect(isNightColor(sydney)).toBe(true);
  });

  it("retains distinguishable UV colours (not just night/not-night) on the daylight side", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC);
    const london = sampleFramePixel(frame, ...LONDON); // mid latitude, moderate-ish UV
    const kinshasa = sampleFramePixel(frame, ...KINSHASA); // near-equatorial, high UV
    // Different UV levels in daylight should not collapse to the same colour.
    expect(london).not.toEqual(kinshasa);
  });
});

describe("computeUvFrame — inconsistency fail-safe", () => {
  it("flags a location with meaningful UV that the solar calculation misclassifies as deep night", () => {
    // Pathological input: a UV field that is high everywhere, including
    // where it is genuinely night. This should never happen with real
    // CAMS data (CAMS itself reports near-zero UV at night), but the
    // fail-safe must still catch the inconsistency if it ever does.
    const allHighUv = new Float32Array(GRID.nlat * GRID.nlon).fill(9);
    const frame = computeUvFrame(GRID, allHighUv, NOON_UTC);
    expect(frame.hadNightInconsistency).toBe(true);
  });

  it("does not flag a physically consistent field (UV ~0 at night)", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC);
    expect(frame.hadNightInconsistency).toBe(false);
  });
});
