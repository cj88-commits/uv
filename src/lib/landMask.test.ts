import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { decodeLandMaskFromRgba, sampleLandMask, type LandMask } from "./landMask";

describe("decodeLandMaskFromRgba", () => {
  it("thresholds the red channel into a binary land/ocean mask", () => {
    // 2x2 RGBA: land(white), ocean(black), ocean(dark grey), land(light grey)
    const rgba = new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255,
      50, 50, 50, 255, 200, 200, 200, 255,
    ]);
    const mask = decodeLandMaskFromRgba(rgba, 2, 2);
    expect(Array.from(mask.data)).toEqual([1, 0, 0, 1]);
  });
});

describe("sampleLandMask", () => {
  // A tiny synthetic 4x2 mask covering the full globe bounds, for testing
  // the lookup/wraparound math in isolation from real geography.
  const mask: LandMask = {
    width: 4,
    height: 2,
    // row0 (north): land, ocean, ocean, land
    // row1 (south): ocean, ocean, land, ocean
    data: new Uint8Array([1, 0, 0, 1, 0, 0, 1, 0]),
  };

  it("looks up the nearest cell for a given lat/lon", () => {
    expect(sampleLandMask(mask, 85, -180)).toBe(true); // row0,col0 = land
    expect(sampleLandMask(mask, 85, -90)).toBe(false); // row0,col1 = ocean
  });

  it("wraps longitude across the antimeridian", () => {
    // col index for lon=180 should wrap to col 0 (same as lon=-180)
    expect(sampleLandMask(mask, 85, 180)).toBe(sampleLandMask(mask, 85, -180));
  });

  it("clamps latitude rather than throwing for out-of-range values", () => {
    expect(() => sampleLandMask(mask, 89, 0)).not.toThrow();
    expect(() => sampleLandMask(mask, -89, 0)).not.toThrow();
  });
});

describe("sampleLandMask against the real generated land mask", () => {
  const buf = fs.readFileSync(path.join(__dirname, "..", "..", "public", "data", "land-mask.png"));
  const png = PNG.sync.read(buf);
  const realMask = decodeLandMaskFromRgba(png.data, png.width, png.height);

  it("produces a mask that unmistakably looks like a world map (land fraction sanity check)", () => {
    const landFraction = realMask.data.reduce((a, b) => a + b, 0) / realMask.data.length;
    // Real Earth land fraction is ~29%; the 85.05 deg lat clamp (Antarctica
    // partially cut, no Arctic ocean-only band excluded) shifts this a
    // little, but it must be nowhere near "mostly ocean" (~0%) or
    // "mostly land" (~100%), which would indicate a broken mask.
    expect(landFraction).toBeGreaterThan(0.2);
    expect(landFraction).toBeLessThan(0.4);
  });

  it.each([
    ["central Africa", -4.3, 15.3],
    ["central Europe", 48, 15],
    ["central USA", 40, -100],
    ["central Australia", -25, 135],
  ] as const)("classifies %s as land", (_name, lat, lon) => {
    expect(sampleLandMask(realMask, lat, lon)).toBe(true);
  });

  it.each([
    ["central Atlantic", 0, -40],
    ["central Pacific", 0, -160],
    ["central Indian Ocean", -10, 80],
  ] as const)("classifies %s as ocean", (_name, lat, lon) => {
    expect(sampleLandMask(realMask, lat, lon)).toBe(false);
  });
});
