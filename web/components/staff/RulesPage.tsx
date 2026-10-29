"use client";

import { useQuery } from "convex/react";
import { LockIcon, ShieldCheckIcon } from "lucide-react";
import { adminApi, type PolicyParameter } from "@/lib/admin-api";
import type { StaffMe } from "./AdminPage";
import { AdminNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";

/*
 * admin.html#rules, read-only, over convex/adminViews.ts rules (lib/agent/rules.ts): the policy values the code uses
 * today and the hard limits with the eval cases that protect them. Editable, dated parameters arrive with versioning.
 */

const num = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
function valueOf(p: PolicyParameter) {
  if (p.unit === "lei") return `${num.format(p.value)} lei`;
  if (p.unit === "percentagePoints") return `+${num.format(p.value)} pp`;
  if (p.unit === "days") return `${num.format(p.value)} days`;
  return `${num.format(p.value)} people`;
}

export function RulesPage({ me }: { me: StaffMe }) {
  const r = useQuery(adminApi.rules, {});

  return (
    <StaffShell logoHref="/admin" nav={<AdminNav current="rules" />} me={{ ...me, initials: initials(me.name) }}
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Rules" }]}>
      <div className="pg-head">
        <div>
          <h2>Rules</h2>
          <p>Two kinds, kept apart on purpose. Parameters are the policy values the code uses. Hard limits are behavior rules in code, each protected by eval cases. Both are read-only here: changing one is a code change until dated, editable parameters arrive.</p>
        </div>
      </div>

      {!r ? <p className="micro" role="status">Loading…</p> : (
        <>
          <section aria-labelledby="prm-h">
            <div className="sec-h"><h3 id="prm-h">Parameters</h3><p>Read from the code that uses them, so this list can’t drift from it.</p></div>
            <div className="gcard">
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th scope="col">Parameter</th><th scope="col" className="r">Value</th><th scope="col">Defined in</th></tr></thead>
                  <tbody>
                    {r.parameters.map((p) => (
                      <tr key={p.id}>
                        <td className="nm"><b>{p.name}</b><small>Used by: {p.usedBy}</small></td>
                        <td className="r mono">{valueOf(p)}</td>
                        <td><span className="pill"><LockIcon aria-hidden="true" />In code</span> <span className="micro mono">{p.definedIn}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="gc-note">Product rates, fees and limits aren’t parameters: they come from the catalog, with a source and review date each. See Products.</div>
            </div>
          </section>

          <section className="sec" aria-labelledby="hl-h">
            <div className="sec-h"><h3 id="hl-h">Hard limits</h3><p>Read-only for everyone. No prompt or form can loosen them.</p></div>
            <div className="gcard">
              <div className="hl-list">
                {r.hardLimits.map((h) => {
                  const cases = h.evals.flatMap((e) => e.ids);
                  return (
                    <div key={h.id} className="hl">
                      <span className="ic"><ShieldCheckIcon aria-hidden="true" /></span>
                      <div>
                        <h4>{h.name} <span className="pill" style={{ verticalAlign: 2 }}><LockIcon aria-hidden="true" />In code</span></h4>
                        <p>{h.text}</p>
                        <p className="micro" style={{ marginTop: 6 }}>Enforced in <span className="mono">{h.enforcedIn.join(", ")}</span></p>
                        <div className="evs" aria-label="Protecting eval cases">
                          {cases.length ? cases.map((id) => <span key={id} className="ev">{id}</span>)
                            : h.evals.length ? h.evals.map((e) => <span key={e.file} className="ev">{e.file.replace(/^evals\//, "")}</span>)
                            : <span className="micro">No eval case yet. Unit tests cover it.</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="gc-note">Eval case IDs are checked against evals/ by a test, so every one listed here exists.</div>
            </div>
          </section>
        </>
      )}
    </StaffShell>
  );
}
