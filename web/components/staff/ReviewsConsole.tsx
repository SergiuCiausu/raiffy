"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { BadgeCheckIcon, GavelIcon, GitPullRequestArrowIcon, HandshakeIcon, LayersIcon, ScaleIcon, ShieldCheckIcon, TrendingUpIcon, UserCheckIcon, XIcon } from "lucide-react";
import { lei } from "@/lib/format";
import { answerCheckStaffApi, pricingApi, type AnswerCheckRow, type ReviewCaseView, type WinRate, type WinRateRow } from "@/lib/agent-api";
import { valueLabel } from "@/lib/admin-api";
import { catalogApi, type CatalogChange } from "@/lib/catalog-api";
import type { Role } from "@/lib/roles";
import { ConsoleNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";
import { AnswerCheckCase, CheckStatus, checkTopic } from "./AnswerCheckCase";
import { CHANGE_STATUS, ChangeSheet } from "./ConsoleProducts";

/*
 * Reviews (console.html#reviews and #reviews/<id>) over Convex: one queue, oldest first, for answers customers asked a
 * specialist to check (AnswerCheckCase) and counter-offer cases, each with its own case page. A counter-offer case
 * shows total cost, the decision and the approval levels. Catalog changes from Products (convex/catalogChanges.ts) wait here
 * too, and open in the same sheet as on the product page. Convex enforces who can decide at which level;
 * an approved price returns to the customer's chat as a personal offer, valid 7 days. Sample pricing in the preview.
 */

const b = (bani: number) => lei(bani / 100);
const pp = (bps: number) => `${(bps / 100).toFixed(2)} pp`;
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Bucharest" });
const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
const LEVELS = [["specialist", "Specialist"], ["branchManager", "Branch manager"], ["pricingCommittee", "Pricing committee"]] as const;
const SOURCE: Record<string, string> = { official_store: "Published offer (sample)", client_secci: "Customer’s SECCI", client_claim: "Typed by the customer, no document" };
const shortId = (id: string) => `R-${id.slice(-4).toUpperCase()}`;
const topic = (c: ReviewCaseView) => `${c.product.replace(/ \(sample pricing\)$/, "")}, ${b(c.amount)} over ${c.months} months`;

function waiting(createdAt: number) {
  const m = Math.max(0, Math.round((Date.now() - createdAt) / 60_000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d`;
}

function Status({ s }: { s: ReviewCaseView["status"] }) {
  return s === "open" ? <span className="pill amber">Open</span>
    : s === "approved" ? <span className="pill ok"><BadgeCheckIcon aria-hidden="true" />Offer approved</span>
    : <span className="pill line">Declined</span>;
}

function overall(k: WinRate) {
  const t = k.byResolution.reduce((a, r) => ({ offered: a.offered + r.offered, accepted: a.accepted + r.accepted, decided: a.decided + r.accepted + r.declined + r.expired,
    gap: a.gap + r.averageGap * r.offered }), { offered: 0, accepted: 0, decided: 0, gap: 0 });
  return { ...t, rate: t.decided ? Math.round((t.accepted / t.decided) * 100) : null, averageGap: t.offered ? Math.round(t.gap / t.offered) : 0 };
}

/* ───────────── Queue ───────────── */

type Kind = "all" | "check" | "offer" | "change";
type Checks = { open: AnswerCheckRow[]; decided: AnswerCheckRow[] };
/** One row of the shared queue; `at` orders it (created while open, decided once closed). */
type QueueRow = { kind: "check" | "offer" | "change"; at: number; row: ReactNode };
type Changes = { pending: CatalogChange[]; decided: CatalogChange[] };

function checkRow(c: AnswerCheckRow): QueueRow {
  return { kind: "check", at: c.status === "open" ? c.createdAt : c.decidedAt ?? c.createdAt, row: (
    <tr key={c.id} className="rowlink">
      <td><Link className="t-main" href={`/console/reviews?check=${c.id}`}>{checkTopic(c)}</Link><span className="t-sub mono">{c.reference}{c.hasNote ? " · with a note" : ""}</span></td>
      <td className="hide-sm"><span className="pill line"><UserCheckIcon aria-hidden="true" />Answer check</span></td>
      <td className="hide-sm"><span className="t-main">{c.track === "business" ? "Business customer" : "Personal customer"}</span><span className="t-sub">Identity hidden</span></td>
      <td>{c.status === "open" ? <><span className="wait">{waiting(c.createdAt)}</span><span className="t-sub">since {when.format(c.createdAt)}</span></>
        : <><span className="t-main">{c.decidedBy ?? "—"}</span><span className="t-sub">{c.decidedAt ? when.format(c.decidedAt) : ""}</span></>}</td>
      <td className="hide-sm"><span className="t-main">Specialist</span><span className="t-sub">{c.status !== "open" ? "Decided" : "You can decide"}</span></td>
      <td><CheckStatus s={c.status} /></td>
    </tr>
  ) };
}

function offerRow(c: ReviewCaseView): QueueRow {
  return { kind: "offer", at: c.createdAt, row: (
    <tr key={c.id} className="rowlink">
      <td><Link className="t-main" href={`/console/reviews?case=${c.id}`}>{topic(c)}</Link><span className="t-sub mono">{shortId(c.id)}</span></td>
      <td className="hide-sm"><span className="pill line"><HandshakeIcon aria-hidden="true" />Counter-offer</span></td>
      <td className="hide-sm"><span className="t-main mono" style={{ fontSize: 12 }}>Sample client</span><span className="t-sub">Segment {c.segment}</span></td>
      <td>{c.status === "open" ? <><span className="wait">{waiting(c.createdAt)}</span><span className="t-sub">since {when.format(c.createdAt)}</span></>
        : <><span className="t-main">{c.decidedBy ?? "—"}</span><span className="t-sub">{c.note ?? "No note"}</span></>}</td>
      <td className="hide-sm"><span className="t-main">{c.levelLabel}</span><span className="t-sub">{c.status !== "open" ? "Decided" : c.canDecide ? "You can decide" : "Above your level"}</span></td>
      <td><Status s={c.status} /></td>
    </tr>
  ) };
}

/** A proposed catalog value (convex/catalogChanges.ts): open until an admin approves or rejects it. */
function changeRow(c: CatalogChange, admin: boolean): QueueRow {
  const open = c.status === "pending";
  return { kind: "change", at: open ? c.proposedAt : c.decidedAt ?? c.proposedAt, row: (
    <tr key={c.changeId} className="rowlink">
      <td><Link className="t-main" href={`/console/reviews?change=${c.changeId}`}>{c.product}: {c.label}</Link>
        <span className="t-sub mono">{c.changeId}{c.kind === "rollback" ? " · rollback" : c.kind === "confirm" ? " · re-confirm" : ""} · {valueLabel(c.before.value, c.unit, null)} → {valueLabel(c.after.value, c.unit, null)}</span></td>
      <td className="hide-sm"><span className="pill line"><GitPullRequestArrowIcon aria-hidden="true" />Catalog change</span></td>
      <td className="hide-sm"><span className="t-main">{c.proposedByName}</span><span className="t-sub">Proposed the change</span></td>
      <td>{open ? <><span className="wait">{waiting(c.proposedAt)}</span><span className="t-sub">since {when.format(c.proposedAt)}</span></>
        : <><span className="t-main">{c.decidedByName ?? "—"}</span><span className="t-sub">{c.decidedAt ? when.format(c.decidedAt) : ""}</span></>}</td>
      <td className="hide-sm"><span className="t-main">Admin</span><span className="t-sub">{!open ? "Decided" : admin ? "You can decide" : "Needs an admin"}</span></td>
      <td>{CHANGE_STATUS[c.status]}</td>
    </tr>
  ) };
}

const KINDS = [["all", "All"], ["check", "Answer checks"], ["offer", "Counter-offers"], ["change", "Catalog changes"]] as const;

function Queue({ reviews, checks, changes, admin, kpi }: { reviews: { open: ReviewCaseView[]; decided: ReviewCaseView[] }; checks: Checks; changes: Changes; admin: boolean; kpi: WinRate }) {
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [kind, setKind] = useState<Kind>("all");
  const open = [...checks.open.map(checkRow), ...reviews.open.map(offerRow), ...changes.pending.map((c) => changeRow(c, admin))].sort((x, y) => x.at - y.at);
  const closed = [...checks.decided.map(checkRow), ...reviews.decided.map(offerRow), ...changes.decided.map((c) => changeRow(c, admin))].sort((x, y) => y.at - x.at);
  const shown = status === "open" ? open : closed;
  const count = (k: Kind) => shown.filter((r) => k === "all" || r.kind === k).length;
  const rows = shown.filter((r) => kind === "all" || r.kind === kind);
  const mine = checks.open.length + reviews.open.filter((c) => c.canDecide).length + (admin ? changes.pending.length : 0);
  const oldest = open.length ? open[0]!.at : null;
  return (
    <>
      <div className="page-head"><div>
        <h1>Reviews</h1>
        <p>What customers sent to a person: answers they asked a specialist to check, and counter-offers Raiffy couldn’t settle inside its band. Also catalog changes waiting for an admin. Oldest first. You confirm information and decide prices, not credit: everything stays indicative until the bank issues it.</p>
      </div></div>

      <div className="kpis kpis-3">
        <div className="kpi"><b>{open.length}</b><span>Open requests</span></div>
        <div className="kpi"><b>{mine}</b><span>At or below your level</span></div>
        <div className="kpi"><b className="mono">{oldest === null ? "–" : waiting(oldest)}</b><span>Oldest waiting</span></div>
      </div>

      <div className="toolbar">
        <div className="chips" role="group" aria-label="Request type">
          {KINDS.map(([k, label]) => <button key={k} type="button" className="qbtn" aria-pressed={kind === k} onClick={() => setKind(k)}>{label} <small>{count(k)}</small></button>)}
        </div>
        <div className="chips" role="group" aria-label="Status">
          <button type="button" className="qbtn" aria-pressed={status === "open"} onClick={() => setStatus("open")}>Open <small>{open.length}</small></button>
          <button type="button" className="qbtn" aria-pressed={status === "closed"} onClick={() => setStatus("closed")}>Closed <small>{closed.length}</small></button>
        </div>
      </div>

      <div className="card"><div className="tbl-wrap"><table className="tbl">
        <thead><tr><th scope="col">Request</th><th scope="col" className="hide-sm">Type</th><th scope="col" className="hide-sm">Client</th><th scope="col">{status === "open" ? "Waiting" : "Closed"}</th><th scope="col" className="hide-sm">Level</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((r) => r.row)
            : <tr><td colSpan={6} className="empty-row">{status === "open" ? "Nothing waiting. New requests from customers appear here." : "Nothing closed yet."}</td></tr>}
        </tbody>
      </table></div></div>

      <WinRateSection kpi={kpi} />
    </>
  );
}

const GROUPS = [["byResolution", "Resolution"], ["byProduct", "Product"], ["byCompetitor", "Competitor"], ["bySegment", "Segment"]] as const;
const RESOLUTION: Record<string, string> = { band: "Inside the band", escalate: "Escalated to a person" };

/* Below the queue: one headline row and one breakdown table with a group-by switch; a single empty state before
   the first counter-offer. The counting rule is one footnote. */
function WinRateSection({ kpi }: { kpi: WinRate }) {
  const [by, setBy] = useState<(typeof GROUPS)[number][0]>("byResolution");
  const all = overall(kpi);
  const rows: WinRateRow[] = kpi[by];
  const extra = [kpi.notNeeded && `${kpi.notNeeded} needed no counter-offer because Raiffeisen already cost less in total`,
    kpi.evidenceNeeded && `${kpi.evidenceNeeded} ${kpi.evidenceNeeded === 1 ? "was a typed claim" : "were typed claims"} without a document`].filter(Boolean);
  return (
    <section id="win-rate" className="wr" aria-labelledby="wr-h">
      <h2 id="wr-h" className="tbl-title">Counter-offer win rate</h2>
      {all.offered === 0 ? (
        <div className="card wr-empty">
          <TrendingUpIcon aria-hidden="true" />
          <div><b>No counter-offers yet</b>
            <p>The win rate starts with Raiffy’s first counter-offer: accepted ÷ decided, for offers inside the band and escalated ones.{extra.length > 0 && ` So far ${extra.join(", and ")}.`}</p></div>
        </div>
      ) : <>
        <div className="kpis">
          <div className="kpi"><b>{all.rate === null ? "–" : `${all.rate}%`}</b><span>Win rate</span></div>
          <div className="kpi"><b>{all.offered}</b><span>Counter-offers made</span></div>
          <div className="kpi"><b>{all.accepted} of {all.decided}</b><span>Accepted of decided</span></div>
          <div className="kpi"><b className="mono">{b(all.averageGap)}</b><span>Average gap to the competitor</span></div>
        </div>
        <div className="wr-grid">
          <div className="card">
            <div className="card-h"><h3>Breakdown</h3>
              <div className="chips" role="group" aria-label="Group by">
                {GROUPS.map(([k, label]) => <button key={k} type="button" className="qbtn" aria-pressed={by === k} onClick={() => setBy(k)}>{label}</button>)}
              </div>
            </div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th scope="col">{GROUPS.find(([k]) => k === by)![1]}</th><th scope="col">Offered</th><th scope="col">Accepted</th><th scope="col">Declined</th><th scope="col">Expired</th><th scope="col">Win rate</th><th scope="col">Average gap</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.key}><td><span className="t-main">{by === "byResolution" ? RESOLUTION[r.key] ?? r.key : r.key}</span></td><td className="mono">{r.offered}</td><td className="mono">{r.accepted}</td>
                  <td className="mono">{r.declined}</td><td className="mono">{r.expired}</td><td className="mono">{r.winRate === null ? "–" : `${Math.round(r.winRate * 100)}%`}</td><td className="mono">{b(r.averageGap)}</td></tr>
              ))}</tbody>
            </table></div>
            <p className="wr-note">Accepted ÷ decided.{extra.length > 0 && ` ${extra.join("; ")}.`} Outcomes are simulated until the official application flow exists. No customer identity here.</p>
          </div>
          <div className="card">
            <div className="card-h"><h3>Why customers said no</h3></div>
            {kpi.reasonsLost.length === 0 ? <p className="wr-none">No declines yet.</p>
              : <div className="facts">{kpi.reasonsLost.map(([k, n]) => <div className="fact" key={k}><span>{k[0]!.toUpperCase() + k.slice(1)}</span><b className="mono">{n}</b></div>)}</div>}
          </div>
        </div>
      </>}
    </section>
  );
}

/* ───────────── Case ───────────── */

function Decision({ c }: { c: ReviewCaseView }) {
  const decide = useMutation(pricingApi.decideReview);
  const [mode, setMode] = useState<"approve" | "decline">("approve");
  const [rate, setRate] = useState("");
  const [waive, setWaive] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [valid] = useState(() => new Date(Date.now() + 7 * 864e5));

  if (c.status !== "open") {
    return c.status === "approved"
      ? <div className="decide"><div className="sign"><BadgeCheckIcon aria-hidden="true" /><span><b>Approved by {c.decidedBy ?? "a specialist"}</b>. Sent back to the chat as a personal offer, valid 7 days.{c.note && ` “${c.note}”`} Still indicative until the bank issues it.</span></div></div>
      : <div className="decide"><div className="sign" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}><XIcon aria-hidden="true" /><span><b>Declined by {c.decidedBy ?? "a specialist"}</b>.{c.note && ` “${c.note}”`} The chat keeps the customer’s current price.</span></div></div>;
  }
  if (!c.canDecide) {
    return <div className="decide"><p style={{ fontSize: 13 }}>This gap needs <b>{c.levelLabel}</b> approval, above your level. It stays in the queue for someone who can decide it.</p></div>;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const rateBps = Math.round(Number(rate.replace(",", ".")) * 100);
    if (mode === "approve" && (!rate.trim() || !Number.isFinite(rateBps) || rateBps <= 0)) { setError("Enter the approved rate, for example 5.65."); return; }
    if (mode === "decline" && !note.trim()) { setError("Give the customer a reason in plain words."); return; }
    setBusy(true); setError(null);
    try { await decide({ caseId: c.id, decision: mode, ...(mode === "approve" ? { rateBps, waiveFee: waive } : {}), ...(note.trim() ? { note: note.trim() } : {}) }); }
    catch { setError("That didn’t save. The rate may be outside the allowed range, or the case was decided by someone else."); }
    finally { setBusy(false); }
  };

  return (
    <form className="decide" onSubmit={submit} noValidate>
      <div className="radio-row" role="radiogroup" aria-label="Decision">
        {([["approve", "Approve a price", "Returns to the chat as a personal offer with your name and an expiry"], ["decline", "Decline with a reason", "The chat keeps the customer’s current price"]] as const).map(([v, label, sub]) => (
          <label className="radio" key={v}><input type="radio" name={`mode-${c.id}`} value={v} checked={mode === v} onChange={() => { setMode(v); setError(null); }} /><span>{label}<small>{sub}</small></span></label>
        ))}
      </div>
      {mode === "approve" ? <>
        <div className="row2">
          <div className="field"><label htmlFor={`rate-${c.id}`}>Rate (fixed, %)</label>
            <input className="input mono" id={`rate-${c.id}`} inputMode="decimal" placeholder="5.65" value={rate} onChange={(e) => setRate(e.target.value)} aria-invalid={!!error && mode === "approve"} />
            <small>{c.neededCutBps === null ? "No cut inside the bands closes this gap." : `Cut needed to match: about ${pp(c.neededCutBps)} below the customer’s price.`}</small></div>
          <div className="field"><span className="lbl">Validity</span><b style={{ fontSize: 13.5, fontWeight: 500, lineHeight: "36px" }}>7 days · until {day(valid)}</b></div>
        </div>
        <label className="check"><input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} /><span><b style={{ color: "var(--text-1)", fontWeight: 500 }}>Waive the upfront fee</b><br />Shown on the offer card as what changed.</span></label>
        <div className="field"><label htmlFor={`note-${c.id}`}>Note for the audit (optional)</label><textarea className="textarea" id={`note-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </> : (
        <div className="field"><label htmlFor={`note-${c.id}`}>Reason, shown to the customer in plain words</label>
          <textarea className="textarea" id={`note-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!error && mode === "decline"} /></div>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-dark btn-sm" disabled={busy}>{mode === "decline" ? <><XIcon aria-hidden="true" />Decline</> : <><BadgeCheckIcon aria-hidden="true" />Approve offer</>}</button>
        <span className="scope-note" style={{ alignSelf: "center" }}>Never promise to match. The price stays indicative until the bank issues it.</span>
      </div>
    </form>
  );
}

function CaseView({ c, kpi }: { c: ReviewCaseView; kpi: WinRate }) {
  const gap = c.ourTotal - c.competitor.totalPayable;
  const all = overall(kpi);
  const reqRank = LEVELS.findIndex(([k]) => k === c.level);
  return (
    <>
      <div className="page-head">
        <div><span className="eyebrow">Counter-offer · {shortId(c.id)}</span><h1 style={{ marginTop: 6 }}>{topic(c)}</h1></div>
        <Status s={c.status} />
      </div>
      <div className="ws" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 300px)" }}>
        <div className="col">
          <div className="access"><ShieldCheckIcon aria-hidden="true" /><span>Access logged · above the pre-approved band. Sample client {c.segment}; no identity is shown here.</span></div>
          <section className="card" aria-labelledby={`tc-${c.id}`}>
            <div className="card-h"><h2 id={`tc-${c.id}`}><ScaleIcon aria-hidden="true" />Total cost, same amount and term</h2><span className="micro mono">{b(c.amount)} · {c.months} months</span></div>
            <div className="tbl-wrap"><div className="co-grid">
              <div className="th" />
              <div className="th">{c.competitor.bank}<small>{SOURCE[c.competitor.source] ?? c.competitor.source}</small></div>
              <div className="th you">Raiffeisen<small>The customer’s price today</small></div>
              <div className="th">Difference<small>Raiffeisen minus {c.competitor.bank.replace(/ \(sample\)$/, "")}</small></div>
              <div className="rk"><b>Total payable</b></div>
              <div className="mono">{b(c.competitor.totalPayable)}</div>
              <div className="you mono">{b(c.ourTotal)}</div>
              <div className="mono">{gap >= 0 ? `${b(gap)} more` : `${b(-gap)} less`}</div>
              <div className="rk">Cut needed</div>
              <div className="muted">—</div>
              <div className="you mono">{c.neededCutBps === null ? "Beyond the bands" : pp(c.neededCutBps)}</div>
              <div className="muted">—</div>
            </div></div>
          </section>
          <section className="card" aria-labelledby={`dc-${c.id}`}>
            <div className="card-h"><h2 id={`dc-${c.id}`}><GavelIcon aria-hidden="true" />Decision</h2></div>
            <Decision c={c} />
          </section>
        </div>
        <div className="col">
          <section className="card" aria-labelledby={`lv-${c.id}`}>
            <div className="card-h"><h3 id={`lv-${c.id}`}><LayersIcon aria-hidden="true" />Approval levels</h3><span className="pill line">Internal</span></div>
            <div className="card-b lvl" style={{ padding: 16 }}>
              {LEVELS.map(([k, label], i) => (
                <div key={k} className={k === c.level ? "lvl-row req" : "lvl-row"}><i /><span>{label}</span><span className="mono">{i === reqRank ? "Needed" : i > reqRank ? "Can approve" : ""}</span></div>
              ))}
              <p className="micro" style={{ marginTop: 6 }}>Operators decide at specialist level, admins at any level. Limits are never shown to the customer.</p>
            </div>
          </section>
          <section className="card" aria-labelledby={`wr-${c.id}`}>
            <div className="card-h"><h3 id={`wr-${c.id}`}><TrendingUpIcon aria-hidden="true" />Counter-offers so far</h3></div>
            <div className="facts">
              <div className="fact"><span>Offered</span><b className="mono">{all.offered}</b></div>
              <div className="fact"><span>Decided by the customer</span><b className="mono">{all.decided}</b></div>
              <div className="fact"><span>Win rate</span><b className="mono">{all.rate === null ? "–" : `${all.rate}%`}</b>
                <span className="sub">Accepted {all.accepted} of {all.decided}. Outcomes are simulated in the preview.</span></div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/* ───────────── Page ───────────── */

export function ReviewsConsole({ me }: { me: { name: string; role: Role } }) {
  const params = useSearchParams();
  const caseId = params.get("case");
  const checkId = params.get("check");
  const router = useRouter();
  const changeId = params.get("change");
  const reviews = useQuery(pricingApi.listReviews, {});
  const pendingChanges = useQuery(catalogApi.pending, {});
  const decidedChanges = useQuery(catalogApi.decided, {});
  const change = changeId ? [...(pendingChanges ?? []), ...(decidedChanges ?? [])].find((c) => c.changeId === changeId) : undefined;
  const closeChange = () => router.replace("/console/reviews", { scroll: false });
  const checks = useQuery(answerCheckStaffApi.list, {});
  const kpi = useQuery(pricingApi.winRate, {});
  const current = caseId ? [...(reviews?.open ?? []), ...(reviews?.decided ?? [])].find((c) => c.id === caseId) : undefined;
  // Only ids from the queue reach the case query, so a hand-typed URL can't send it a malformed id
  const currentCheck = checkId ? [...(checks?.open ?? []), ...(checks?.decided ?? [])].find((c) => c.id === checkId) : undefined;
  const open = (reviews?.open.length ?? 0) + (checks?.open.length ?? 0) + (pendingChanges?.length ?? 0);
  const onCase = !!(caseId || checkId);

  const nav = <ConsoleNav current={onCase ? null : "reviews"} due={{ reviews: open }} />;
  const caseLabel = current ? shortId(current.id) : currentCheck ? currentCheck.reference : "Case";
  const crumbs = [{ label: "Console", href: "/console" }, ...(onCase ? [{ label: "Reviews", href: "/console/reviews" }, { label: caseLabel }] : [{ label: "Reviews" }])];
  const title = me.role === "admin" ? "Admin" : "Operator";

  return (
    <StaffShell logoHref="/console" nav={nav} me={{ name: me.name, title, initials: initials(me.name) }} crumbs={crumbs}
      top={<span className="pill line" title="Pricing, competitors and customers are sample data">Sample pricing</span>}>
      {!reviews || !checks || !kpi || !pendingChanges || !decidedChanges ? <p className="empty-row" role="status">Loading reviews…</p>
        : caseId && !current ? <p className="empty-row">That case isn’t in the last 50. <Link href="/console/reviews">Back to the queue</Link></p>
        : checkId && !currentCheck ? <p className="empty-row">That check isn’t in the last 50. <Link href="/console/reviews">Back to the queue</Link></p>
        : current ? <CaseView c={current} kpi={kpi} />
        : currentCheck ? <AnswerCheckCase row={currentCheck} />
        : <Queue reviews={reviews} checks={checks} changes={{ pending: pendingChanges, decided: decidedChanges }} admin={me.role === "admin"} kpi={kpi} />}
      {change && !onCase && <ChangeSheet key={change.changeId} c={change} me={me} onClose={closeChange} onDone={closeChange} />}
    </StaffShell>
  );
}
