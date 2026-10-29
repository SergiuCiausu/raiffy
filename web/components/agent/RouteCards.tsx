import type { ReactNode } from "react";
import { CheckIcon, CompassIcon, ScaleIcon, SparklesIcon } from "lucide-react";
import type { RouteCard } from "@/lib/agent-api";

/**
 * The answer's routes side by side (DESIGN.md → Recommendation): every route keeps the same fields, one carries the
 * badge and its reason, and costs say plainly that they aren't verified until the product catalog is connected.
 */
export function RouteCards({ routes, cite, enter }: { routes: RouteCard[]; cite: (id: string) => ReactNode; enter: boolean }) {
  const rec = routes.find((r) => r.recommended);
  return (
    <div className={enter ? "gcard routes-card enter" : "gcard routes-card"}>
      <div className="gc-h"><span><ScaleIcon />{routes.length} routes side by side</span><span className="micro">From dated public pages</span></div>
      <div className="gc-b">
        <ul className="opts text-routes" aria-label="Routes" data-count={routes.length}>
          {routes.map((r) => (
            <li key={r.title} className={r.recommended ? "opt rec" : "opt"}>
              <div className="opt-h">
                <span className="rec-badge" hidden={!r.recommended}><SparklesIcon />Recommended</span>
                {r.title}
              </div>
              {r.summary && <p className="opt-sum">{r.summary}</p>}
              {r.mainRisk && <div className="kv kv-stack"><span>Main risk</span><b>{r.mainRisk}</b></div>}
              <div className="kv"><span>Exact cost</span><b>Not verified here</b></div>
              {r.sourceIds.length > 0 && <div className="opt-src">{r.sourceIds.map(cite)}</div>}
            </li>
          ))}
        </ul>
      </div>
      {rec?.why && (
        <div className="rec-why">
          <div className="rec-why-h"><span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>Why I recommend {rec.title}</div>
          <ul><li><CheckIcon /><span>{rec.why}</span></li></ul>
          <p className="rec-alt">Every route stays open, and the choice is yours.</p>
        </div>
      )}
    </div>
  );
}
