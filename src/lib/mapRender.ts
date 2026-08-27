import SunCalc from "suncalc";
import { continuousUvColor } from "./colorRamp";
import type { ManifestGrid } from "./forecast";

// Muted, near-black overlay used for the night side of the globe. Night is
// a distinct visual state, not just "the lowest UV colour".
const NIGHT_COLOR: [number, number, number] = [8, 12, 20];

// Output raster resolution: an integer multiple of the ~1 deg CAMS grid,
// upsampled purely for visual smoothness via bilinear interpolation. This
// never adds real spatial resolution — see docs/MVP_ARCHITECTURE.md.
const OUTPUT_SCALE = 4;

// Soft terminator: full daylight above +TWILIGHT_DEG solar altitude, full
// night below -TWILIGHT_DEG, linearly blended between. This is a stylised
// soft edge (closer to how the terminator actually looks from space), not
// a scientific twilight-phase distinction.
const TWILIGHT_DEG = 6;

function wrapCol(col: number, nlon: number): number {
  return ((col % nlon) + nlon) % nlon;
}

/** Bilinear sample of a row-major grid at an arbitrary (lat, lon), with
 * longitude wrapping and latitude clamped at the poles. */
function bilinear(data: Float32Array, grid: ManifestGrid, lat: number, lon: number): number {
  const rowF = Math.min(Math.max((lat - grid.lat_start) / grid.lat_step, 0), grid.nlat - 1);
  const row0 = Math.floor(rowF);
  const row1 = Math.min(row0 + 1, grid.nlat - 1);
  const rowT = rowF - row0;

  let normLon = lon;
  while (normLon < grid.lon_start) normLon += 360;
  while (normLon >= grid.lon_start + 360) normLon -= 360;
  const colF = (normLon - grid.lon_start) / grid.lon_step;
  const col0 = wrapCol(Math.floor(colF), grid.nlon);
  const col1 = wrapCol(col0 + 1, grid.nlon);
  const colT = colF - Math.floor(colF);

  const v00 = data[row0 * grid.nlon + col0];
  const v01 = data[row0 * grid.nlon + col1];
  const v10 = data[row1 * grid.nlon + col0];
  const v11 = data[row1 * grid.nlon + col1];

  const top = v00 + (v01 - v00) * colT;
  const bottom = v10 + (v11 - v10) * colT;
  return top + (bottom - top) * rowT;
}

/** Sun altitude in degrees at every cell of `grid`, for one timestamp. */
function computeAltitudeGrid(grid: ManifestGrid, date: Date): Float32Array {
  const out = new Float32Array(grid.nlat * grid.nlon);
  const RAD_TO_DEG = 180 / Math.PI;
  for (let row = 0; row < grid.nlat; row++) {
    const lat = grid.lat_start + row * grid.lat_step;
    for (let col = 0; col < grid.nlon; col++) {
      const lon = grid.lon_start + col * grid.lon_step;
      out[row * grid.nlon + col] = SunCalc.getPosition(date, lat, lon).altitude * RAD_TO_DEG;
    }
  }
  return out;
}

export interface RenderStats {
  widthPx: number;
  heightPx: number;
  altitudeMs: number;
  pixelMs: number;
  totalMs: number;
}

/**
 * Renders one hourly UV grid to a continuous heat-map raster: bilinear
 * interpolation between neighbouring CAMS cells (visual smoothing only,
 * never implying finer real resolution), a continuous UV colour ramp
 * (src/lib/colorRamp.ts) rather than flat category bands, and a soft
 * day/night terminator derived from real solar altitude (SunCalc).
 */
export function renderUvFrame(
  canvas: HTMLCanvasElement,
  grid: ManifestGrid,
  uv: Float32Array,
  timeIso: string,
  scale = OUTPUT_SCALE
): RenderStats {
  const t0 = performance.now();
  const outW = grid.nlon * scale;
  const outH = (grid.nlat - 1) * scale + 1;
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { widthPx: outW, heightPx: outH, altitudeMs: 0, pixelMs: 0, totalMs: 0 };

  const date = new Date(timeIso);
  const altitudeGrid = computeAltitudeGrid(grid, date);
  const t1 = performance.now();

  const image = ctx.createImageData(outW, outH);
  const south = grid.lat_start + grid.lat_step * (grid.nlat - 1);
  const west = grid.lon_start;
  const east = grid.lon_start + grid.lon_step * grid.nlon;

  for (let py = 0; py < outH; py++) {
    const lat = grid.lat_start + ((south - grid.lat_start) * py) / (outH - 1);
    for (let px = 0; px < outW; px++) {
      const lon = west + ((east - west) * px) / outW;

      const uvVal = bilinear(uv, grid, lat, lon);
      const altitude = bilinear(altitudeGrid, grid, lat, lon);
      const [r, g, b] = continuousUvColor(uvVal);
      const dayFactor = Math.min(1, Math.max(0, (altitude + TWILIGHT_DEG) / (2 * TWILIGHT_DEG)));

      const idx = (py * outW + px) * 4;
      image.data[idx] = NIGHT_COLOR[0] + (r - NIGHT_COLOR[0]) * dayFactor;
      image.data[idx + 1] = NIGHT_COLOR[1] + (g - NIGHT_COLOR[1]) * dayFactor;
      image.data[idx + 2] = NIGHT_COLOR[2] + (b - NIGHT_COLOR[2]) * dayFactor;
      image.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const t2 = performance.now();

  return { widthPx: outW, heightPx: outH, altitudeMs: t1 - t0, pixelMs: t2 - t1, totalMs: t2 - t0 };
}
