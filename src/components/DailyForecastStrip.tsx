import type { DayForecast } from "../lib/locationForecast";
import { weekdayShortLabel } from "../lib/locationForecast";
import { continuousUvColorCss } from "../lib/colorRamp";
import { en } from "../locales/en";

interface Props {
  days: DayForecast[];
}

export function DailyForecastStrip({ days }: Props) {
  if (days.length === 0) return null;

  return (
    <section className="detail-section">
      <h2 className="detail-section-title">{en.dailyForecastTitle}</h2>
      <div className="daily-strip" role="list">
        {days.map((day) => {
          const peakUv = day.summary.peak?.uv ?? null;
          return (
            <div className="daily-card" role="listitem" key={day.dateKey}>
              <div className="daily-card-label">{day.isToday ? en.today : weekdayShortLabel(day.dateKey)}</div>
              <div className="daily-card-uv">
                {peakUv !== null ? peakUv.toFixed(1) : "–"}
                {/* Subtle indicator, not a repeated "Protection recommended"
                    line under every card -- the category colour already
                    carries most of the signal; this just flags the
                    threshold crossing specifically, per spec. */}
                {day.protectionRecommended && (
                  <span
                    className="daily-card-protection-dot"
                    role="img"
                    aria-label={en.dailyStripProtectionIndicatorLabel}
                    title={en.dailyStripProtectionIndicatorLabel}
                  />
                )}
              </div>
              <div
                className="daily-card-swatch"
                style={{ background: peakUv !== null ? continuousUvColorCss(peakUv) : undefined }}
                aria-hidden="true"
              />
              <div className="daily-card-category">{day.category ? en.categoryLabel[day.category] : en.legendNight}</div>
              {day.peakLocalTime && <div className="daily-card-peak-time">{en.dailyStripPeakAt(day.peakLocalTime)}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
