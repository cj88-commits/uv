import { describe, it, expect } from "vitest";
import {
  decode,
  gridIndex,
  sampleGrid,
  seriesAtLocation,
  filterToday,
  nearestHourIndex,
  resolveNow,
  approxUtcOffsetHours,
  localDateKey,
  groupByLocalDate,
  type Manifest,
  type HourlyGrid,
  type ManifestGrid,
  type PointSample,
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

describe("resolveNow (regression: stale data silently presented as \"Now\")", () => {
  it("reports near-zero staleness when the nearest hour is genuinely close to now", () => {
    const times = ["2026-06-01T06:00:00Z", "2026-06-01T07:00:00Z", "2026-06-01T08:00:00Z"];
    const manifest = makeManifest(times);
    const res = resolveNow(manifest, "2026-06-01T07:05:00Z");
    expect(res.index).toBe(1);
    expect(res.time).toBe("2026-06-01T07:00:00Z");
    expect(Math.abs(res.staleMs)).toBeLessThan(10 * 60 * 1000);
  });

  it("reports large positive staleness when the data doesn't reach the real current instant", () => {
    // Mirrors the actual reported bug: committed data's last hour is
    // hours behind the real "now" the app is running at.
    const times = ["2026-08-26T12:00:00Z", "2026-08-28T00:00:00Z"];
    const manifest = makeManifest(times);
    const res = resolveNow(manifest, "2026-08-28T08:43:00Z");
    expect(res.time).toBe("2026-08-28T00:00:00Z");
    expect(res.staleMs).toBeGreaterThan(8 * 3600 * 1000); // > 8h stale
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

// Regression coverage for the "day boundaries must be the SELECTED
// LOCATION's local calendar day, not UTC" requirement — a UTC-grouped-then-
// relabelled implementation would pass London (lon ~0, offset ~UTC) but
// fail every other city here.
describe("localDateKey / groupByLocalDate across timezones", () => {
  // Approximate longitudes; only the derived UTC-offset approximation
  // matters here (see approxUtcOffsetHours), not precise city coordinates.
  const LONDON = 0; // offset 0
  const NEW_YORK = -74; // offset -5
  const TOKYO = 139.7; // offset +9
  const SYDNEY = 151.2; // offset +10
  const AUCKLAND = 174.8; // offset +12 (date-line-adjacent)

  it("London: local date matches UTC date (offset 0)", () => {
    expect(localDateKey("2026-06-01T23:30:00Z", LONDON)).toBe("2026-06-01");
    expect(localDateKey("2026-06-02T00:30:00Z", LONDON)).toBe("2026-06-02");
  });

  it("New York: local date can still be the PREVIOUS day after UTC midnight", () => {
    // 2026-06-02T02:00Z is 2026-06-01T21:00 local at UTC-5 -> still June 1st locally.
    expect(localDateKey("2026-06-02T02:00:00Z", NEW_YORK)).toBe("2026-06-01");
    expect(localDateKey("2026-06-02T05:00:00Z", NEW_YORK)).toBe("2026-06-02");
  });

  it("Tokyo: local date rolls over to the NEXT day well before UTC midnight", () => {
    // 2026-06-01T15:30Z is 2026-06-02T00:30 local at UTC+9 -> already June 2nd locally.
    expect(localDateKey("2026-06-01T15:30:00Z", TOKYO)).toBe("2026-06-02");
    expect(localDateKey("2026-06-01T14:00:00Z", TOKYO)).toBe("2026-06-01");
  });

  it("Sydney: local date rolls over ~10h before UTC midnight", () => {
    expect(localDateKey("2026-06-01T14:30:00Z", SYDNEY)).toBe("2026-06-02");
    expect(localDateKey("2026-06-01T13:00:00Z", SYDNEY)).toBe("2026-06-01");
  });

  it("Auckland: date-line-adjacent, local date is a full day ahead of UTC for most of the UTC day", () => {
    // 2026-06-01T13:00Z is 2026-06-02T01:00 local at UTC+12.
    expect(localDateKey("2026-06-01T13:00:00Z", AUCKLAND)).toBe("2026-06-02");
    expect(localDateKey("2026-06-01T11:00:00Z", AUCKLAND)).toBe("2026-06-01");
  });

  it("groupByLocalDate groups Tokyo frames into local days, not UTC days", () => {
    // A UTC-day-grouped-then-relabelled implementation would put all four
    // of these UTC-01/02 timestamps in (at most) two UTC-keyed buckets;
    // grouping by Tokyo's actual local date splits them differently.
    const series: PointSample[] = [
      { time: "2026-06-01T13:00:00Z", uv: 1, uvClear: 1 }, // local 2026-06-01T22:00
      { time: "2026-06-01T15:30:00Z", uv: 2, uvClear: 2 }, // local 2026-06-02T00:30
      { time: "2026-06-02T02:00:00Z", uv: 3, uvClear: 3 }, // local 2026-06-02T11:00
      { time: "2026-06-02T16:00:00Z", uv: 4, uvClear: 4 }, // local 2026-06-03T01:00
    ];
    const groups = groupByLocalDate(series, TOKYO);
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(groups[0].samples.map((s) => s.uv)).toEqual([1]);
    expect(groups[1].samples.map((s) => s.uv)).toEqual([2, 3]);
    expect(groups[2].samples.map((s) => s.uv)).toEqual([4]);
  });

  it("groupByLocalDate returns groups in chronological order for a chronological input", () => {
    const series: PointSample[] = [
      { time: "2026-06-01T20:00:00Z", uv: 1, uvClear: 1 },
      { time: "2026-06-02T20:00:00Z", uv: 2, uvClear: 2 },
      { time: "2026-06-03T20:00:00Z", uv: 3, uvClear: 3 },
    ];
    const groups = groupByLocalDate(series, AUCKLAND);
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-06-02", "2026-06-03", "2026-06-04"]);
  });
});
