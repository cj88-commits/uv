import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import SunCalc from "suncalc";
import { computeUvFrame, sampleFramePixel, MERCATOR_LAT_LIMIT } from "./mapRender";
import { decodeLandMaskFromRgba, type LandMask } from "./landMask";
import type { ManifestGrid } from "./forecast";

// Loads the real, committed land mask (not a synthetic one) so these tests
// exercise actual coastlines, per the requirement that land/ocean
// verification use real geography, not a toy fixture.
function loadRealLandMaskForTest(): LandMask {
  const buf = fs.readFileSync(path.join(__dirname, "..", "..", "public", "data", "land-mask.png"));
  const png = PNG.sync.read(buf);
  return decodeLandMaskFromRgba(png.data, png.width, png.height);
}

const REAL_LAND_MASK = loadRealLandMaskForTest();

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
// wherever the sun is below the horizon (like real CAMS data).
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

const NOON_UTC = "2026-06-15T12:00:00Z"; // Europe/Africa daylight, W. USA/Pacific night

const LONDON: [number, number] = [51.5, -0.1];
const KINSHASA: [number, number] = [-4.3, 15.3];
const CENTRAL_USA: [number, number] = [40, -100];
const CENTRAL_AUSTRALIA: [number, number] = [-25, 135];
const LOS_ANGELES: [number, number] = [34.0, -118.2]; // ~05:00 PDT, land, night
const CENTRAL_ATLANTIC: [number, number] = [10, -40];
const CENTRAL_PACIFIC: [number, number] = [0, -160];
const CENTRAL_INDIAN_OCEAN: [number, number] = [-10, 80];

describe("computeUvFrame — Mercator pole clamp (regression: whole globe rendered as night)", () => {
  it("never returns raw +/-90 bounds, even though the grid itself spans +/-90", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC, REAL_LAND_MASK);
    expect(frame.bounds.north).toBeLessThan(90);
    expect(frame.bounds.south).toBeGreaterThan(-90);
    expect(frame.bounds.north).toBeLessThanOrEqual(MERCATOR_LAT_LIMIT);
    expect(frame.bounds.south).toBeGreaterThanOrEqual(-MERCATOR_LAT_LIMIT);
  });
});

describe("computeUvFrame — land-only masking (regression: UV colouring the ocean)", () => {
  it("makes ocean fully transparent regardless of day or night", () => {
    const dayFrame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC, REAL_LAND_MASK);
    const midnightUtc = "2026-06-15T00:00:00Z";
    const nightFrame = computeUvFrame(GRID, makeUvGrid(8, midnightUtc), midnightUtc, REAL_LAND_MASK);

    for (const [lat, lon] of [CENTRAL_ATLANTIC, CENTRAL_PACIFIC, CENTRAL_INDIAN_OCEAN]) {
      expect(sampleFramePixel(dayFrame, lat, lon)[3]).toBe(0);
      expect(sampleFramePixel(nightFrame, lat, lon)[3]).toBe(0);
    }
  });

  it("gives daytime land meaningful alpha and UV colour", () => {
    // At 12:00 UTC, London/Kinshasa/central USA are all in daylight.
    // (Central Australia is nighttime at this instant — see the
    // opposite-side-of-Earth test below instead.)
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC, REAL_LAND_MASK);
    for (const [lat, lon] of [LONDON, KINSHASA, CENTRAL_USA]) {
      const [, , , alpha] = sampleFramePixel(frame, lat, lon);
      expect(alpha).toBeGreaterThan(0);
    }
  });

  it("fades nighttime land toward transparent instead of tinting it", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC, REAL_LAND_MASK);
    const [, , , alpha] = sampleFramePixel(frame, ...LOS_ANGELES);
    expect(alpha).toBeLessThan(20);
  });

  it("never produces a global colour band spanning both land and ocean", () => {
    // The historical bug: a giant coloured rectangle covering everything.
    // Verify ocean next to daylight land is still transparent.
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC, REAL_LAND_MASK);
    const atlanticNextToAfrica = sampleFramePixel(frame, 0, -10); // ocean, between Africa and South America
    expect(atlanticNextToAfrica[3]).toBe(0);
    const kinshasa = sampleFramePixel(frame, ...KINSHASA);
    expect(kinshasa[3]).toBeGreaterThan(0);
  });
});

describe("computeUvFrame — final raster alpha at named ocean coordinates", () => {
  it.each([
    ["central Atlantic", 0, -40],
    ["central Pacific", 0, -160],
    ["central Indian Ocean", -10, 80],
  ] as const)("%s has alpha = 0 in the final raster", (_name, lat, lon) => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC, REAL_LAND_MASK);
    expect(sampleFramePixel(frame, lat, lon)[3]).toBe(0);
  });

  it("daytime Africa has alpha > 0", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC, REAL_LAND_MASK);
    expect(sampleFramePixel(frame, ...KINSHASA)[3]).toBeGreaterThan(0);
  });
});

describe("computeUvFrame — day/night on land", () => {
  it("known opposite-side-of-Earth land locations produce different solar states", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC, REAL_LAND_MASK);
    const london = sampleFramePixel(frame, ...LONDON)[3];
    const losAngeles = sampleFramePixel(frame, ...LOS_ANGELES)[3];
    const australia = sampleFramePixel(frame, ...CENTRAL_AUSTRALIA)[3];
    expect(london).toBeGreaterThan(200);
    expect(losAngeles).toBeLessThan(20);
    expect(australia).toBeLessThan(20);
  });

  it("retains distinguishable UV colours on daylight land (not flattened by masking)", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC, REAL_LAND_MASK);
    const london = sampleFramePixel(frame, ...LONDON);
    const kinshasa = sampleFramePixel(frame, ...KINSHASA);
    expect(london).not.toEqual(kinshasa);
  });
});

describe("computeUvFrame — inconsistency fail-safe", () => {
  it("flags a land location with meaningful UV that the solar calculation misclassifies as deep night", () => {
    const allHighUv = new Float32Array(GRID.nlat * GRID.nlon).fill(9);
    const frame = computeUvFrame(GRID, allHighUv, NOON_UTC, REAL_LAND_MASK);
    expect(frame.hadNightInconsistency).toBe(true);
  });

  it("does not flag a physically consistent field (UV ~0 at night)", () => {
    const frame = computeUvFrame(GRID, makeUvGrid(8, NOON_UTC), NOON_UTC, REAL_LAND_MASK);
    expect(frame.hadNightInconsistency).toBe(false);
  });
});
