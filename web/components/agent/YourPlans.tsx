"use client";

import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";
import type { Track } from "@/lib/agent-api";
import { lei } from "@/lib/format";
import { lei2 } from "@/lib/plan-view";
import type { MyPlan } from "@/lib/plan-check-api";
import { PlanCheck } from "./PlanCard";

/*
 * "Your plans" (chat.html#plans, /chat/plans): the latest version of every plan the customer built, read from
 * convex/plans.ts `mine`. Not checked yet first, then changed after a check, being checked, and checked. Each row
 * carries the same "Check my plan" panel and status line as the plan card, so the two never disagree.
 */

export type PlanRow = MyPlan & { track: Track };

const built = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
const PILL: Record<MyPlan["state"], [string, string]> = {
  unchecked: ["Not checked", "var(--text-2)"], changed: ["Changed after the check", "var(--amber-ink)"],
  pending: ["Being checked", "var(--amber-ink)"], checked: ["Checked", "var(--ok)"],
};
const CHECKED: Record<string, [string, string]> = {
  confirmed: ["Confirmed", "var(--ok)"], edited: ["Confirmed with a note", "var(--ok)"], returned: ["Sent back", "var(--amber-ink)"],
};
const GROUPS: [MyPlan["state"], string][] = [["unchecked", "Not checked yet"], ["changed", "Changed after a check"], ["pending", "Being checked"], ["checked", "Checked"]];

function Row({ p, title }: { p: PlanRow; title: string | undefined }) {
  const [label, color] = p.state === "checked" ? CHECKED[p.verification.level] ?? PILL.checked : PILL[p.state];
  const monthly = p.monthlyLow !== null ? `${lei(Math.round(p.monthlyLow / 100))} – ${lei(Math.round(p.monthly / 100))}` : lei2(p.monthly);
  return (
    <li className="chk">
      <div className="chk-h">
        <div>
          <b>{p.product} · {lei(p.amount / 100)} over {p.termMonths} months</b>
          <small><span className="ref">{p.planId} · v{p.version}</span> · built {built.format(p.createdAt)}{title ? ` · ${title}` : ""}{p.track === "business" ? " · Business" : ""}</small>
        </div>
        <span className="pill" style={{ ["--c" as string]: color }}>{label}</span>
      </div>
      <p className="plan-row-figs">
        <span>Monthly <b>{monthly}</b></span>
        <span>{p.figuresFrom === "catalog" ? "Rate and fees from the bank’s reviewed catalog" : `Figures cited from ${p.source}, not the reviewed catalog`}</span>
      </p>
      <PlanCheck planId={p.planId} version={p.version} verification={p.verification} latest />
      <div className="plan-row-acts"><Link className="btn btn-ghost btn-sm" href={`/chat?thread=${p.threadId}`}><MessageCircleIcon aria-hidden="true" />Open in the chat</Link></div>
    </li>
  );
}

/** `rows` is undefined while loading. `titles` names each conversation from the sidebar's list. */
export function YourPlans({ rows, titles }: { rows: PlanRow[] | undefined; titles: ReadonlyMap<string, string> }) {
  return (
    <section className="checks" aria-labelledby="title">
      <div className="checks-in">
        <p>Plans you built from a simulation. A specialist can check any of them against the bank’s terms: they confirm the information, not a credit decision.</p>
        {rows === undefined ? <p className="chk-wait" role="status">Loading your plans…</p>
          : rows.length === 0 ? <p className="chk-empty">Plans you build appear here. Ask for a loan simulation, then press “Build my plan” under it.</p>
          : GROUPS.map(([state, label]) => {
            const xs = rows.filter((p) => p.state === state);
            return xs.length > 0 && <div key={state} style={{ display: "grid", gap: 10 }}>
              <span className="grp eyebrow">{label}</span>
              <ul className="chk-list">{xs.map((p) => <Row key={p.planId} p={p} title={titles.get(p.threadId)} />)}</ul>
            </div>;
          })}
      </div>
    </section>
  );
}
