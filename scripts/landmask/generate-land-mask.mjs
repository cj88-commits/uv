// Generates public/data/land-mask.png: a static, one-time-computed raster
// (white = land, black = ocean) used to clip the UV heat-map to land only.
// Source: Natural Earth 50m land polygons, via the `world-atlas` package
// (topojson). Run this once (or whenever coastal fidelity needs revisiting)
// with `npm run generate:landmask` — it is NOT part of the per-hour
// rendering path. See docs/MVP_ARCHITECTURE.md.
//
// Uses a scanline polygon fill (even-odd rule across all rings, so lakes/
// inland seas that are holes in the land polygon are excluded correctly)
// rather than per-pixel point-in-polygon, which would be far too slow at
// ~1M output pixels against ~60k source vertices.
import { feature } from "topojson-client";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import topology from "world-atlas/land-50m.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "..", "public", "data", "land-mask.png");

// Must match the UV raster's rendered extent/resolution in
// src/lib/mapRender.ts (MERCATOR_LAT_LIMIT, OUTPUT_SCALE) so mask lookups
// need no resampling. Documented as a constant, not silently duplicated.
export const WIDTH = 1440;
export const HEIGHT = 721;
export const NORTH = 85.05;
export const SOUTH = -85.05;
export const WEST = -180;
export const EAST = 180;

function collectEdges(geometry) {
  const edges = [];
  for (const polygon of geometry.coordinates) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        if (lat1 === lat2) continue; // horizontal edges never cross a scanline

        if (Math.abs(lon2 - lon1) > 180) {
          // A raw jump >180 deg is often NOT a genuine antimeridian
          // crossing — e.g. lon1=179.9, lon2=-180 is really a ~0.1 deg
          // edge that only looks huge because of the +180/-180 sign flip.
          // Unwrap first to find the true (shortest-path) delta, then only
          // split if that unwrapped endpoint genuinely lands outside
          // [-180, 180].
          let lon2u = lon2;
          if (lon2u - lon1 > 180) lon2u -= 360;
          else if (lon2u - lon1 < -180) lon2u += 360;

          if (lon2u > 180 || lon2u < -180) {
            // Genuine crossing (e.g. Wrangel Island / Chukotka). Simply
            // dropping it would leave the ring "open" at these rows,
            // producing an off-by-one crossing count that corrupts the
            // even-odd fill for the *entire* scanline, not just locally —
            // this was the actual cause of a spurious full-width band
            // during development. Split it at the seam instead, so both
            // halves are ordinary, closed, non-wrapping edges.
            const seam = lon2u > 180 ? 180 : -180;
            const t = (seam - lon1) / (lon2u - lon1);
            const latCross = lat1 + (lat2 - lat1) * t;
            edges.push([lon1, lat1, seam, latCross]);
            edges.push([-seam, latCross, lon2, lat2]);
          } else {
            edges.push([lon1, lat1, lon2u, lat2]);
          }
          continue;
        }

        edges.push([lon1, lat1, lon2, lat2]);
      }
    }
  }
  return edges;
}

function rasterize(edges) {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let py = 0; py < HEIGHT; py++) {
    // A tiny epsilon nudge avoids the scanline landing exactly on a vertex
    // latitude — topojson's coordinate quantization snaps many originally-
    // distinct vertices (across unrelated rings/continents) onto the same
    // rounded latitude, and without this a scanline hitting that exact
    // value could pick up an odd number of crossings from many rings at
    // once, producing a spurious full-width fill at that one row.
    const lat = NORTH + ((SOUTH - NORTH) * py) / (HEIGHT - 1) + 1e-7;
    const crossings = [];
    for (const [lon1, lat1, lon2, lat2] of edges) {
      const inRange = (lat1 <= lat && lat < lat2) || (lat2 <= lat && lat < lat1);
      if (!inRange) continue;
      const t = (lat - lat1) / (lat2 - lat1);
      crossings.push(lon1 + (lon2 - lon1) * t);
    }
    crossings.sort((a, b) => a - b);

    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const lonStart = crossings[i];
      const lonEnd = crossings[i + 1];
      let pxStart = Math.round(((lonStart - WEST) / (EAST - WEST)) * WIDTH);
      let pxEnd = Math.round(((lonEnd - WEST) / (EAST - WEST)) * WIDTH);
      pxStart = Math.max(0, Math.min(WIDTH - 1, pxStart));
      pxEnd = Math.max(0, Math.min(WIDTH - 1, pxEnd));
      for (let px = pxStart; px <= pxEnd; px++) {
        mask[py * WIDTH + px] = 1;
      }
    }
  }
  return mask;
}

function writePng(mask, outPath) {
  // pngjs's .data buffer is always RGBA regardless of output colour type,
  // so write all four channels explicitly (R=G=B=value, A=255) rather than
  // assuming 1 byte/pixel.
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < mask.length; i++) {
    const value = mask[i] ? 255 : 0;
    png.data[i * 4] = value;
    png.data[i * 4 + 1] = value;
    png.data[i * 4 + 2] = value;
    png.data[i * 4 + 3] = 255;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, PNG.sync.write(png));
}

function main() {
  const geo = feature(topology, topology.objects.land);
  const geometry = geo.features[0].geometry;
  console.log(`Loaded land geometry: ${geometry.coordinates.length} polygons`);

  const t0 = Date.now();
  const edges = collectEdges(geometry);
  console.log(`Collected ${edges.length} edges`);

  const mask = rasterize(edges);
  const landPixels = mask.reduce((a, b) => a + b, 0);
  console.log(
    `Rasterized ${WIDTH}x${HEIGHT} in ${Date.now() - t0}ms — ` +
      `${landPixels} land px (${((100 * landPixels) / mask.length).toFixed(1)}%), ` +
      `${mask.length - landPixels} ocean px`
  );

  writePng(mask, OUT_PATH);
  const sizeKb = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
  console.log(`Wrote ${OUT_PATH} (${sizeKb} KB)`);
}

main();
