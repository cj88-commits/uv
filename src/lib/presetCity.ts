// Reads the per-city SEO page's injected initial location, if this page was
// generated for one (see scripts/seo/generate-city-pages.mjs). The plain
// homepage never sets this global, so getPresetCity() returns null there
// and the app behaves exactly as it did before city pages existed.
export interface PresetCity {
  slug: string;
  name: string;
  lat: number;
  lon: number;
}

declare global {
  interface Window {
    __PRESET_CITY__?: PresetCity;
  }
}

export function getPresetCity(): PresetCity | null {
  return typeof window !== "undefined" && window.__PRESET_CITY__ ? window.__PRESET_CITY__ : null;
}
