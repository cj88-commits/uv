import { describe, it, expect } from "vitest";
import {
  decode,
  gridIndex,
  sampleGrid,
  seriesAtLocation,
  filterToday,
  nearestHourIndex,
  approxUtcOffsetHours,
  type Manifest,
  type HourlyGrid,
  type ManifestGrid,
} from "./forecast";

describe("decode (int16 x10 wire format)", () => {
  it("divides by 10 to recover the UV Index", () => {
    const out = decode([0, 32, -5, 127]);
    const expected = [0, 3.2, -0.5, 12.7];
    Array.from(out).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5));
  });
});

const grid: ManifestGrid = {
  lat_start: 90,
  lat_step: -1,
  nlat: 5, // 90, 89, 88, 87, 86 (toy grid for the test)
  lon_start: -180,
  lon_step: 1,
  nlon: 4, // -180, -179, -178, -177
  native_resolution_deg: 0.4,
  thinned_resolution_deg: 1,
};

describe("gridIndex / sampleGrid", () => {
  it("maps lat/lon to the nearest row/col", () => {
    expect(gridIndex(grid, 90, -180)).toEqual({ row: 0, col: 0 });
    expect(gridIndex(grid, 88, -178)).toEqual({ row: 2, col: 2 });
  });

  it("clamps latitude to the grid bounds", () => {
    expect(gridIndex(grid, 95, -180).row).toBe(0);
    expect(gridIndex(grid, -95, -180).row).toBe(grid.nlat - 1);
  });

  it("wraps longitude around the antimeridian", () => {
    // -180 + 4*1 wraps back to col 0; 180 should behave like -180
    expect(gridIndex(grid, 90, 180)).toEqual({ row: 0, col: 0 });
  });

  it("samples the flat row-major array at the resolved cell", () => {
    // row 1 ("89"), col 3 ("-177") -> flat index 1*4 + 3 = 7
    const data = new Float32Array([0, 1, 2, 3, 4, 5, 6, 42, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(sampleGrid(grid, data, 89, -177)).toBe(42);
  });
});

function makeManifest(times: string[]): Manifest {
  return {
    source: "test",
    run: times[0],
    generated_at: times[0],
    attribution: "test",
    licence: "test",
    uv_index_factor: 40,
    grid,
    hours: times.map((t, i) => ({ time: t, offset_hours: i, file: `hourly/${t}.json` })),
  };
}

function makeFlatHour(time: string, value: number): HourlyGrid {
  const n = grid.nlat * grid.nlon;
  return { time, uv: new Float32Array(n).fill(value), uvClear: new Float32Array(n).fill(value + 1) };
}

describe("seriesAtLocation", () => {
  it("builds a chronological series from loaded hours at one point", () => {
    const times = ["2026-06-01T06:00:00Z", "2026-06-01T07:00:00Z"];
    const manifest = makeManifest(times);
    const hours = new Map(times.map((t, i) => [t, makeFlatHour(t, i + 1)]));
    const series = seriesAtLocation(manifest, hours, 90, -180);
    expect(series).toEqual([
      { time: times[0], uv: 1, uvClear: 2 },
      { time: times[1], uv: 2, uvClear: 3 },
    ]);
  });
});

describe("nearestHourIndex", () => {
  it("picks the closest available hour to now", () => {
    const times = ["2026-06-01T06:00:00Z", "2026-06-01T07:00:00Z", "2026-06-01T08:00:00Z"];
    const manifest = makeManifest(times);
    expect(nearestHourIndex(manifest, "2026-06-01T07:20:00Z")).toBe(1);
    expect(nearestHourIndex(manifest, "2026-06-01T07:45:00Z")).toBe(2);
  });
});

describe("approxUtcOffsetHours", () => {
  it("derives a rough timezone offset from longitude", () => {
    expect(approxUtcOffsetHours(0)).toBe(0);
    expect(approxUtcOffsetHours(15)).toBe(1);
    expect(approxUtcOffsetHours(-90)).toBe(-6);
  });
});

describe("filterToday", () => {
  it("keeps only hours sharing the same approximate local date", () => {
    const series = [
      { time: "2026-06-01T23:00:00Z", uv: 0, uvClear: 0 },
      { time: "2026-06-02T00:00:00Z", uv: 1, uvClear: 1 },
      { time: "2026-06-02T10:00:00Z", uv: 5, uvClear: 5 },
    ];
    // lon=0 -> UTC offset 0, "now" on 2026-06-02 keeps only that date's hours
    const result = filterToday(series, 0, "2026-06-02T09:00:00Z");
    expect(result.map((r) => r.time)).toEqual(["2026-06-02T00:00:00Z", "2026-06-02T10:00:00Z"]);
  });
});
