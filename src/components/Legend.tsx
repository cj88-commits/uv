import { en } from "../locales/en";

const ITEMS: { label: string; color: string }[] = [
  { label: "0–2 " + en.categoryLabel.low, color: "rgb(46,160,67)" },
  { label: "3–5 " + en.categoryLabel.moderate, color: "rgb(241,196,15)" },
  { label: "6–7 " + en.categoryLabel.high, color: "rgb(230,126,34)" },
  { label: "8–10 " + en.categoryLabel["very-high"], color: "rgb(231,76,60)" },
  { label: "11+ " + en.categoryLabel.extreme, color: "rgb(155,89,182)" },
  { label: en.legendNight, color: "rgb(17,24,39)" },
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
