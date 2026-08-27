import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { ImageSource } from "maplibre-gl";
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
    map.setPaintProperty("geolines", "line-color", "rgba(255,255,255,0.3)");
    map.setPaintProperty("countries-label", "text-color", "#ffffff");
    map.setPaintProperty("countries-label", "text-halo-color", "rgba(0,0,0,0.75)");
    map.setPaintProperty("countries-label", "text-halo-width", 1.4);
    map.setPaintProperty("geolines-label", "text-color", "#bcd6e6");
    map.setPaintProperty("geolines-label", "text-halo-color", "rgba(0,0,0,0.7)");
    map.setPaintProperty("geolines-label", "text-halo-width", 1.2);
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
  // Rendering a frame does a full bilinear resample + sun-position pass
  // (tens of ms). There are only a handful of hours reachable from the UI
  // (Now..+5h), so caching each rendered frame by timestamp makes
  // switching between already-viewed hours instant.
  const frameCacheRef = useRef<Map<string, { url: string; bounds: RenderBounds }>>(new Map());

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
    map.once("load", () => restyleBasemap(map));

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
    if (!map || !grid || !uv || !timeIso || !landMask) return;

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
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
      [bounds.west, bounds.south],
    ];

    const apply = () => {
      const existing = map.getSource(SOURCE_ID) as ImageSource | undefined;
      if (existing) {
        existing.updateImage({ url: dataUrl, coordinates });
      } else {
        map.addSource(SOURCE_ID, { type: "image", url: dataUrl, coordinates });
        // Insert below borders/labels (added later in the style) so they
        // stay visible on top of the raster, and above the neutral
        // land/ocean fills (added earlier) so the raster reads as the
        // map's dominant layer.
        map.addLayer(
          { id: LAYER_ID, type: "raster", source: SOURCE_ID, paint: { "raster-fade-duration": 0 } },
          map.getLayer("countries-boundary") ? "countries-boundary" : undefined
        );
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [grid, uv, timeIso, landMask]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (userMarkerRef.current) userMarkerRef.current.remove();
    if (userLocation) {
      userMarkerRef.current = new maplibregl.Marker({ color: "#3b82f6" })
        .setLngLat([userLocation.lon, userLocation.lat])
        .addTo(map);
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
