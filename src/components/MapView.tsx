import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { ImageSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ManifestGrid } from "../lib/forecast";
import { renderUvFrame } from "../lib/mapRender";

interface LatLon {
  lat: number;
  lon: number;
}

interface Props {
  grid: ManifestGrid | null;
  uv: Float32Array | null;
  timeIso: string | null;
  onSelectLocation: (lat: number, lon: number) => void;
  userLocation: LatLon | null;
  selectedLocation: LatLon | null;
}

const SOURCE_ID = "uv-field";
const LAYER_ID = "uv-field-layer";

export function MapView({ grid, uv, timeIso, onSelectLocation, userLocation, selectedLocation }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);

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
    if (!map || !grid || !uv || !timeIso) return;

    renderUvFrame(canvasRef.current, grid, uv, timeIso);
    const dataUrl = canvasRef.current.toDataURL("image/png");

    const north = grid.lat_start;
    const south = grid.lat_start + grid.lat_step * (grid.nlat - 1);
    const west = grid.lon_start;
    const east = grid.lon_start + grid.lon_step * grid.nlon;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ];

    const apply = () => {
      const existing = map.getSource(SOURCE_ID) as ImageSource | undefined;
      if (existing) {
        existing.updateImage({ url: dataUrl, coordinates });
      } else {
        map.addSource(SOURCE_ID, { type: "image", url: dataUrl, coordinates });
        map.addLayer({ id: LAYER_ID, type: "raster", source: SOURCE_ID, paint: { "raster-fade-duration": 0 } });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [grid, uv, timeIso]);

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
