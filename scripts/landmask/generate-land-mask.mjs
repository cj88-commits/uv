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
//
// The scan direction is *vertical* (fixed longitude, sweeping latitude),
// not horizontal. A horizontal (fixed-latitude) scanline has to assume
// "ocean" at the lon=+/-180 seam to seed its left-to-right alternation —
// which is false wherever a landmass genuinely straddles the antimeridian
// (Russia's Chukotka coast does, north of ~54 deg N), corrupting every
// crossing pairing for the rest of that scanline and producing large false
// gaps (verified: this silently deleted most of Scandinavia/Urals/Siberia
// around the Arctic Circle). Latitude never wraps and there is provably no
// land at the true North Pole, so a vertical scan can seed its alternation
// at lat=90 with zero assumptions and no seam ambiguity.
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
        if (lon1 === lon2) continue; // vertical edges never cross a meridian
        edges.push([lon1, lat1, lon2, lat2]);
      }
    }
  }
  return edges;
}

/** Signed shortest angular delta from `from` to `to`, in (-180, 180]. */
function shortestDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

function rasterize(edges) {
  const mask = new Uint8Array(WIDTH * HEIGHT);
  for (let px = 0; px < WIDTH; px++) {
    // A tiny epsilon nudge avoids the scan meridian landing exactly on a
    // vertex longitude — topojson's coordinate quantization snaps many
    // originally-distinct vertices onto the same rounded longitude, and
    // without this a column hitting that exact value could pick up an odd
    // number of crossings from many rings at once.
    const lon = WEST + ((EAST - WEST) * px) / WIDTH + 1e-7;
    const crossings = [];
    for (const [lon1, lat1, lon2, lat2] of edges) {
      // Unwrap this one edge to its true short-path span, then bring the
      // scan meridian into that same local branch, so a genuine
      // antimeridian-straddling edge (e.g. Chukotka) is handled correctly
      // without any global/cumulative bookkeeping.
      const lon2u = lon1 + shortestDelta(lon1, lon2);
      const lonu = lon1 + shortestDelta(lon1, lon);
      const inRange = (lon1 <= lonu && lonu < lon2u) || (lon2u <= lonu && lonu < lon1);
      if (!inRange) continue;
      const t = (lonu - lon1) / (lon2u - lon1);
      crossings.push(lat1 + (lat2 - lat1) * t);
    }
    // Descending (north to south): alternation starts from lat=90, the
    // true North Pole, which is unconditionally ocean — no assumption
    // needed, unlike seeding at a fixed longitude.
    crossings.sort((a, b) => b - a);

    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const latStart = crossings[i];
      const latEnd = crossings[i + 1];
      let pyStart = Math.round(((latStart - NORTH) / (SOUTH - NORTH)) * (HEIGHT - 1));
      let pyEnd = Math.round(((latEnd - NORTH) / (SOUTH - NORTH)) * (HEIGHT - 1));
      pyStart = Math.max(0, Math.min(HEIGHT - 1, pyStart));
      pyEnd = Math.max(0, Math.min(HEIGHT - 1, pyEnd));
      for (let py = pyStart; py <= pyEnd; py++) {
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
