import { getCloudImpact } from "../lib/uv";
import { en } from "../locales/en";

interface Props {
  /** Forecast (total-sky) UV at the selected time -- the SAME value the
   * primary card's headline renders, passed down rather than recomputed. */
  forecastUv: number;
  clearUv: number;
  /** From the same real solar-altitude day/night check the primary card
   * already uses (daynight.ts) -- never shown at night, however the two UV
   * values happen to compare. */
  isDay: boolean;
}

export function CloudImpact({ forecastUv, clearUv, isDay }: Props) {
  const impact = getCloudImpact(forecastUv, clearUv, isDay);

  if (impact.kind === "none") return null;

  const forecastLabel = impact.forecastUv.toFixed(1);
  const clearLabel = impact.clearUv.toFixed(1);
  const isAdviceChange = impact.kind === "adviceChange";

  return (
    <section
      className={`detail-section cloud-impact${isAdviceChange ? " cloud-impact--prominent" : ""}`}
    >
      <h2 className="cloud-impact-title">
        {isAdviceChange ? en.cloudImpactAdviceChangeTitle : en.cloudImpactLimitingTitle}
      </h2>
      {isAdviceChange ? (
        <>
          <p className="cloud-impact-headline">{en.cloudImpactAdviceChangeBody(forecastLabel, clearLabel)}</p>
          <p className="cloud-impact-note">{en.cloudImpactAdviceChangeNote}</p>
        </>
      ) : (
        <p className="cloud-impact-headline">{en.cloudImpactLimitingBody(forecastLabel, clearLabel)}</p>
      )}
    </section>
  );
}
