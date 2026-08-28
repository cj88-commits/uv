import { useEffect, useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { TimeControl } from "./components/TimeControl";
import { LocationPanel } from "./components/LocationPanel";
import { Legend } from "./components/Legend";
import { BottomSheet, type SheetState } from "./components/BottomSheet";
import { en } from "./locales/en";
import {
  loadManifest,
  loadAllHours,
  resolveNow,
  seriesAtLocation,
  type Manifest,
  type HourlyGrid,
} from "./lib/forecast";
import { getDailyUvSummary } from "./lib/uv";
import { buildLocationForecast } from "./lib/locationForecast";
import { isDaylight } from "./lib/daynight";
import { loadLandMask, type LandMask } from "./lib/landMask";

const TIME_OFFSETS = [0, 1, 2, 3, 4, 5];

// If the closest available forecast hour is farther than this from the
// real current instant, the committed data is too stale to represent
// "Now" honestly (hourly data means a healthy refresh should always land
// well under this). See docs/MVP_ARCHITECTURE.md.
const STALE_THRESHOLD_MS = 90 * 60 * 1000;

interface LatLon {
  lat: number;
  lon: number;
}

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [hours, setHours] = useState<Map<string, HourlyGrid> | null>(null);
  const [landMask, setLandMask] = useState<LandMask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());

  const [selectedOffset, setSelectedOffset] = useState(0);
  const [selectedLocation, setSelectedLocation] = useState<LatLon | null>(null);
  const [userLocation, setUserLocation] = useState<LatLon | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "error">("idle");
  // Mobile bottom sheet -- irrelevant on desktop, which keeps the static
  // side panel regardless of this value (see BottomSheet.tsx / the 860px
  // breakpoint in index.css). Starts half-open so a first-time mobile
  // visitor sees the answer panel without having to discover it exists.
  const [sheetState, setSheetState] = useState<SheetState>("half");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, mask] = await Promise.all([loadManifest(), loadLandMask()]);
        if (cancelled) return;
        setManifest(m);
        setLandMask(mask);
        const h = await loadAllHours(m);
        if (cancelled) return;
        setHours(h);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep "now" reasonably fresh without polling aggressively.
  useEffect(() => {
    const id = setInterval(() => setNowIso(new Date().toISOString()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const nowResolution = useMemo(() => (manifest ? resolveNow(manifest, nowIso) : null), [manifest, nowIso]);
  const nowIndex = nowResolution?.index ?? 0;
  const isDataStale = (nowResolution?.staleMs ?? 0) > STALE_THRESHOLD_MS;

  const availableOffsets = useMemo(() => {
    if (!manifest) return [];
    return TIME_OFFSETS.filter((o) => nowIndex + o < manifest.hours.length);
  }, [manifest, nowIndex]);

  const selectedHourEntry = manifest?.hours[Math.min(nowIndex + selectedOffset, manifest.hours.length - 1)];
  const selectedHourGrid = selectedHourEntry && hours ? hours.get(selectedHourEntry.time) : undefined;

  function handleSelectLocation(lat: number, lon: number) {
    setSelectedLocation({ lat, lon });
    // A freshly chosen location is exactly what the sheet exists to show --
    // if the user had collapsed it (e.g. to look at the map), bring it back
    // to at least half-open rather than leaving the new result hidden.
    setSheetState((s) => (s === "closed" ? "half" : s));
  }

  function handleUseMyLocation() {
    if (!("geolocation" in navigator)) {
      setGeoStatus("error");
      return;
    }
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setUserLocation(loc);
        setSelectedLocation(loc);
        setSheetState((s) => (s === "closed" ? "half" : s));
        setGeoStatus("idle");
      },
      () => setGeoStatus("error"),
      { enableHighAccuracy: false, timeout: 10_000 }
    );
  }

  const locationData = useMemo(() => {
    if (!manifest || !hours || !selectedLocation || !selectedHourEntry) return null;
    const series = seriesAtLocation(manifest, hours, selectedLocation.lat, selectedLocation.lon);
    // Single derived representation for this location -- today's summary,
    // the hourly chart's series, and the multi-day forecast all come from
    // this one call so they can never disagree (see locationForecast.ts).
    const forecast = buildLocationForecast(series, selectedLocation.lon, selectedHourEntry.time);
    const current = series.find((s) => s.time === selectedHourEntry.time) ?? series[0];
    const day = isDaylight(selectedLocation.lat, selectedLocation.lon, new Date(selectedHourEntry.time));
    return {
      current,
      isDay: day,
      todaySummary: forecast.today?.summary ?? getDailyUvSummary([]),
      todaySamples: forecast.today?.samples ?? [],
      days: forecast.days,
    };
  }, [manifest, hours, selectedLocation, selectedHourEntry]);

  const loading = !manifest || !hours || !landMask;

  const panelContent = (
    <div className="panel-content">
      {!selectedLocation && <p className="click-prompt">{en.clickPrompt}</p>}
      {selectedLocation && locationData && (
        <LocationPanel
          lat={selectedLocation.lat}
          lon={selectedLocation.lon}
          isDay={locationData.isDay}
          uv={locationData.current?.uv ?? 0}
          uvClear={locationData.current?.uvClear ?? 0}
          selectedTime={selectedHourEntry?.time ?? null}
          todaySummary={locationData.todaySummary}
          todaySamples={locationData.todaySamples}
          days={locationData.days}
        />
      )}
      <div className="app-footer-block">
        <p className="intro-text">{en.introText}</p>
        <p className="limitations">{en.limitationsNote}</p>
        {manifest && (
          <p className="attribution">
            {en.attributionPrefix} {manifest.attribution}. {manifest.licence}.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title-block">
          <div className="brand">{en.appName}</div>
          <div className="tagline">{en.tagline}</div>
        </div>
      </header>

      <main className="map-area">
        {error && <div className="banner error">{en.loadError}</div>}
        {loading && !error && <div className="banner">{en.loadingForecast}</div>}
        {!loading && !error && isDataStale && nowResolution && (
          <div className="banner error small">
            {en.staleDataWarning(nowResolution.time.slice(11, 16))}
          </div>
        )}
        {geoStatus === "error" && <div className="banner error small">{en.locationError}</div>}

        <MapView
          grid={manifest?.grid ?? null}
          uv={selectedHourGrid?.uv ?? null}
          timeIso={selectedHourEntry?.time ?? null}
          landMask={landMask}
          onSelectLocation={handleSelectLocation}
          userLocation={userLocation}
          selectedLocation={selectedLocation}
        />

        <div className="control-bar">
          <TimeControl offsets={availableOffsets} selectedOffset={selectedOffset} onSelect={setSelectedOffset} />
          <button className="locate-btn" onClick={handleUseMyLocation} disabled={geoStatus === "locating"}>
            {geoStatus === "locating" ? en.locatingYou : en.useMyLocation}
          </button>
        </div>

        <Legend />
      </main>

      <BottomSheet state={sheetState} onStateChange={setSheetState}>
        {panelContent}
      </BottomSheet>
    </div>
  );
}
