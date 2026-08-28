import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ManifestGrid } from "../lib/forecast";
import { renderUvFrame, type RenderBounds } from "../lib/mapRender";
import type { LandMask } from "../lib/landMask";

interface LatLon {
  lat: number;
  lon: number;
}

interface Props {
  grid: ManifestGrid | null;
  uv: Float32Array | null;
  timeIso: string | null;
  landMask: LandMask | null;
  onSelectLocation: (lat: number, lon: number) => void;
  userLocation: LatLon | null;
  selectedLocation: LatLon | null;
}

const SOURCE_ID = "uv-field";
const LAYER_ID = "uv-field-layer";
// Insert the UV raster just below this base-style layer so borders/labels
// (added later in the style) stay visible on top of the raster, and above
// the neutral land/ocean fills (added earlier) so the raster reads as the
// map's dominant layer. Re-checked live every time it's used (see
// syncUvLayer) rather than trusted from an earlier snapshot -- MapLibre
// throws if `addLayer`'s `beforeId` doesn't currently exist.
const BEFORE_LAYER_CANDIDATE = "countries-boundary";

type Coordinates = [[number, number], [number, number], [number, number], [number, number]];

export interface UvFrameParams {
  sourceId: string;
  layerId: string;
  dataUrl: string;
  coordinates: Coordinates;
  beforeLayerCandidate?: string;
}

/** The minimal surface of maplibregl.Map that syncUvLayer needs -- narrow
 * and structural so it's mockable in tests without a real Map/WebGL
 * context (see MapView.test.ts). */
export interface UvLayerMap {
  getSource(id: string): { updateImage(opts: { url: string; coordinates: Coordinates }): void } | undefined;
  addSource(id: string, source: { type: "image"; url: string; coordinates: Coordinates }): void;
  getLayer(id: string): unknown;
  addLayer(
    layer: { id: string; type: "raster"; source: string; paint: Record<string, unknown> },
    beforeId?: string
  ): void;
}

/**
 * Brings the map into the correct final state for one UV frame: ensures
 * the source AND layer both exist (checked independently -- one existing
 * never implies the other does) and that the source reflects `params`.
 * Idempotent and side-effect-free when already in the desired state, so
 * it's safe to call from multiple trigger points (map-ready, data-ready,
 * a style event, a frame change) in any order or repeatedly -- see the two
 * call sites in MapView below. This one function is the single source of
 * truth for "is the UV overlay in the state it should be."
 */
export function syncUvLayer(map: UvLayerMap, params: UvFrameParams): void {
  const { sourceId, layerId, dataUrl, coordinates, beforeLayerCandidate } = params;

  const existingSource = map.getSource(sourceId);
  if (!existingSource) {
    map.addSource(sourceId, { type: "image", url: dataUrl, coordinates });
  } else {
    existingSource.updateImage({ url: dataUrl, coordinates });
  }

  if (!map.getLayer(layerId)) {
    const beforeId = beforeLayerCandidate && map.getLayer(beforeLayerCandidate) ? beforeLayerCandidate : undefined;
    map.addLayer({ id: layerId, type: "raster", source: sourceId, paint: { "raster-fade-duration": 0 } }, beforeId);
  }
}

// The free demotiles.maplibre.org style fills every country with one of a
// handful of bright, arbitrary colours (a "political map" look) — fine for
// a generic demo, but it visually competes with a data overlay. We keep
// using its (free, no-key) vector tiles, but override the paint of a few
// known layers to a neutral basemap so the UV raster reads as the map's
// primary content and borders/labels stay legible but secondary. This is
// applied once the style loads; if the upstream style's layer IDs ever
// change, this silently no-ops rather than breaking the map.
function restyleBasemap(map: maplibregl.Map) {
  const NEUTRAL_OCEAN = "#0f1b2a";
  const NEUTRAL_LAND = "#26313f";
  try {
    map.setPaintProperty("background", "background-color", NEUTRAL_OCEAN);
    map.setPaintProperty("countries-fill", "fill-color", NEUTRAL_LAND);
    map.setPaintProperty("crimea-fill", "fill-color", NEUTRAL_LAND);
    map.setPaintProperty("coastline", "line-color", "rgba(255,255,255,0.12)");
    map.setPaintProperty("coastline", "line-width", 1);
    map.setPaintProperty("countries-boundary", "line-color", "rgba(255,255,255,0.35)");
    map.setPaintProperty("countries-boundary", "line-width", 0.6);
    map.setPaintProperty("countries-boundary", "line-opacity", 1);
    map.setPaintProperty("countries-label", "text-color", "#ffffff");
    map.setPaintProperty("countries-label", "text-halo-color", "rgba(0,0,0,0.75)");
    map.setPaintProperty("countries-label", "text-halo-width", 1.4);
    // Equator/Tropics/Arctic Circle reference lines + labels — pure map
    // trivia, not something the UV forecast needs to explain itself; they
    // also visually competed with the UV raster. Hidden outright rather
    // than just recoloured.
    map.setLayoutProperty("geolines", "visibility", "none");
    map.setLayoutProperty("geolines-label", "visibility", "none");
    // Crimea is a separate fill layer drawn last in the upstream style
    // (above labels); move it back down with the other neutral fills so
    // it doesn't sit as a stray coloured patch above the raster and labels.
    map.moveLayer("crimea-fill", "countries-boundary");
  } catch {
    // Upstream style shape changed — keep the default look rather than crash.
  }
}

export function MapView({ grid, uv, timeIso, landMask, onSelectLocation, userLocation, selectedLocation }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Captured once, from whatever `selectedLocation` is on this component's
  // very first render -- a `useRef` initializer runs only then, which is
  // exactly "was a location already selected before the map ever mounted"
  // (true for a per-city SEO page's preset city, see App.tsx/presetCity.ts;
  // always null on the plain homepage, since map clicks/geolocation only
  // set selectedLocation well after mount). A later click elsewhere must
  // NOT re-trigger this -- it's a one-time "arrive already zoomed out, then
  // zoom to the pinned city" reveal, not a general re-fly-on-select.
  const initialSelectedLocationRef = useRef(selectedLocation);
  // Rendering a frame does a full bilinear resample + sun-position pass
  // (tens of ms). There are only a handful of hours reachable from the UI
  // (Now..+5h), so caching each rendered frame by timestamp makes
  // switching between already-viewed hours instant.
  const frameCacheRef = useRef<Map<string, { url: string; bounds: RenderBounds }>>(new Map());
  // The most recently computed frame, kept so a defensive resync (see the
  // "styledata" listener below) can restore the overlay without needing
  // the effect that computed it to run again.
  const latestFrameRef = useRef<UvFrameParams | null>(null);

  // True once the map's one-time "load" event has actually fired. This
  // used to be approximated by calling `map.isStyleLoaded()` at whatever
  // moment the UV-sync effect happened to run, falling back to
  // `map.once("load", apply)` if it read false -- but `isStyleLoaded()` is
  // a point-in-time snapshot (it can read false any time tiles are mid-
  // fetch, well after "load" already fired once) while `once("load", ...)`
  // is a ONE-TIME subscription: registering it *after* "load" has already
  // fired for real means it silently never fires again, and the UV
  // source/layer never gets added. That mismatch was the root cause of the
  // intermittent "basemap renders, UV colour never appears" bug. Tracking
  // readiness as React state instead makes the UV-sync effect below re-run
  // via React's own dependency mechanism whenever `mapReady` actually
  // changes, regardless of whether the map or the forecast data became
  // ready first.
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [10, 25],
      zoom: 1.1,
      minZoom: 0.4,
      maxZoom: 8,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    let loaded = false;
    map.once("load", () => {
      loaded = true;
      restyleBasemap(map);
      const initial = initialSelectedLocationRef.current;
      if (initial) {
        // Same reveal as "Use my location": arrive zoomed out, then fly in
        // once the map has actually loaded, rather than opening already
        // zoomed in with no sense of where the pin sits globally.
        map.flyTo({ center: [initial.lon, initial.lat], zoom: Math.max(map.getZoom(), 6) });
      }
      setMapReady(true);
    });

    // Defensive resync, not the primary fix (that's `mapReady` above): if
    // the UV source/layer were ever missing when they shouldn't be -- e.g.
    // a hypothetical future style reload, which MapLibre-family libraries
    // typically clear custom sources/layers on -- restore them the next
    // time the style reports any change, using the last frame we actually
    // computed. Cheap: two map lookups when everything's already correct
    // (the overwhelming majority of "styledata" firings), real work only
    // when something is genuinely missing.
    map.on("styledata", () => {
      const frame = latestFrameRef.current;
      if (!loaded || !frame) return;
      if (!map.getSource(frame.sourceId) || !map.getLayer(frame.layerId)) {
        // See the cast note by the other syncUvLayer call below -- we own
        // this source id and always create it as an image source.
        syncUvLayer(map as unknown as UvLayerMap, frame);
      }
    });

    map.on("click", (e) => {
      onSelectLocation(e.lngLat.lat, e.lngLat.lng);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Map is created once; click handler closes over the latest onSelectLocation via ref-free identity is fine since parent keeps it stable across renders in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    // `mapReady` (not a live `isStyleLoaded()`/`isStyleLoaded` check) is
    // the readiness gate -- see the comment on that state above. Because
    // it's a real dependency, this effect naturally re-runs via React
    // whenever it flips true, whether that happens before or after
    // grid/uv/timeIso/landMask are already available; no event-ordering
    // assumption needed.
    if (!map || !mapReady || !grid || !uv || !timeIso || !landMask) return;

    let frame = frameCacheRef.current.get(timeIso);
    if (!frame) {
      const stats = renderUvFrame(canvasRef.current, grid, uv, timeIso, landMask);
      frame = { url: canvasRef.current.toDataURL("image/png"), bounds: stats.bounds };
      frameCacheRef.current.set(timeIso, frame);
    }
    const { url: dataUrl, bounds } = frame;
    // Coordinates come from the same clamped bounds the raster was drawn
    // to (see renderUvFrame / MERCATOR_LAT_LIMIT) — Web Mercator cannot
    // represent the true poles, so these must never be the grid's raw
    // +/-90 extremes.
    const coordinates: Coordinates = [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
      [bounds.west, bounds.south],
    ];

    const params: UvFrameParams = {
      sourceId: SOURCE_ID,
      layerId: LAYER_ID,
      dataUrl,
      coordinates,
      beforeLayerCandidate: BEFORE_LAYER_CANDIDATE,
    };
    latestFrameRef.current = params;

    try {
      // maplibregl.Map's own getSource() return type is the full Source
      // union (it can't know statically that SOURCE_ID is always the image
      // source we create below); this cast is the same trust the original
      // code placed in it via `as ImageSource`, just expressed through
      // UvLayerMap's narrower, test-mockable interface instead.
      syncUvLayer(map as unknown as UvLayerMap, params);
    } catch (err) {
      // Deliberately not swallowed into any permanent "already
      // initialised" flag -- there isn't one, on purpose. The next
      // "styledata" event or frame change retries via the same idempotent
      // path rather than leaving the overlay stuck missing.
      console.error("Failed to sync UV overlay layer:", err);
    }
  }, [mapReady, grid, uv, timeIso, landMask]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (userMarkerRef.current) userMarkerRef.current.remove();
    if (userLocation) {
      userMarkerRef.current = new maplibregl.Marker({ color: "#3b82f6" })
        .setLngLat([userLocation.lon, userLocation.lat])
        .addTo(map);
      // "Use my location" should bring the map to the location it just
      // found, not just drop a marker somewhere off-screen -- e.g. a user
      // browsing another part of the world before tapping the button.
      map.flyTo({ center: [userLocation.lon, userLocation.lat], zoom: Math.max(map.getZoom(), 6) });
    }
  }, [userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selectedMarkerRef.current) selectedMarkerRef.current.remove();
    if (selectedLocation) {
      selectedMarkerRef.current = new maplibregl.Marker({ color: "#111827" })
        .setLngLat([selectedLocation.lon, selectedLocation.lat])
        .addTo(map);
    }
  }, [selectedLocation]);

  return <div ref={containerRef} className="map-container" />;
}
