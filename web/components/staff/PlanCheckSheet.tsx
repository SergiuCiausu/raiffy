"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { BadgeCheckIcon, CheckIcon, ClockIcon, InfoIcon, MinusIcon, PencilLineIcon, TriangleAlertIcon, Undo2Icon, XIcon } from "lucide-react";
import { lei2 } from "@/lib/plan-view";
import { PLAN_CHECK_ERRORS, planCheckApi, type AutomaticCheck, type PlanCheckStatus } from "@/lib/plan-check-api";
import type { PlanSummary } from "../../../lib/plan/schemas";
import { Sheet } from "./Sheet";

/*
 * One plan check from the review queue (console.html pagePlan, as a sheet): the plan version the customer sent, with
 * its figures, commissions, schedule and sources, then confirm or send back. The figures are the server's; the
 * specialist confirms the information, not a credit decision.
 */

export const PLAN_CHECK_STATUS: Record<PlanCheckStatus, ReactNode> = {
  open: <span className="pill amber"><ClockIcon aria-hidden="true" />Open</span>,
  confirmed: <span className="pill ok"><BadgeCheckIcon aria-hidden="true" />Confirmed</span>,
  corrected: <span className="pill ok"><PencilLineIcon aria-hidden="true" />Corrected</span>,
  returned: <span className="pill line"><Undo2Icon aria-hidden="true" />Sent back</span>,
};

const COMMISSION: Record<string, string> = {
  origination_fee: "Analysis fee", administration_fee: "Administration fee", account_package: "Account package",
  insurance: "Insurance", early_repayment_fee: "Early repayment fee",
};
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** The check's title and explanation, from lib/plan/checks.ts keys. */
function checkText(c: AutomaticCheck): [string, string] {
  const p = c.params ?? {};
  switch (c.detail) {
    case "schedule_matches": return ["Matches the calculator to the ban", `The schedule adds up to ${lei2(Number(p.total))}, the principal to ${lei2(Number(p.amount))}.`];
    case "invariants_failed": return ["The figures don’t add up", `Failed: ${p.failed}. Send it back; the plan has to be rebuilt.`];
    case "current": return ["Catalog values are current", `All ${p.count} values the plan used are unchanged and within their review date.`];
    case "changed_since": return ["Catalog changed since this plan", `${p.terms} changed after the plan was built. Send it back so the customer rebuilds it.`];
    case "review_lapsed": return ["A catalog value is past its review date", `${p.terms}. Re-confirm it in Products before relying on it.`];
    case "cited_page": return ["Not from the reviewed catalog", `The rate and fees were cited from ${host(String(p.url))} on ${day(String(p.citedAt))}. Check them against that page.`];
    case "not_checked": return ["Affordability not checked", "The customer hasn’t shared their income in this chat."];
    case "no_ceiling": return [`Debt share ${pct(Number(p.debtShareBps))}`, "The catalog has no debt-share limit for this product to compare it with."];
    case "above_ceiling": return [`Debt share ${pct(Number(p.debtShareBps))}, above the ${pct(Number(p.ceilingBps))} limit`, "Above the bank’s stated limit for this product."];
    case "within_ceiling": return [`Debt share ${pct(Number(p.debtShareBps))}, within the ${pct(Number(p.ceilingBps))} limit`, "From the income and other debts the customer stated."];
    case "rate_set_by_bank": return ["The rate is a range", `The bank sets the customer’s rate between ${pct(Number(p.minBps))} and ${pct(Number(p.maxBps))}. The plan uses the highest.`];
    default: return [c.key, c.detail];
  }
}

function Checks({ checks }: { checks: AutomaticCheck[] }) {
  const passing = checks.filter((c) => c.status !== "fail").length;
  return (
    <section className="card" aria-labelledby="pc-checks">
      <div className="card-h"><h3 id="pc-checks">Automatic checks</h3><span className="micro">{passing} of {checks.length} pass or need a look</span></div>
      <div className="checks">{checks.map((c) => {
        const [title, why] = checkText(c);
        const Icon = c.status === "pass" ? CheckIcon : c.status === "warn" ? MinusIcon : XIcon;
        return <div key={c.key} className={`chk ${c.status}`}><span className="dot" aria-hidden="true"><Icon /></span>
          <div><b>{title}<span className="sr-only"> ({c.status})</span></b><small>{why}</small></div></div>;
      })}</div>
    </section>
  );
}

const SKIPPED: Record<string, string> = { off: "e-mail is off here", not_configured: "no sender set", no_address: "no address on file", not_decided: "not decided yet" };
/** Each e-mail, as a short label: never the address. */
function emailOutcome(e: { kind: "received" | "decided"; outcome: "sent" | "test" | "skipped"; reason: string | null }) {
  const what = e.kind === "received" ? "Confirmation" : "Reply";
  return e.outcome === "sent" ? `${what} sent` : e.outcome === "test" ? `${what} to test inbox` : `${what} not sent: ${SKIPPED[e.reason ?? ""] ?? e.reason}`;
}

function commissionAmount(c: PlanSummary["figures"]["commissions"][number]) {
  if (c.basis === "missing") return "Not confirmed";
  if (c.basis === "if_used") return "If used";
  if (!c.amount) return "None";
  return `${lei2(c.amount)}${c.frequency === "monthly" ? " a month" : ""}`;
}

function PlanDoc({ plan }: { plan: PlanSummary }) {
  const [all, setAll] = useState(false);
  const f = plan.figures, range = plan.terms.rateRange, low = f.atLowest;
  const rows = all ? plan.repaymentSchedule : plan.repaymentSchedule.slice(0, 6);
  const main: [string, string][] = [
    ["Amount", lei2(plan.goal.amount)],
    ["Term", `${plan.goal.termMonths} months, monthly`],
    ["Rate", `${range ? `${pct(range.minBps)} – ${pct(range.maxBps)}` : pct(plan.terms.annualRateBps)}${plan.terms.rateType === "fixed" ? " fixed" : ", assumed constant"}`],
    ["Monthly payment", low ? `${lei2(low.monthly)} – ${lei2(f.monthly)}` : lei2(f.monthly)],
    ["Total payable", low ? `${lei2(low.total)} – ${lei2(f.total)}` : lei2(f.total)],
    ["DAE", low ? `${(low.dae * 100).toFixed(2)}% – ${(f.dae * 100).toFixed(2)}%` : `${(f.dae * 100).toFixed(2)}%`],
  ];
  return (
    <div className="doc">
      <p className="doc-label"><InfoIcon aria-hidden="true" />Indicative simulation: not a firm credit offer. The bank issues the official offer and contract in Smart Mobile.</p>
      {plan.figuresFrom === "cited_page" && <p className="access"><TriangleAlertIcon aria-hidden="true" />Not from the reviewed catalog: the rate and fees were cited from {host(plan.sources[0]!.url)} in the chat on {day(plan.sources[0]!.collectedAt)}. Check them against that page before confirming.</p>}
      <div><h3>Goal</h3><p>{plan.goal.summary} · <b>{plan.goal.product}</b></p></div>
      <div><h3>Main features</h3><div className="doc-grid">{main.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
        {range && <p className="micro">The bank sets the customer’s rate within this range. The schedule below uses the highest rate.</p>}</div>
      <div><h3>All commissions</h3><div className="lines">{f.commissions.map((c) => (
        <div key={c.key} className="ln"><span>{COMMISSION[c.key] ?? c.key}{c.conditions[0] && <small>{c.conditions[0]}</small>}</span><span className="amt">{commissionAmount(c)}</span></div>
      ))}</div></div>
      <div><h3>Indicative repayment schedule</h3>
        <div className="lines" style={{ overflowX: "auto" }}><table className="tbl sched">
          <thead><tr><th>Date</th><th className="r">Principal</th><th className="r">Interest</th><th className="r">Fees</th><th className="r">Balance</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.n}><td>{day(r.date)}</td><td className="r">{lei2(r.principal)}</td><td className="r">{lei2(r.interest)}</td><td className="r">{lei2(r.fees)}</td><td className="r">{lei2(r.balance)}</td></tr>)}</tbody>
        </table></div>
        {plan.repaymentSchedule.length > 6 && <button type="button" className="link" onClick={() => setAll(!all)}>{all ? "Show the first 6 rows" : `Show all ${plan.repaymentSchedule.length} rows`}</button>}
      </div>
      <div className="srcs">{[...new Map(plan.sources.map((s) => [s.url, s])).values()].map((s) => (
        <a key={s.url} className="src" href={s.url} target="_blank" rel="noopener noreferrer">{host(s.url)} · {s.reviewBy ? `review by ${day(s.reviewBy)}` : `cited ${day(s.collectedAt)}`}</a>
      ))}</div>
    </div>
  );
}

export function PlanCheckSheet({ checkId, onClose, onDone }: { checkId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const c = useQuery(planCheckApi.get, { checkId });
  const decide = useMutation(planCheckApi.decide);
  const [mode, setMode] = useState<"view" | "correct" | "return">("view");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (decision: "confirm" | "correct" | "return", msg: string) => {
    setBusy(true); setErr(null);
    try { await decide({ checkId, decision, ...(note.trim() ? { note: note.trim() } : {}), ...(decision === "correct" ? { reason: reason.trim() } : {}) }); onDone(msg); }
    catch (x) { setErr((x instanceof ConvexError && PLAN_CHECK_ERRORS[String(x.data)]) || "That didn’t save. Try again."); setBusy(false); }
  };
  const open = c?.status === "open";
  const blocked = !!c && c.checks.some((x) => x.status === "fail");
  const back = <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode("view"); setErr(null); }}>Back</button>;
  const footer = !open ? <button type="button" className="btn btn-dark btn-sm" onClick={onClose}>Close</button>
    : mode === "view" ? <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode("return"); setErr(null); }}><Undo2Icon aria-hidden="true" />Send back</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={blocked} onClick={() => { setMode("correct"); setErr(null); }}><PencilLineIcon aria-hidden="true" />Add a correction</button>
      <button type="button" className="btn btn-dark btn-sm" disabled={busy || blocked} onClick={() => void run("confirm", "Confirmed. The customer sees it on their plan.")}>Confirm plan</button>
    </> : mode === "correct" ? <>{back}
      <button type="button" className="btn btn-dark btn-sm" disabled={busy || !note.trim() || !reason.trim()} onClick={() => void run("correct", "Confirmed with your note. The customer sees it highlighted on their plan.")}>Confirm with correction</button>
    </> : <>{back}
      <button type="button" className="btn btn-dark btn-sm" disabled={busy || !note.trim()} onClick={() => void run("return", "Sent back. The customer sees your reason on their plan.")}>Send back</button>
    </>;

  return (
    <Sheet title={c ? `Plan check · ${c.product}` : "Plan check"} onClose={onClose} footer={footer}>
      <div className="sheet-b">
        {c === undefined ? <p className="empty-row" role="status">Loading the plan…</p> : c === null ? <p className="err">This check isn’t there any more.</p> : <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{PLAN_CHECK_STATUS[c.status]}<span className="micro mono">{c.reference} · {c.planId} v{c.version}</span></div>
          {c.latestVersion > c.version && <p className="access"><TriangleAlertIcon aria-hidden="true" />The customer has rebuilt this plan since (now v{c.latestVersion}). Your decision applies to v{c.version}.</p>}
          {c.note && <div className="note-q"><b>Note from the customer</b>{c.note}</div>}
          {c.emails.length > 0 && <p className="micro">E-mail updates: {c.emails.map(emailOutcome).join(" · ")}</p>}
          <Checks checks={c.checks} />
          <PlanDoc plan={c.plan} />
          {c.customerNote && <div className="note-q"><b>{c.status === "returned" ? "Why it was sent back" : c.status === "corrected" ? "Correction for the customer" : "Specialist note"}{c.decidedBy ? ` · ${c.decidedBy}` : ""}</b>{c.customerNote}</div>}
          {c.reason && <div className="note-q"><b>Why it needed a correction (team only)</b>{c.reason}</div>}
          {open && <div className="field">
            <label htmlFor="pc-note">{mode === "return" ? "Why (the customer reads this)" : mode === "correct" ? "Correction for the customer (shown highlighted on their plan)" : <>Note for the customer <span className="muted">(optional)</span></>}</label>
            <textarea className="textarea" id="pc-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} autoFocus={mode !== "view"} placeholder={mode === "correct" ? "For example: the early repayment fee doesn’t apply in the last 12 months" : undefined} />
            {mode !== "correct" && <small>{blocked && mode === "view" ? "An automatic check fails: send the plan back instead of confirming it." : "Confirming checks the information, not a credit decision."}</small>}
          </div>}
          {open && mode === "correct" && <div className="field">
            <label htmlFor="pc-reason">Why it needed a correction <span className="muted">(team only, for the eval set)</span></label>
            <textarea className="textarea" id="pc-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            <small>The figures stay as built. Your note goes on the plan; the reason never reaches the customer.</small>
          </div>}
          {err && <p className="err" role="alert">{err}</p>}
        </>}
      </div>
    </Sheet>
  );
}
