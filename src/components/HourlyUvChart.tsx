import { toApproxLocalTime } from "../lib/forecast";
import { PROTECTION_THRESHOLD, type DailyUvSummary } from "../lib/uv";
import { en } from "../locales/en";

interface Props {
  /** Chronological, already trimmed to the useful daylight window (see
   * trimToDaylightWindow) -- this component does no filtering of its own. */
  points: { time: string; uv: number }[];
  /** Same summary object the primary card renders from (getDailyUvSummary
   * over the same day's samples) -- passed in rather than recomputed here
   * so the chart's peak/protection window can never disagree with the
   * primary card's. */
  summary: DailyUvSummary;
  /** Longitude used only for formatting hour labels in the same approximate
   * local time as the rest of the panel (see toApproxLocalTime) -- no
   * separate timezone handling. */
  lon: number;
  /** The currently selected hour (Now/+1h..+5h), highlighted on the curve
   * if it falls within `points`. Won't match anything in `points` when this
   * chart is showing a different day than "now" (e.g. the night card's
   * upcoming-day outlook) -- that's fine, it just means no point gets the
   * selected-time marker, not an error. */
  selectedTime: string | null;
  /** Section heading -- defaults to "UV Today". The night card overrides
   * this to "UV Tomorrow" when showing the next day's curve instead of
   * today's, without needing a second chart implementation. */
  title?: string;
}

const VIEW_W = 600;
const VIEW_H = 220;
const MARGIN = { top: 22, right: 12, bottom: 28, left: 12 };
const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom;

export function HourlyUvChart({ points, summary, lon, selectedTime, title = en.hourlyForecastTitle }: Props) {
  if (points.length < 2) return null;

  const maxUv = Math.max(PROTECTION_THRESHOLD * 1.3, ...points.map((p) => p.uv)) * 1.15;

  const x = (i: number) => MARGIN.left + (i / (points.length - 1)) * PLOT_W;
  const y = (uv: number) => MARGIN.top + PLOT_H - (Math.max(0, uv) / maxUv) * PLOT_H;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.uv).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(MARGIN.top + PLOT_H).toFixed(1)} L${x(0).toFixed(1)},${(MARGIN.top + PLOT_H).toFixed(1)} Z`;

  const thresholdY = y(PROTECTION_THRESHOLD);

  const window = summary.protectionWindow;
  const windowStartIdx = window ? points.findIndex((p) => p.time === window.start) : -1;
  const windowEndIdx = window ? points.findIndex((p) => p.time === window.end) : -1;
  const hasWindowBand = windowStartIdx !== -1 && windowEndIdx !== -1;

  const peakIdx = summary.peak ? points.findIndex((p) => p.time === summary.peak!.time) : -1;
  const selectedIdx = selectedTime ? points.findIndex((p) => p.time === selectedTime) : -1;

  // Every ~3rd hour, but always the first and last, so labels never
  // overlap on a phone-width chart while still bookending the window.
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <section className="detail-section">
      <h2 className="detail-section-title">{title}</h2>
      <div className="hourly-chart">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="hourly-chart-svg" role="img" aria-label={en.hourlyChartAriaLabel}>
        {hasWindowBand && (
          <rect
            className="hourly-chart-window-band"
            x={x(windowStartIdx)}
            y={MARGIN.top}
            width={Math.max(0, x(windowEndIdx) - x(windowStartIdx))}
            height={PLOT_H}
          />
        )}

        <line className="hourly-chart-threshold-line" x1={MARGIN.left} x2={VIEW_W - MARGIN.right} y1={thresholdY} y2={thresholdY} />
        <text className="hourly-chart-threshold-label" x={VIEW_W - MARGIN.right} y={thresholdY - 4} textAnchor="end">
          {en.hourlyChartThresholdLabel(PROTECTION_THRESHOLD)}
        </text>

        <path className="hourly-chart-area" d={areaPath} />
        <path className="hourly-chart-line" d={linePath} />

        {peakIdx !== -1 && (
          <g>
            <circle className="hourly-chart-peak-dot" cx={x(peakIdx)} cy={y(points[peakIdx].uv)} r={4} />
            <text
              className="hourly-chart-peak-label"
              x={x(peakIdx)}
              y={y(points[peakIdx].uv) - 10}
              textAnchor={peakIdx > points.length - 3 ? "end" : peakIdx < 2 ? "start" : "middle"}
            >
              {points[peakIdx].uv.toFixed(1)}
            </text>
          </g>
        )}

        {selectedIdx !== -1 && selectedIdx !== peakIdx && (
          <g>
            <line
              className="hourly-chart-selected-line"
              x1={x(selectedIdx)}
              x2={x(selectedIdx)}
              y1={MARGIN.top}
              y2={MARGIN.top + PLOT_H}
            />
            <circle className="hourly-chart-selected-dot" cx={x(selectedIdx)} cy={y(points[selectedIdx].uv)} r={4} />
          </g>
        )}

        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.time} className="hourly-chart-axis-label" x={x(i)} y={VIEW_H - 8} textAnchor="middle">
              {toApproxLocalTime(p.time, lon)}
            </text>
          ) : null
        )}
      </svg>
      </div>
    </section>
  );
}
