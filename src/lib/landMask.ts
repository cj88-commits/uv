// A precomputed land/ocean raster (see scripts/landmask/generate-land-mask.mjs)
// used to clip the UV heat-map to land only. Generated ONCE from Natural
// Earth land polygons and committed as a static asset — never computed via
// per-pixel point-in-polygon at render time (see docs/MVP_ARCHITECTURE.md).

// Must match scripts/landmask/generate-land-mask.mjs exactly, and matches
// the UV raster's own clamped extent (src/lib/mapRender.ts MERCATOR_LAT_LIMIT).
export const LAND_MASK_BOUNDS = { north: 85.05, south: -85.05, west: -180, east: 180 };

export interface LandMask {
  width: number;
  height: number;
  /** 1 = land, 0 = ocean, row-major, top row = LAND_MASK_BOUNDS.north. */
  data: Uint8Array;
}

/** Pure decode: RGBA (or grayscale-as-RGBA) pixel buffer -> a 1-bit-per-pixel
 * LandMask, thresholding on the red channel. No DOM dependency. */
export function decodeLandMaskFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 128
): LandMask {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    data[i] = rgba[i * 4] >= threshold ? 1 : 0;
  }
  return { width, height, data };
}

function wrapCol(col: number, width: number): number {
  return ((col % width) + width) % width;
}

/** Nearest-neighbour land/ocean lookup at an arbitrary (lat, lon). A binary
 * mask doesn't benefit from interpolation the way a continuous field does. */
export function sampleLandMask(mask: LandMask, lat: number, lon: number): boolean {
  const { north, south, west, east } = LAND_MASK_BOUNDS;
  const rowF = ((lat - north) / (south - north)) * (mask.height - 1);
  const row = Math.min(Math.max(Math.round(rowF), 0), mask.height - 1);

  let normLon = lon;
  while (normLon < west) normLon += 360;
  while (normLon >= east) normLon -= 360;
  const col = wrapCol(Math.round(((normLon - west) / (east - west)) * mask.width), mask.width);

  return mask.data[row * mask.width + col] === 1;
}

/** Browser-only loader: fetches the generated PNG and decodes it via canvas.
 * Absolute base URL -- see the matching comment on loadManifest in
 * forecast.ts (pages at different path depths share this one asset). */
export async function loadLandMask(baseUrl = "/data/"): Promise<LandMask> {
  const res = await fetch(`${baseUrl}land-mask.png`);
  if (!res.ok) throw new Error(`Failed to load land mask: ${res.status}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  return decodeLandMaskFromRgba(data, bitmap.width, bitmap.height);
}
