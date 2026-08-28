import { getCloudImpact } from "../lib/uv";
import { en } from "../locales/en";

interface Props {
  totalUv: number;
  clearUv: number;
}

export function CloudImpact({ totalUv, clearUv }: Props) {
  const impact = getCloudImpact(totalUv, clearUv);

  if (impact.tier === "none") return null;

  return (
    <section className="detail-section">
      <h2 className="detail-section-title">{en.cloudImpactTitle}</h2>
      <div className="cloud-impact">
        <div className="cloud-impact-row">
          <div className="cloud-impact-stat">
            <div className="cloud-impact-stat-label">{en.cloudImpactForecastUv}</div>
            <div className="cloud-impact-stat-value">{impact.totalUv.toFixed(1)}</div>
          </div>
          <div className="cloud-impact-stat">
            <div className="cloud-impact-stat-label">{en.cloudImpactClearSkyUv}</div>
            <div className="cloud-impact-stat-value">{impact.clearUv.toFixed(1)}</div>
          </div>
        </div>

        {impact.tier !== "negligible" && impact.percent !== null && (
          <p className={`cloud-impact-note${impact.tier === "large" ? " emphasis" : ""}`}>
            {impact.tier === "modest" && en.cloudImpactModest}
            {impact.tier === "meaningful" && en.cloudImpactMeaningful(Math.round(impact.percent))}
            {impact.tier === "large" && en.cloudImpactLarge(Math.round(impact.percent))}
          </p>
        )}
      </div>
    </section>
  );
}
