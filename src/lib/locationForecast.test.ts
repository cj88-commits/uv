import { describe, it, expect } from "vitest";
import { buildLocationForecast, weekdayShortLabel, trimToDaylightWindow } from "./locationForecast";
import { filterToday, type PointSample } from "./forecast";
import { getDailyUvSummary } from "./uv";

describe("weekdayShortLabel", () => {
  it("resolves a calendar date to its weekday regardless of browser timezone", () => {
    // 2026-06-06 is a Saturday.
    expect(weekdayShortLabel("2026-06-06")).toBe("Sat");
    expect(weekdayShortLabel("2026-06-07")).toBe("Sun");
  });
});

// Builds an hourly series for a UTC date range, one sample per hour, with a
// simple daytime bell-curve-ish UV profile so each day has an unambiguous
// peak, plus a distinct clear-sky value so cloud-impact math has something
// to compare.
function buildHourlySeries(startIso: string, hours: number): PointSample[] {
  const start = new Date(startIso).getTime();
  const series: PointSample[] = [];
  for (let i = 0; i < hours; i++) {
    const t = new Date(start + i * 3600_000);
    const hourOfDay = t.getUTCHours();
    // Peaks near UTC noon; 0 outside a rough "daylight" band. This is
    // synthetic test data, not meant to represent real solar geometry.
    const distanceFromNoon = Math.abs(hourOfDay - 12);
    const uv = Math.max(0, 8 - distanceFromNoon);
    series.push({
      time: t.toISOString().replace(".000Z", "Z"),
      uv,
      uvClear: uv + 1,
    });
  }
  return series;
}

describe("buildLocationForecast: consistency with the existing primary-card calculation", () => {
  const LONDON = 0;
  const series = buildHourlySeries("2026-06-01T00:00:00Z", 72); // 3 UTC days

  it("today's peak matches getDailyUvSummary(filterToday(...)) exactly, for every hour of the loaded range", () => {
    for (const point of series) {
      const referenceIso = point.time;
      const forecast = buildLocationForecast(series, LONDON, referenceIso);
      const legacyToday = filterToday(series, LONDON, referenceIso);
      const legacySummary = getDailyUvSummary(legacyToday);
      expect(forecast.today?.summary).toEqual(legacySummary);
      expect(forecast.today?.samples).toEqual(legacyToday);
    }
  });
});

describe("buildLocationForecast: multi-day grouping across timezones", () => {
  it("London (offset 0): 3 UTC days of hourly data become 3 local days", () => {
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 72);
    const forecast = buildLocationForecast(series, 0, "2026-06-01T12:00:00Z");
    expect(forecast.days.map((d) => d.dateKey)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(forecast.today?.dateKey).toBe("2026-06-01");
  });

  it("Tokyo (offset +9): local days start ~9h before the matching UTC day", () => {
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 72);
    const TOKYO = 139.7;
    // 2026-06-01T20:00Z is 2026-06-02T05:00 local -> "today" is June 2nd.
    const forecast = buildLocationForecast(series, TOKYO, "2026-06-01T20:00:00Z");
    expect(forecast.today?.dateKey).toBe("2026-06-02");
    expect(forecast.days.map((d) => d.dateKey)).toEqual(["2026-06-02", "2026-06-03", "2026-06-04"]);
  });

  it("Sydney (offset +10): peak time is reported in Sydney local time, not UTC", () => {
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 48);
    const SYDNEY = 151.2;
    const forecast = buildLocationForecast(series, SYDNEY, "2026-06-01T00:00:00Z");
    // Synthetic profile peaks at UTC noon = 22:00 local (UTC+10) -- today's
    // local day (starting at UTC00:00, i.e. local 10:00) fully contains it.
    expect(forecast.today?.peakLocalTime).toBe("22:00");
  });

  it("Auckland (offset +12, date-line-adjacent): today resolves to the correct local date", () => {
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 48);
    const AUCKLAND = 174.8;
    // 2026-06-01T13:00Z is 2026-06-02T01:00 local.
    const forecast = buildLocationForecast(series, AUCKLAND, "2026-06-01T13:00:00Z");
    expect(forecast.today?.dateKey).toBe("2026-06-02");
  });

  it("New York (offset -5): today can be the day BEFORE the reference hour's UTC date", () => {
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 48);
    const NEW_YORK = -74;
    // 2026-06-02T02:00Z is 2026-06-01T21:00 local -> still June 1st.
    const forecast = buildLocationForecast(series, NEW_YORK, "2026-06-02T02:00:00Z");
    expect(forecast.today?.dateKey).toBe("2026-06-01");
  });
});

describe("buildLocationForecast: forecast horizon (do not manufacture days without data)", () => {
  it("returns fewer than 5 days when fewer than 5 local days are available", () => {
    // Only 30 hours loaded -- at most 2 local days at any longitude.
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 30);
    const forecast = buildLocationForecast(series, 0, "2026-06-01T00:00:00Z");
    expect(forecast.days.length).toBeLessThan(5);
    expect(forecast.days.length).toBeGreaterThan(0);
  });

  it("returns exactly 5 days when 5+ full local days are available", () => {
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 24 * 6); // 6 days of margin
    const forecast = buildLocationForecast(series, 0, "2026-06-01T00:00:00Z");
    expect(forecast.days.length).toBe(5);
  });

  it("never includes a local day before 'today'", () => {
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 24 * 3);
    const forecast = buildLocationForecast(series, 0, "2026-06-02T00:00:00Z");
    expect(forecast.days.every((d) => d.dateKey >= "2026-06-02")).toBe(true);
  });

  it("handles an empty series without throwing", () => {
    const forecast = buildLocationForecast([], 0, "2026-06-01T00:00:00Z");
    expect(forecast.today).toBeNull();
    expect(forecast.days).toEqual([]);
  });

  it("does not manufacture a future day out of a bare trailing sliver of the horizon", () => {
    // 37 hours from midnight -- today (24 samples) plus just 1 hour spilling
    // into tomorrow (mirrors the real committed dataset's shape: a ~36h
    // fetch starting mid-day rolls a single hour into the next local day).
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 25);
    const forecast = buildLocationForecast(series, 0, "2026-06-01T00:00:00Z");
    expect(forecast.days.map((d) => d.dateKey)).toEqual(["2026-06-01"]);
    expect(forecast.today?.dateKey).toBe("2026-06-01");
  });

  it("still includes a sparse day once it clears the minimum-samples floor", () => {
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 24 + 6); // exactly 6 hours into day 2
    const forecast = buildLocationForecast(series, 0, "2026-06-01T00:00:00Z");
    expect(forecast.days.map((d) => d.dateKey)).toEqual(["2026-06-01", "2026-06-02"]);
  });

  it("always keeps 'today' even if it were sparse, since the primary card already answers for it", () => {
    // referenceIso points at the tail end of a day with only a handful of samples.
    const series = buildHourlySeries("2026-06-01T20:00:00Z", 4);
    const forecast = buildLocationForecast(series, 0, "2026-06-01T20:00:00Z");
    expect(forecast.today?.dateKey).toBe("2026-06-01");
    expect(forecast.days.map((d) => d.dateKey)).toEqual(["2026-06-01"]);
  });
});

describe("buildLocationForecast: per-day category/protection derive from the same uv.ts functions", () => {
  it("flags protection recommended when the day's peak reaches the threshold", () => {
    const series = buildHourlySeries("2026-06-01T00:00:00Z", 24);
    const forecast = buildLocationForecast(series, 0, "2026-06-01T00:00:00Z");
    const today = forecast.today!;
    expect(today.summary.peak?.uv).toBe(8);
    expect(today.category).toBe("very-high"); // uv=8 is the very-high boundary (>= 8, < 11)
    expect(today.protectionRecommended).toBe(true);
  });

  it("does not recommend protection when the day's peak stays below the threshold", () => {
    const lowSeries: PointSample[] = Array.from({ length: 24 }, (_, i) => ({
      time: new Date(Date.UTC(2026, 5, 1, i)).toISOString(),
      uv: 1,
      uvClear: 1.2,
    }));
    const forecast = buildLocationForecast(lowSeries, 0, "2026-06-01T00:00:00Z");
    expect(forecast.today?.protectionRecommended).toBe(false);
    expect(forecast.today?.category).toBe("low");
  });
});

describe("trimToDaylightWindow", () => {
  function point(hour: number, uv: number): PointSample {
    return { time: new Date(Date.UTC(2026, 5, 1, hour)).toISOString(), uv, uvClear: uv };
  }

  it("trims leading/trailing zero-UV hours, padded by 1 hour", () => {
    const samples = [
      point(0, 0),
      point(1, 0),
      point(2, 0),
      point(3, 0.2),
      point(4, 3),
      point(5, 6),
      point(6, 2),
      point(7, 0.1),
      point(8, 0),
      point(9, 0),
    ];
    const trimmed = trimToDaylightWindow(samples);
    // First UV>0 is index 3, padded by 1 -> index 2. Last UV>0 is index 7, padded by 1 -> index 8.
    expect(trimmed.map((s) => s.uv)).toEqual([0, 0.2, 3, 6, 2, 0.1, 0]);
  });

  it("clamps padding at the array bounds instead of throwing", () => {
    const samples = [point(0, 5), point(1, 5)];
    expect(trimToDaylightWindow(samples).length).toBe(2);
  });

  it("returns the full input unchanged when every sample is zero (e.g. polar night)", () => {
    const samples = [point(0, 0), point(1, 0), point(2, 0)];
    expect(trimToDaylightWindow(samples)).toEqual(samples);
  });

  it("handles an empty array", () => {
    expect(trimToDaylightWindow([])).toEqual([]);
  });
});
