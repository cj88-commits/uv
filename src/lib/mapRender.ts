import { getUvCategory, type UvCategory } from "./uv";
import { isDaylight } from "./daynight";
import type { ManifestGrid } from "./forecast";

export const CATEGORY_COLORS: Record<UvCategory, [number, number, number]> = {
  low: [46, 160, 67], // green
  moderate: [241, 196, 15], // yellow
  high: [230, 126, 34], // orange
  "very-high": [231, 76, 60], // red
  extreme: [155, 89, 182], // violet
};

export const NIGHT_COLOR: [number, number, number] = [17, 24, 39]; // neutral dark slate

/**
 * Renders one hourly UV grid to a canvas: each cell is colored by its
 * standard UV category, except cells currently in darkness, which get a
 * neutral night color instead of being shown as "low UV green". This is a
 * per-cell categorical map, not a smoothed/interpolated field — it never
 * implies resolution finer than the underlying CAMS grid.
 */
export function renderUvFrame(canvas: HTMLCanvasElement, grid: ManifestGrid, uv: Float32Array, timeIso: string): void {
  canvas.width = grid.nlon;
  canvas.height = grid.nlat;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const image = ctx.createImageData(grid.nlon, grid.nlat);
  const date = new Date(timeIso);

  for (let row = 0; row < grid.nlat; row++) {
    const lat = grid.lat_start + row * grid.lat_step;
    for (let col = 0; col < grid.nlon; col++) {
      const lon = grid.lon_start + col * grid.lon_step;
      const idx = row * grid.nlon + col;
      const pixelOffset = idx * 4;

      let color: [number, number, number];
      if (isDaylight(lat, lon, date)) {
        color = CATEGORY_COLORS[getUvCategory(uv[idx])];
      } else {
        color = NIGHT_COLOR;
      }

      image.data[pixelOffset] = color[0];
      image.data[pixelOffset + 1] = color[1];
      image.data[pixelOffset + 2] = color[2];
      image.data[pixelOffset + 3] = 200; // slight transparency so basemap shows through
    }
  }

  ctx.putImageData(image, 0, 0);
}
