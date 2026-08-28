// All user-facing strings live here so a future translation only needs a
// sibling file (e.g. src/locales/sv.ts), not component surgery.

export const en = {
  appName: "SunCheck UV",
  tagline: "Do I need sunscreen right now?",

  categoryLabel: {
    low: "Low",
    moderate: "Moderate",
    high: "High",
    "very-high": "Very High",
    extreme: "Extreme",
  } as Record<string, string>,

  protectionYes: "Sun protection recommended",
  protectionNo: "Low UV",
  protectionNoBody: "Sun protection is generally not required right now.",
  protectionUntil: (time: string) => `Protection recommended until ${time}`,
  protectionWindow: (start: string, end: string) => `Protection recommended ${start}–${end}`,
  willReachThreshold: (threshold: number, time: string) => `UV is forecast to reach ${threshold} at around ${time}.`,

  currentUv: "UV",
  clearSkyPotential: "Clear-sky potential",
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
  nightBody: "The sun is below the horizon here right now.",

  legendTitle: "UV Index",
  legendNight: "Night",

  attributionPrefix: "Data:",
  limitationsNote:
    "Forecast guidance from CAMS satellite/model data (~40 km resolution), not a live sensor reading. Local cloud cover can change actual UV quickly.",

  introText:
    "SunCheck UV shows a global ultraviolet forecast from the Copernicus Atmosphere " +
    "Monitoring Service (CAMS). Pick a spot on the map or share your location to see " +
    "today's UV Index, whether sun protection is recommended right now, and the " +
    "approximate time of today's peak UV.",

  protectionSectionTitle: "Recommended sun protection",

  sheetExpand: "Expand forecast details",
  sheetCollapse: "Collapse forecast details",
  sheetDragHandleLabel: "Drag to resize",
  sheetSwipeUp: "Swipe up for details",
  sheetShowMap: "Show map",
};

export type Locale = typeof en;
