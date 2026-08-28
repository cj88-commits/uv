import { describe, it, expect } from "vitest";
import { isDaylight } from "./daynight";

// All expected values verified directly against SunCalc before being
// written here (see the investigation in the accompanying report) rather
// than assumed. Coordinates are real city locations; timestamps are
// absolute UTC instants — isDaylight must depend only on (lat, lon, UTC
// instant), never on the browser's configured local timezone.

const LONDON: [number, number] = [51.5074, -0.1278];
const NEW_YORK: [number, number] = [40.7128, -74.006];
const SYDNEY: [number, number] = [-33.8688, 151.2093];
const LOS_ANGELES: [number, number] = [34.0522, -118.2437];
const AUCKLAND: [number, number] = [-36.8485, 174.7633]; // UTC+12/+13, near the date line

describe("isDaylight — London (regression: 09:40 BST reported as Night)", () => {
  it("is daylight at 08:40 UTC (09:40 BST) on 2026-08-28", () => {
    expect(isDaylight(...LONDON, new Date("2026-08-28T08:40:00Z"))).toBe(true);
  });

  it("is night at local midnight BST (23:00 UTC the previous day)", () => {
    expect(isDaylight(...LONDON, new Date("2026-08-27T23:00:00Z"))).toBe(false);
  });
});

describe("isDaylight — other cities", () => {
  it("New York: daytime at 16:00 UTC (~noon EDT)", () => {
    expect(isDaylight(...NEW_YORK, new Date("2026-08-28T16:00:00Z"))).toBe(true);
  });

  it("New York: night at 04:00 UTC (~midnight EDT)", () => {
    expect(isDaylight(...NEW_YORK, new Date("2026-08-28T04:00:00Z"))).toBe(false);
  });

  it("Sydney: daytime at 02:00 UTC (~noon AEST)", () => {
    expect(isDaylight(...SYDNEY, new Date("2026-08-28T02:00:00Z"))).toBe(true);
  });

  it("Sydney: night at 14:00 UTC (~midnight AEST)", () => {
    expect(isDaylight(...SYDNEY, new Date("2026-08-28T14:00:00Z"))).toBe(false);
  });
});

describe("isDaylight — same UTC instant, different longitude", () => {
  it("London is day and Los Angeles is night at the identical UTC instant", () => {
    const instant = new Date("2026-08-28T12:00:00Z");
    // Proves daylight isn't derived from browser/system local time: two
    // locations, one Date object, opposite results driven purely by
    // longitude/solar-geometry.
    expect(isDaylight(...LONDON, instant)).toBe(true);
    expect(isDaylight(...LOS_ANGELES, instant)).toBe(false);
  });
});

describe("isDaylight — near the International Date Line", () => {
  it("Auckland (UTC+12/13): daytime at 22:00 UTC (~10:00 NZST next calendar day)", () => {
    expect(isDaylight(...AUCKLAND, new Date("2026-08-28T22:00:00Z"))).toBe(true);
  });

  it("Auckland (UTC+12/13): night at 10:00 UTC (~22:00 NZST)", () => {
    expect(isDaylight(...AUCKLAND, new Date("2026-08-28T10:00:00Z"))).toBe(false);
  });
});

describe("isDaylight — independent of the browser's configured timezone", () => {
  it("returns the same result regardless of process.env.TZ", () => {
    const instant = "2026-08-28T08:40:00Z";
    const originalTz = process.env.TZ;
    const results: boolean[] = [];
    try {
      for (const tz of ["Europe/London", "America/New_York", "Asia/Manila", "Australia/Sydney", "UTC"]) {
        process.env.TZ = tz;
        results.push(isDaylight(...LONDON, new Date(instant)));
      }
    } finally {
      process.env.TZ = originalTz;
    }
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(true);
  });
});
