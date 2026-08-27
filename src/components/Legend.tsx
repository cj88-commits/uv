import { en } from "../locales/en";
import { continuousUvColorCss } from "../lib/colorRamp";

// Swatches sample the same continuous ramp the raster uses (at a
// representative value within each standard category) so the legend
// matches what's actually on the map, rather than a separate flat colour.
const ITEMS: { label: string; color: string }[] = [
  { label: "0–2 " + en.categoryLabel.low, color: continuousUvColorCss(1) },
  { label: "3–5 " + en.categoryLabel.moderate, color: continuousUvColorCss(4) },
  { label: "6–7 " + en.categoryLabel.high, color: continuousUvColorCss(6.5) },
  { label: "8–10 " + en.categoryLabel["very-high"], color: continuousUvColorCss(9) },
  { label: "11+ " + en.categoryLabel.extreme, color: continuousUvColorCss(12) },
  { label: en.legendNight, color: "rgb(8,12,20)" },
];

export function Legend() {
  return (
    <div className="legend">
      {ITEMS.map((item) => (
        <div className="legend-item" key={item.label}>
          <span className="swatch" style={{ background: item.color }} />
          {item.label}
        </div>
      ))}
    </div>
  );
}
