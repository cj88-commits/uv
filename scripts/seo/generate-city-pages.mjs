// Generates a real static HTML page per city (dist/<slug>/index.html) plus
// dist/sitemap.xml, from the already-built SPA shell (dist/index.html).
//
// Why real files, not client-side routing: GitHub Pages is a plain static
// file server -- the common "SPA on GitHub Pages" 404.html redirect trick
// serves a real HTTP 404 to the initial request and nothing at all to
// crawlers/link-preview bots that don't execute JS. A genuine per-city
// index.html, sharing the same built JS/CSS bundle, avoids that while
// costing nothing at runtime (one shared bundle, ~20 tiny HTML files).
//
// Run as part of `npm run build`, after `vite build` (see package.json) so
// dist/index.html already has the correct hashed asset filenames.
//
// See docs/MVP_ARCHITECTURE.md for the full design writeup.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const DIST_DIR = path.join(REPO_ROOT, "dist");
const CITIES_PATH = path.join(REPO_ROOT, "src", "data", "cities.json");

export const SITE_ORIGIN = "https://spfyesorno.com";
export const SITE_NAME = "SPF? Yes or No";

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Keep in sync with src/locales/en.ts's cityHeading/cityIntro -- the
 * static fallback block this produces must say exactly what the hydrated
 * app says once JS runs (see main.tsx, which removes this block on mount),
 * so a crawler that never executes JS and one that does see the same
 * content. Not imported directly since this is a plain Node script and
 * en.ts is a bundled TS module. */
function cityHeading(name) {
  return `UV Index in ${name} Today`;
}
function cityIntro(name) {
  return `Check today's UV index and forecast for ${name} and find out when sun protection is recommended.`;
}

function replaceOne(html, regex, replacement, label) {
  if (!regex.test(html)) {
    throw new Error(`generate-city-pages: expected to find ${label} in the template but didn't -- template may have changed shape.`);
  }
  return html.replace(regex, replacement);
}

/**
 * Builds one city's index.html from the built homepage's own index.html:
 * swaps title/description/canonical/OG metadata, injects the
 * window.__PRESET_CITY__ bootstrap the app reads on mount (see
 * lib/presetCity.ts), and injects a visually-hidden, crawler-visible
 * fallback heading/paragraph for anything that doesn't execute JS.
 */
export function buildCityHtml(templateHtml, city, siteOrigin = SITE_ORIGIN, siteName = SITE_NAME) {
  const pageUrl = `${siteOrigin}/${city.slug}/`;
  const title = `${cityHeading(city.name)} | ${siteName}`;
  const description = cityIntro(city.name);

  let html = templateHtml;
  html = replaceOne(html, /<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`, "<title>");
  html = replaceOne(
    html,
    /(<meta name="description" content=")[^"]*(")/,
    `$1${escapeHtml(description)}$2`,
    'meta[name="description"]'
  );
  html = replaceOne(
    html,
    /(<link rel="canonical" href=")[^"]*(")/,
    `$1${escapeHtml(pageUrl)}$2`,
    'link[rel="canonical"]'
  );
  html = replaceOne(html, /(<meta property="og:url" content=")[^"]*(")/, `$1${escapeHtml(pageUrl)}$2`, "og:url");
  html = replaceOne(html, /(<meta property="og:title" content=")[^"]*(")/, `$1${escapeHtml(title)}$2`, "og:title");
  html = replaceOne(
    html,
    /(<meta property="og:description" content=")[^"]*(")/,
    `$1${escapeHtml(description)}$2`,
    "og:description"
  );

  const presetCityJson = JSON.stringify({ slug: city.slug, name: city.name, lat: city.lat, lon: city.lon });
  html = replaceOne(
    html,
    /<script type="module"/,
    `<script>window.__PRESET_CITY__=${presetCityJson};</script>\n    <script type="module"`,
    '<script type="module">'
  );

  const seoFallback =
    `<div id="prerendered-seo" class="sr-only">\n` +
    `      <h1>${escapeHtml(cityHeading(city.name))}</h1>\n` +
    `      <p>${escapeHtml(description)}</p>\n` +
    `    </div>\n    `;
  html = replaceOne(html, /<div id="root"><\/div>/, `${seoFallback}<div id="root"></div>`, '<div id="root">');

  return html;
}

export function buildSitemap(cities, siteOrigin = SITE_ORIGIN) {
  const urls = [`${siteOrigin}/`, ...cities.map((c) => `${siteOrigin}/${c.slug}/`)];
  const entries = urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function main() {
  const template = fs.readFileSync(path.join(DIST_DIR, "index.html"), "utf-8");
  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, "utf-8"));

  const slugs = new Set();
  for (const city of cities) {
    if (slugs.has(city.slug)) throw new Error(`generate-city-pages: duplicate slug "${city.slug}"`);
    slugs.add(city.slug);

    const html = buildCityHtml(template, city);
    const outDir = path.join(DIST_DIR, city.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "index.html"), html);
  }

  fs.writeFileSync(path.join(DIST_DIR, "sitemap.xml"), buildSitemap(cities));

  console.log(`Generated ${cities.length} city pages + sitemap.xml in ${DIST_DIR}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
