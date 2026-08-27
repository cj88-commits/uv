import SunCalc from "suncalc";
import { continuousUvColor } from "./colorRamp";
import type { ManifestGrid } from "./forecast";

// Muted, near-black overlay used for the night side of the globe. Night is
// a distinct visual state, not just "the lowest UV colour".
export const NIGHT_COLOR: [number, number, number] = [8, 12, 20];

// Output raster resolution: an integer multiple of the ~1 deg CAMS grid,
// upsampled purely for visual smoothness via bilinear interpolation. This
// never adds real spatial resolution — see docs/MVP_ARCHITECTURE.md.
const OUTPUT_SCALE = 4;

// Soft terminator: full daylight above +TWILIGHT_DEG solar altitude, full
// night below -TWILIGHT_DEG, linearly blended between. This is a stylised
// soft edge (closer to how the terminator actually looks from space), not
// a scientific twilight-phase distinction.
const TWILIGHT_DEG = 6;

// MapLibre/Web Mercator cannot represent the true poles: projecting
// lat=+/-90 produces +/-Infinity, which corrupts the whole image quad's
// transform, not just the polar pixels (this was the root cause of a real
// bug where the entire globe rendered as night — see
// docs/MVP_ARCHITECTURE.md). Clamp to the same standard Web Mercator limit
// used by web maps generally (and by this app's own basemap tiles, per
// their own bounds metadata).
export const MERCATOR_LAT_LIMIT = 85.05;

// Sanity thresholds, not scientific ones: CAMS itself already implies "the
// sun must be up here" once its UV value is meaningfully above zero. If the
// independently-computed solar altitude disagrees strongly enough to call
// a point deep night anyway, that's a bug in the day/night calculation, not
// a real phenomenon.
const MEANINGFUL_UV = 0.5;
const DEEP_NIGHT_DAY_FACTOR = 0.05;

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

export interface RenderBounds {
  north: number;
  south: number;
  west: number;
  east: number;
}

export interface UvFrame {
  width: number;
  height: number;
  /** RGBA, row-major, top row = bounds.north. */
  rgba: Uint8ClampedArray;
  bounds: RenderBounds;
  altitudeMs: number;
  pixelMs: number;
  /** True if any pixel had meaningful CAMS UV but was classified as deep
   * night — see MEANINGFUL_UV / DEEP_NIGHT_DAY_FACTOR above. Should never
   * happen; exposed mainly for tests and diagnostics. */
  hadNightInconsistency: boolean;
}

/**
 * Pure computation of one hourly UV grid as a continuous heat-map raster:
 * bilinear interpolation between neighbouring CAMS cells (visual smoothing
 * only, never implying finer real resolution), a continuous UV colour ramp
 * (src/lib/colorRamp.ts) rather than flat category bands, and a soft
 * day/night terminator derived from real solar altitude (SunCalc). Has no
 * DOM/canvas dependency so it can be unit-tested directly.
 */
export function computeUvFrame(
  grid: ManifestGrid,
  uv: Float32Array,
  timeIso: string,
  scale = OUTPUT_SCALE
): UvFrame {
  const outW = grid.nlon * scale;
  const outH = (grid.nlat - 1) * scale + 1;

  const gridSouth = grid.lat_start + grid.lat_step * (grid.nlat - 1);
  const west = grid.lon_start;
  const east = grid.lon_start + grid.lon_step * grid.nlon;
  const north = Math.min(grid.lat_start, MERCATOR_LAT_LIMIT);
  const south = Math.max(gridSouth, -MERCATOR_LAT_LIMIT);
  const bounds: RenderBounds = { north, south, west, east };

  const t0 = performance.now();
  const date = new Date(timeIso);
  const altitudeGrid = computeAltitudeGrid(grid, date);
  const t1 = performance.now();

  const rgba = new Uint8ClampedArray(outW * outH * 4);
  let hadNightInconsistency = false;

  for (let py = 0; py < outH; py++) {
    const lat = north + ((south - north) * py) / (outH - 1);
    for (let px = 0; px < outW; px++) {
      const lon = west + ((east - west) * px) / outW;

      const uvVal = bilinear(uv, grid, lat, lon);
      const altitude = bilinear(altitudeGrid, grid, lat, lon);
      const [r, g, b] = continuousUvColor(uvVal);
      const dayFactor = Math.min(1, Math.max(0, (altitude + TWILIGHT_DEG) / (2 * TWILIGHT_DEG)));

      if (uvVal >= MEANINGFUL_UV && dayFactor < DEEP_NIGHT_DAY_FACTOR) {
        hadNightInconsistency = true;
      }

      const idx = (py * outW + px) * 4;
      rgba[idx] = NIGHT_COLOR[0] + (r - NIGHT_COLOR[0]) * dayFactor;
      rgba[idx + 1] = NIGHT_COLOR[1] + (g - NIGHT_COLOR[1]) * dayFactor;
      rgba[idx + 2] = NIGHT_COLOR[2] + (b - NIGHT_COLOR[2]) * dayFactor;
      rgba[idx + 3] = 255;
    }
  }
  const t2 = performance.now();

  if (hadNightInconsistency) {
    // eslint-disable-next-line no-console
    console.warn(
      `[uv-render] inconsistency at ${timeIso}: at least one pixel has meaningful CAMS UV ` +
        `(>= ${MEANINGFUL_UV}) but was classified as deep night by the solar-altitude calculation.`
    );
  }

  return { width: outW, height: outH, rgba, bounds, altitudeMs: t1 - t0, pixelMs: t2 - t1, hadNightInconsistency };
}

/** Samples the RGBA colour a computed frame would show at (lat, lon). */
export function sampleFramePixel(frame: UvFrame, lat: number, lon: number): [number, number, number, number] {
  const { bounds, width, height, rgba } = frame;
  const py = Math.round(((lat - bounds.north) / (bounds.south - bounds.north)) * (height - 1));
  const px = Math.round(((lon - bounds.west) / (bounds.east - bounds.west)) * width);
  const clampedPy = Math.min(Math.max(py, 0), height - 1);
  const clampedPx = Math.min(Math.max(px, 0), width - 1);
  const idx = (clampedPy * width + clampedPx) * 4;
  return [rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]];
}

export interface RenderStats {
  widthPx: number;
  heightPx: number;
  altitudeMs: number;
  pixelMs: number;
  totalMs: number;
  bounds: RenderBounds;
}

/** Canvas-drawing wrapper around computeUvFrame for actual map display. */
export function renderUvFrame(
  canvas: HTMLCanvasElement,
  grid: ManifestGrid,
  uv: Float32Array,
  timeIso: string,
  scale = OUTPUT_SCALE
): RenderStats {
  const t0 = performance.now();
  const frame = computeUvFrame(grid, uv, timeIso, scale);

  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const imageData = ctx.createImageData(frame.width, frame.height);
    imageData.data.set(frame.rgba);
    ctx.putImageData(imageData, 0, 0);
  }
  const t2 = performance.now();

  return {
    widthPx: frame.width,
    heightPx: frame.height,
    altitudeMs: frame.altitudeMs,
    pixelMs: frame.pixelMs,
    totalMs: t2 - t0,
    bounds: frame.bounds,
  };
}
