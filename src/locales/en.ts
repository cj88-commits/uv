// All user-facing strings live here so a future translation only needs a
// sibling file (e.g. src/locales/sv.ts), not component surgery.

export const en = {
  // Brand wordmark, shown uppercase per the brand style -- distinct from
  // the actual UV/protection recommendation text below, which stays
  // scientifically precise (never "SPF YES"/"SPF NO").
  appName: "SPF? YES OR NO",
  // Rendered as the page's <h1> (see App.tsx) -- the search-intent question
  // this whole app answers, not just a decorative subtitle.
  tagline: "Do I need sunscreen today?",
  // Per-city SEO pages (see scripts/seo/generate-city-pages.mjs) swap the
  // homepage tagline/intro above for these instead, so the H1 and intro
  // sentence a real visitor sees exactly match the copy the generator bakes
  // into that page's initial HTML for crawlers -- no cloaking mismatch.
  // Keep these two templates in sync with the ones duplicated in that
  // script if either changes.
  cityHeading: (city: string) => `UV Index in ${city} Today`,
  cityIntro: (city: string) =>
    `Check today's UV index and forecast for ${city} and find out when sun protection is recommended.`,

  categoryLabel: {
    low: "Low",
    moderate: "Moderate",
    high: "High",
    "very-high": "Very High",
    extreme: "Extreme",
  } as Record<string, string>,

  protectionYes: "Sun protection recommended",
  protectionNo: "Low UV",
  /** UV is currently below the threshold but could still cross it later
   * today (before the day's first period, or again after an earlier one
   * already ended) -- "right now" implies today isn't necessarily done. */
  protectionNoBody: "Sun protection is generally not required right now.",
  /** UV never reaches the threshold at all today -- "today" rather than
   * "right now", since there's nothing left to wait for. */
  protectionNoBodyToday: "Sun protection is generally not required today.",
  protectionWindow: (start: string, end: string) => `Protection recommended ${start}–${end}`,
  /** Before today's (first) protection period has started. */
  protectionUpcoming: (time: string) => `Protection is expected to be recommended from around ${time}.`,
  /** After an earlier period today already ended, but a later one is still
   * forecast -- "again" distinguishes this from protectionUpcoming, which
   * would read oddly ("expected to be recommended") for a second period. */
  protectionUpcomingAgain: (time: string) => `Protection may be recommended again from around ${time}.`,

  currentUv: "UV",
  peakToday: "Peak today",
  peakAt: (uv: string, time: string) => `UV ${uv} at ${time}`,

  timeNow: "Now",
  timePlusHour: (n: number) => `+${n}h`,

  useMyLocation: "Use my location",
  locatingYou: "Locating…",
  locationError: "Couldn't get your location. Try clicking the map instead.",
  clickPrompt: "Click anywhere on the map, or use your location, to check the UV there.",

  loadingForecast: "Loading forecast…",
  loadError: "Couldn't load forecast data.",
  staleDataWarning: (utcTime: string) =>
    `Forecast data hasn't been refreshed recently — showing the closest available forecast (${utcTime} UTC), not the live current hour.`,

  night: "Night",
  /** Same local calendar date as the current instant -- see getNightOutlook. */
  nightSunrise: (time: string) => `Sunrise ${time}`,
  /** Next local calendar date. */
  nightSunriseTomorrow: (time: string) => `Sunrise ${time} tomorrow`,
  /** No sunrise found within the search horizon -- polar night. Deliberately
   * doesn't claim anything about how long that lasts, just that today has
   * none. */
  nightNoSunrise: "The sun does not rise today.",
  nightPeakAround: (time: string) => `Peak around ${time}`,
  /** Protection recommended on the upcoming day, but not as one single
   * contiguous window (either genuinely more than one period, or the window
   * wasn't otherwise determinable) -- see getNightOutlook.protectionWindow. */
  nightProtectionExpected: "Sun protection will be recommended for part of the day.",
  /** Protection recommended on the upcoming day as one single window --
   * preferred over the vaguer nightProtectionExpected above whenever it's
   * actually known (same threshold/period logic as the daytime card). */
  nightProtectionExpectedWindow: (start: string, end: string) =>
    `Sun protection is expected to be recommended from around ${start}–${end}.`,
  nightProtectionNotExpected: "Sun protection is generally not expected to be required.",
  tomorrow: "Tomorrow",

  legendTitle: "UV Index",
  legendNight: "Night",

  attributionPrefix: "Data:",
  limitationsNote:
    "Forecast guidance from CAMS satellite/model data (~40 km resolution), not a live sensor reading. Local cloud cover can change actual UV quickly.",

  // Split so the opening sentence can be swapped for cityIntro() on a
  // per-city page while the "how it works" explanation stays the same
  // everywhere -- see App.tsx.
  introSupporting: "Check the UV forecast for your location and see when sun protection is recommended.",
  introHowItWorks:
    "SPF? Yes or No uses forecast data from the Copernicus Atmosphere Monitoring Service " +
    "(CAMS) -- pick a spot on the map or share your location to see today's UV Index, " +
    "whether protection is recommended right now, and the approximate time of today's peak UV.",

  protectionSectionTitle: "Recommended sun protection",

  sheetExpand: "Expand forecast details",
  sheetCollapse: "Collapse forecast details",
  sheetDragHandleLabel: "Drag to resize",
  sheetSwipeUp: "Swipe up for details",
  sheetShowMap: "Show map",

  hourlyForecastTitle: "UV Today",
  /** Shown instead of hourlyForecastTitle when the night card's next
   * sunrise falls tomorrow, alongside that day's curve -- see LocationPanel. */
  hourlyForecastTitleTomorrow: "UV Tomorrow",
  hourlyChartAriaLabel: "Hourly UV forecast chart",
  hourlyChartThresholdLabel: (threshold: number) => `Protection threshold (UV ${threshold})`,

  dailyForecastTitle: "5-Day UV Forecast",
  today: "Today",
  dailyStripPeakAt: (time: string) => `Peak ${time}`,
  /** Accessible name for the small subtle marker shown on a day whose peak
   * reaches the protection threshold -- not rendered as visible text (see
   * DailyForecastStrip.tsx), so it doesn't repeat under every card. */
  dailyStripProtectionIndicatorLabel: "Protection recommended this day",

  cloudImpactAdviceChangeTitle: "If the clouds clear",
  cloudImpactAdviceChangeBody: (from: string, to: string) => `UV could rise from ${from} to ${to}.`,
  cloudImpactAdviceChangeNote: "Sun protection may be needed if skies clear.",

  cloudImpactLimitingTitle: "Clouds are limiting UV",
  cloudImpactLimitingBody: (forecast: string, clear: string) =>
    `Forecast UV is ${forecast}, but could reach around ${clear} if skies clear.`,
};

export type Locale = typeof en;
