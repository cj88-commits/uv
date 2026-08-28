import { describe, it, expect } from "vitest";
import { buildCityHtml, buildSitemap } from "./generate-city-pages.mjs";

// A trimmed-down stand-in for the real dist/index.html Vite produces (see
// vite.config.ts's base:"/" -- absolute asset paths). Only the parts
// buildCityHtml actually rewrites need to be realistic.
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Do I Need Sunscreen Today? | SPF? Yes or No</title>
    <meta name="description" content="Check today's UV index and forecast for your location and find out when sun protection is recommended." />
    <link rel="canonical" href="https://spfyesorno.com/" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="SPF? Yes or No" />
    <meta property="og:url" content="https://spfyesorno.com/" />
    <meta property="og:title" content="Do I Need Sunscreen Today? | SPF? Yes or No" />
    <meta property="og:description" content="Check today's UV index and forecast and see when sun protection is recommended." />
    <script type="module" crossorigin src="/assets/index-ABC123.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-XYZ789.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const LONDON = { slug: "london", name: "London", lat: 51.5074, lon: -0.1278 };

describe("buildCityHtml", () => {
  const html = buildCityHtml(TEMPLATE, LONDON);

  it("sets a city-specific title in the expected format", () => {
    expect(html).toContain("<title>UV Index in London Today | SPF? Yes or No</title>");
  });

  it("sets a city-specific meta description", () => {
    expect(html).toContain(
      'content="Check today\'s UV index and forecast for London and find out when sun protection is recommended."'
    );
  });

  it("points canonical and og:url at the city's own trailing-slash URL", () => {
    expect(html).toContain('<link rel="canonical" href="https://spfyesorno.com/london/" />');
    expect(html).toContain('<meta property="og:url" content="https://spfyesorno.com/london/" />');
  });

  it("updates og:title and og:description to match", () => {
    expect(html).toContain('<meta property="og:title" content="UV Index in London Today | SPF? Yes or No" />');
    expect(html).toContain(
      '<meta property="og:description" content="Check today\'s UV index and forecast for London and find out when sun protection is recommended." />'
    );
  });

  it("does not touch unrelated og tags", () => {
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta property="og:site_name" content="SPF? Yes or No" />');
  });

  it("injects window.__PRESET_CITY__ with the exact city data, before the module script", () => {
    expect(html).toContain(
      '<script>window.__PRESET_CITY__={"slug":"london","name":"London","lat":51.5074,"lon":-0.1278};</script>'
    );
    const presetIdx = html.indexOf("__PRESET_CITY__");
    const moduleIdx = html.indexOf('<script type="module"');
    expect(presetIdx).toBeGreaterThan(-1);
    expect(moduleIdx).toBeGreaterThan(presetIdx);
  });

  it("does not alter the built asset URLs", () => {
    expect(html).toContain('src="/assets/index-ABC123.js"');
    expect(html).toContain('href="/assets/index-XYZ789.css"');
  });

  it("injects a visually-hidden fallback heading/paragraph as a sibling of #root, matching the city copy exactly", () => {
    expect(html).toContain('<div id="prerendered-seo" class="sr-only">');
    expect(html).toContain("<h1>UV Index in London Today</h1>");
    expect(html).toContain(
      "<p>Check today's UV index and forecast for London and find out when sun protection is recommended.</p>"
    );
    // Sibling of #root, not a replacement for it -- the app still mounts normally.
    expect(html).toContain('</div>\n    <div id="root"></div>');
  });

  it("HTML-escapes a city name containing an ampersand", () => {
    // Double-quoted attributes and plain text content don't require
    // apostrophes to be escaped -- only characters that are actually
    // special in those contexts (&, <, >, and " inside attribute values).
    const html2 = buildCityHtml(TEMPLATE, { slug: "test", name: "O'Brien & Sons", lat: 0, lon: 0 });
    expect(html2).not.toContain("O'Brien & Sons</title>");
    expect(html2).toContain("O'Brien &amp; Sons");
  });

  it("throws a clear error rather than silently no-op'ing if the template shape changes", () => {
    const brokenTemplate = TEMPLATE.replace('<link rel="canonical" href="https://spfyesorno.com/" />', "");
    expect(() => buildCityHtml(brokenTemplate, LONDON)).toThrow(/canonical/);
  });
});

describe("buildSitemap", () => {
  const cities = [LONDON, { slug: "tokyo", name: "Tokyo", lat: 35.6762, lon: 139.6503 }];

  it("lists the homepage plus every city's trailing-slash URL", () => {
    const xml = buildSitemap(cities);
    expect(xml).toContain("<loc>https://spfyesorno.com/</loc>");
    expect(xml).toContain("<loc>https://spfyesorno.com/london/</loc>");
    expect(xml).toContain("<loc>https://spfyesorno.com/tokyo/</loc>");
  });

  it("is well-formed enough to at least look like a sitemap (single root urlset)", () => {
    const xml = buildSitemap(cities);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((xml.match(/<urlset/g) ?? []).length).toBe(1);
    expect((xml.match(/<\/urlset>/g) ?? []).length).toBe(1);
    expect((xml.match(/<url>/g) ?? []).length).toBe(cities.length + 1);
  });
});
