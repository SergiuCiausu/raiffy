"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  ArrowRightIcon, CheckIcon, ClockAlertIcon, ClockIcon, FileTextIcon, HistoryIcon, InfoIcon, PencilIcon, SearchIcon,
  TriangleAlertIcon, Undo2Icon,
} from "lucide-react";
import { adminApi, day, KIND_LABEL, TRACK_LABEL, USE_LABEL, valueLabel, type ProductRow, type TermView } from "@/lib/admin-api";
import {
  catalogApi, CHANGE_ERRORS, formOf, quoteShowsValue, UNIT_HINT, valueOf, type CatalogChange, type ChangeStatus, type Snapshot, type ValueForm,
} from "@/lib/catalog-api";
import type { Role } from "@/lib/roles";
import { Sheet } from "./Sheet";
import { ConsoleNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";

/*
 * Products in the console (console.html#products and #products/<id>) over the imported catalog (convex/adminViews.ts)
 * and its changes (convex/catalogChanges.ts). Anyone in the console can propose a new value or re-confirm one with a
 * fresh source; an admin's change publishes at once, an operator's waits for an admin on the product page. Published
 * values go straight into what the chat quotes. Diffs use the ink-and-highlight style, never red and green.
 */

type Me = { name: string; role: Role };
const isAdmin = (me: Me) => me.role === "admin";
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const errorText = (e: unknown) => (e instanceof ConvexError && typeof e.data === "string" && CHANGE_ERRORS[e.data]) || "That didn’t work. Try again in a moment.";
export const productHref = (id: string) => `/console/products/${encodeURIComponent(id)}`;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => isoDay(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000);

export const CHANGE_STATUS: Record<ChangeStatus, ReactNode> = {
  pending: <span className="pill amber">Pending approval</span>,
  published: <span className="pill ok"><CheckIcon aria-hidden="true" />Published</span>,
  rejected: <span className="pill line">Rejected</span>,
  rolledBack: <span className="pill line">Rolled back</span>,
};
const KIND: Record<CatalogChange["kind"], string> = { edit: "Changed", confirm: "Re-confirmed", rollback: "Rolled back" };

function Shell({ me, crumbs, pending, children }: { me: Me; crumbs: { label: string; href?: string }[]; pending?: number; children: ReactNode }) {
  return (
    <StaffShell logoHref="/console" nav={<ConsoleNav current="products" due={pending ? { reviews: pending } : {}} />}
      me={{ name: me.name, title: isAdmin(me) ? "Admin" : "Operator", initials: initials(me.name) }} crumbs={crumbs}>
      {children}
    </StaffShell>
  );
}

function useToast(): [string | null, (m: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  return [toast, setToast];
}
const Toast = ({ text }: { text: string | null }) => <div className="toast" role="status" hidden={!text}>{text && <><CheckIcon aria-hidden="true" />{text}</>}</div>;

function ReviewPill({ reviewBy, review }: { reviewBy: string; review: TermView["review"] }) {
  if (review === "stale") return <span className="pill bad"><ClockAlertIcon aria-hidden="true" />Past review date · {day(reviewBy)}</span>;
  if (review === "due") return <span className="pill amber"><ClockIcon aria-hidden="true" />Review by {day(reviewBy)}</span>;
  return <span>Review by {day(reviewBy)}</span>;
}

/* ───────────── List ───────────── */

type Filter = "all" | "personal" | "business" | "review" | "pending";
const needsReview = (p: ProductRow) => p.review.stale + p.review.due + p.review.unreviewed > 0;

export function ProductsConsole({ me }: { me: Me }) {
  const router = useRouter();
  const rows = useQuery(adminApi.products, {});
  const pending = useQuery(catalogApi.pending, {});
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const pendingBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of pending ?? []) m.set(c.productId, (m.get(c.productId) ?? 0) + 1);
    return m;
  }, [pending]);
  const withValues = (rows ?? []).filter((p) => p.review.terms > 0);
  const match = (p: ProductRow, f: Filter) => f === "all" || (f === "review" ? needsReview(p) : f === "pending" ? pendingBy.has(p.productId) : p.track === f);
  const needle = q.trim().toLowerCase();
  const list = withValues.filter((p) => match(p, filter) && (!needle || p.product.toLowerCase().includes(needle)))
    .sort((a, b) => Number(pendingBy.has(b.productId)) - Number(pendingBy.has(a.productId)) || Number(needsReview(b)) - Number(needsReview(a)) || a.product.localeCompare(b.product));

  return (
    <Shell me={me} crumbs={[{ label: "Console", href: "/console" }, { label: "Products" }]} pending={pending?.length}>
      <div className="page-head"><div>
        <h1>Products</h1>
        <p>Raiffeisen’s products as Raiffy quotes them. Every value has its source and a review date, and answers use only values a person has published. {isAdmin(me) ? "Your changes publish at once." : "Your changes go to an admin for approval."}</p>
      </div></div>
      {!rows || !pending ? <p className="empty-row" role="status">Loading products…</p> : (
        <>
          <div className="toolbar">
            <div className="chips" role="group" aria-label="Filter products">
              {([["all", "All"], ["personal", "Individuals"], ["business", "Business"], ["review", "Needs review"], ["pending", "Pending approval"]] as const).map(([k, l]) => (
                <button key={k} type="button" className="qbtn" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} <small>{withValues.filter((p) => match(p, k)).length}</small></button>
              ))}
            </div>
            <label className="search" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <SearchIcon aria-hidden="true" width={14} height={14} />
              <span className="sr-only">Search products</span>
              <input className="input" type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 32 }} />
            </label>
          </div>
          <div className="card"><div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Product</th><th>Rate</th><th>Values</th><th>Status</th><th>Review</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const n = pendingBy.get(p.productId) ?? 0;
                return (
                  <tr key={p.productId} className="rowlink" onClick={() => router.push(productHref(p.productId))}>
                    <td><Link className="t-main" href={productHref(p.productId)}>{p.product}</Link><span className="t-sub">{KIND_LABEL[p.kind] ?? p.kind}{p.track ? ` · ${TRACK_LABEL[p.track]}` : ""}</span></td>
                    <td className="mono">{p.headline ? valueLabel(p.headline.value, p.headline.unit, p.headline.frequency) : <span className="muted">—</span>}</td>
                    <td><span className="mono">{p.review.usable}/{p.review.terms}</span><span className="t-sub">usable in answers</span></td>
                    <td>{n ? <span className="pill amber">{n} pending</span> : <span className="pill ok">Published</span>}</td>
                    <td>{p.review.stale ? <span className="pill bad"><ClockAlertIcon aria-hidden="true" />{p.review.stale} past review</span>
                      : p.review.due || p.review.unreviewed ? <span className="pill amber"><ClockIcon aria-hidden="true" />{p.review.due + p.review.unreviewed} to review</span>
                      : <span className="muted" style={{ fontSize: 12 }}>Up to date</span>}</td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={5} className="empty-row">No products match.</td></tr>}
            </tbody>
          </table></div></div>
        </>
      )}
    </Shell>
  );
}

/* ───────────── Product ───────────── */

const GROUPS: { key: string; title: string; kinds: TermView["kind"][] }[] = [
  { key: "rates", title: "Rates", kinds: ["interest_rate", "dae"] },
  { key: "fees", title: "Fees and commissions", kinds: ["fee"] },
  { key: "limits", title: "Amount and term", kinds: ["limit", "term"] },
  { key: "conditions", title: "Eligibility, documents and benefits", kinds: ["eligibility", "document", "benefit"] },
];

function Diff({ before, after, unit }: { before: Snapshot; after: Snapshot; unit: TermView["unit"] }) {
  const a = valueLabel(before.value, unit, null), b = valueLabel(after.value, unit, null);
  return <span className="vdiff">{a === b ? <>{b}<small className="muted" style={{ fontFamily: "var(--font-sans)", fontSize: 11.5 }}>same value</small></> : <><del>{a}</del><ArrowRightIcon aria-hidden="true" /><ins>{b}</ins></>}</span>;
}

function ValueRow({ t, pending, onEdit, onView }: { t: TermView; pending: CatalogChange | undefined; onEdit: () => void; onView: () => void }) {
  const attention = t.use !== "usable" || t.review !== "ok";
  return (
    <div className={`dv${t.review === "stale" ? " is-stale" : ""}${pending ? " is-pending" : ""}`}>
      <div className="dv-name"><b>{t.label}</b>{t.conditions.length > 0 && <small>{t.conditions.join(" · ")}</small>}</div>
      <div className="dv-val">{valueLabel(t.value, t.unit, t.frequency)}
        {pending && <small>Pending: {valueLabel(pending.after.value, t.unit, t.frequency)} · {pending.proposedByName}</small>}
      </div>
      <div className="dv-meta">
        <a className="src" href={t.url} target="_blank" rel="noopener noreferrer"><FileTextIcon aria-hidden="true" />{host(t.url)}</a>
        <ReviewPill reviewBy={t.reviewBy} review={t.review} />
        {t.use === "usable" ? <span>Used in answers</span> : <span className="pill amber">{USE_LABEL[t.use]}</span>}
      </div>
      <div className="dv-act">
        {pending ? <button type="button" className="btn btn-ghost btn-xs" onClick={onView}>View</button>
          : <button type="button" className="btn btn-ghost btn-xs" onClick={onEdit} aria-label={`${attention ? "Review" : "Edit"} ${t.label}`}>{attention ? "Review" : <><PencilIcon aria-hidden="true" />Edit</>}</button>}
      </div>
    </div>
  );
}

function EditSheet({ t, me, onClose, onDone }: { t: TermView; me: Me; onClose: () => void; onDone: (msg: string) => void }) {
  const propose = useMutation(catalogApi.propose);
  const [today] = useState(() => isoDay(Date.now()));
  const [form, setForm] = useState<ValueForm>(() => formOf(t.value, t.unit));
  const [quote, setQuote] = useState(t.quote.trim());
  const [url, setUrl] = useState(t.url);
  const [reviewBy, setReviewBy] = useState(t.reviewBy > addDays(today, 30) ? t.reviewBy : addDays(today, 90));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = valueOf(form, t.unit);
  const quoteOk = !value || quoteShowsValue(value, t.unit, quote);
  const numeric = form.type !== "text";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value) { setErr(CHANGE_ERRORS.value_invalid!); return; }
    setBusy(true); setErr(null);
    try {
      const r = await propose({ termId: t.termId, value, quote, url: url.trim(), reviewBy, note });
      onDone(r.status === "published" ? "Published. Answers use the new value from now on." : "Sent for approval. An admin publishes it.");
    } catch (x) { setErr(errorText(x)); setBusy(false); }
  };
  const field = (k: "a" | "b", label: string) => (
    <div className="field"><label htmlFor={`ed-${k}`}>{label}</label>
      <input className="input mono" id={`ed-${k}`} inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} aria-invalid={!value && !!form[k]} />
      <small>{UNIT_HINT[t.unit]}</small></div>
  );

  return (
    <Sheet title={`Edit · ${t.label}`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      <button type="submit" form="ed-form" className="btn btn-dark btn-sm" disabled={busy}>{isAdmin(me) ? "Publish" : "Submit for approval"}</button>
    </>}>
      <form className="sheet-b" id="ed-form" noValidate onSubmit={submit}>
        <div className="field"><span className="lbl">Now</span>
          <span className="vdiff">{valueLabel(t.value, t.unit, t.frequency)}<small className="muted" style={{ fontFamily: "var(--font-sans)", fontSize: 11.5 }}>{USE_LABEL[t.use]} · {host(t.url)}</small></span></div>
        <div className="field"><label htmlFor="ed-type">Kind of value</label>
          <select className="select" id="ed-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ValueForm["type"] })}>
            <option value="exact">Exact</option><option value="range">Range</option><option value="from">From (a starting value)</option>
            <option value="up_to">Up to (a ceiling)</option><option value="text">Text</option>
          </select></div>
        {form.type === "text"
          ? <div className="field"><label htmlFor="ed-text">Value</label><textarea className="textarea" id="ed-text" value={form.text} maxLength={300} onChange={(e) => setForm({ ...form, text: e.target.value })} /></div>
          : form.type === "range" ? <div className="row2">{field("a", "From")}{field("b", "To")}</div>
          : <div className="row2">{field("a", "New value")}<div /></div>}
        <div className="field"><label htmlFor="ed-quote">Words from the source</label>
          <textarea className="textarea" id="ed-quote" value={quote} maxLength={500} onChange={(e) => setQuote(e.target.value)} aria-describedby="ed-quote-h" />
          <small id="ed-quote-h">Required. The exact sentence that states this value, as the source writes it.</small>
          {numeric && value && !quoteOk && <small style={{ color: "#7A5A00" }}><TriangleAlertIcon aria-hidden="true" width={12} height={12} style={{ verticalAlign: -2 }} /> These words don’t show the new figure. Readers can’t check it against the source.</small>}
        </div>
        <div className="row2">
          <div className="field"><label htmlFor="ed-url">Source link</label><input className="input" id="ed-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
          <div className="field"><label htmlFor="ed-review">Review by</label><input className="input mono" id="ed-review" type="date" min={addDays(today, 1)} max={addDays(today, 730)} value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} />
            <small>Past this date, answers stop using the value.</small></div>
        </div>
        <div className="field"><label htmlFor="ed-note">Note <span className="muted">(optional)</span></label>
          <textarea className="textarea" id="ed-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: November rate sheet, agreed at ALCO" /></div>
        {value && <div className="field"><span className="lbl">Change</span><Diff before={{ value: t.value, quote: t.quote, url: t.url, reviewBy: t.reviewBy }} after={{ value, quote, url, reviewBy }} unit={t.unit} /></div>}
        <p className="note-q" style={{ fontSize: 12.5 }}><InfoIcon aria-hidden="true" /> Once published, answers about {t.label.toLowerCase()} quote this value with its source. Keeping the same value with a fresh source and review date re-confirms it.</p>
        {err && <p className="err" role="alert">{err}</p>}
      </form>
    </Sheet>
  );
}

/** One catalog change: its diff and source, and approve, reject or roll back. Opened from a product or from the review queue. */
export function ChangeSheet({ c, me, onClose, onDone }: { c: CatalogChange; me: Me; onClose: () => void; onDone: (msg: string) => void }) {
  const approve = useMutation(catalogApi.approve);
  const reject = useMutation(catalogApi.reject);
  const rollBack = useMutation(catalogApi.rollBack);
  const [mode, setMode] = useState<"view" | "reject" | "rollback">("view");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setErr(null);
    try { await fn(); onDone(msg); } catch (x) { setErr(errorText(x)); setBusy(false); }
  };
  const decide = c.status === "pending" && isAdmin(me);
  const canRoll = c.status === "published" && c.latest;
  const facts: [string, ReactNode][] = [
    ["Proposed", `${day(c.proposedAt)} · ${c.proposedByName}`],
    ...(c.decidedAt ? [[c.status === "rejected" ? "Rejected" : "Published", `${day(c.decidedAt)} · ${c.decidedByName ?? ""}`] as [string, ReactNode]] : []),
    ["Source", <a key="s" className="link" href={c.after.url} target="_blank" rel="noopener noreferrer">{host(c.after.url)}</a>],
    ["Review by", day(c.after.reviewBy)],
  ];

  const footer = mode === "view" ? (
    decide ? <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("reject")}>Reject</button>
      <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => run(() => approve({ changeId: c.changeId, ...(note.trim() ? { note } : {}) }), "Approved and published. Answers use the new value from now on.")}><CheckIcon aria-hidden="true" />Approve and publish</button>
    </> : canRoll ? <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("rollback")}><Undo2Icon aria-hidden="true" />Roll back</button>
    </> : <button type="button" className="btn btn-dark btn-sm" onClick={onClose}>Close</button>
  ) : <>
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode("view"); setErr(null); }}>Back</button>
    <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => mode === "reject"
      ? run(() => reject({ changeId: c.changeId, note }), "Rejected. The proposer sees your reason.")
      : run(() => rollBack({ changeId: c.changeId, note }), isAdmin(me) ? "Rolled back. Answers use the earlier value again." : "Rollback sent for approval.")}>
      {mode === "reject" ? "Reject" : isAdmin(me) ? "Roll back" : "Submit rollback"}</button>
  </>;

  return (
    <Sheet title={`${KIND[c.kind]} · ${c.label}`} onClose={onClose} footer={footer}>
      <div className="sheet-b">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{CHANGE_STATUS[c.status]}<span className="micro mono">{c.changeId}</span></div>
        <div className="field"><span className="lbl">{c.product}</span><Diff before={c.before} after={c.after} unit={c.unit} /></div>
        <div className="card"><div className="facts">{facts.map(([k, v]) => <div key={k} className="fact"><span>{k}</span><b>{v}</b></div>)}</div></div>
        <div className="note-q"><b>Words from the source</b>{c.after.quote}</div>
        {!quoteShowsValue(c.after.value, c.unit, c.after.quote) && <p className="access"><TriangleAlertIcon aria-hidden="true" />The quoted words don’t show the new figure. Check the source before approving.</p>}
        {c.note && <div className="note-q"><b>Note from {c.proposedByName}</b>{c.note}</div>}
        {c.decisionNote && <div className="note-q"><b>{c.status === "rejected" ? "Why it was rejected" : "Approval note"}</b>{c.decisionNote}</div>}
        {mode === "view" && decide && <div className="field"><label htmlFor="ap-note">Approval note <span className="muted">(optional)</span></label>
          <textarea className="textarea" id="ap-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>}
        {mode !== "view" && <div className="field"><label htmlFor="why">{mode === "reject" ? "Why (the proposer sees this)" : "Why roll back"}</label>
          <textarea className="textarea" id="why" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} autoFocus />
          {mode === "rollback" && <small>Restores {valueLabel(c.before.value, c.unit, null)} as a new change{isAdmin(me) ? "" : " that an admin approves"}.</small>}</div>}
        {err && <p className="err" role="alert">{err}</p>}
      </div>
    </Sheet>
  );
}

export function ProductConsole({ me, productId }: { me: Me; productId: string }) {
  const p = useQuery(adminApi.product, { productId });
  const changes = useQuery(catalogApi.forProduct, { productId });
  const pendingAll = useQuery(catalogApi.pending, {});
  const [editing, setEditing] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [toast, setToast] = useToast();
  const done = (msg: string) => { setEditing(null); setViewing(null); setToast(msg); };
  const pendingOf = (termId: string) => changes?.find((c) => c.termId === termId && c.status === "pending");
  const crumbs = [{ label: "Console", href: "/console" }, { label: "Products", href: "/console/products" }, { label: p?.product ?? "Product" }];

  if (p === null) return <Shell me={me} crumbs={crumbs}><p className="empty-row">That product isn’t in the catalog. <Link href="/console/products">Back to products</Link></p></Shell>;
  const term = editing ? p?.terms.find((t) => t.termId === editing) : undefined;
  const change = viewing ? changes?.find((c) => c.changeId === viewing) : undefined;
  const open = changes?.filter((c) => c.status === "pending") ?? [];

  return (
    <Shell me={me} crumbs={crumbs} pending={pendingAll?.length}>
      {!p || !changes ? <p className="empty-row" role="status">Loading the product…</p> : (
        <>
          <div className="page-head">
            <div>
              <span className="eyebrow">{KIND_LABEL[p.kind] ?? p.kind}{p.track ? ` · ${TRACK_LABEL[p.track]}` : ""}</span>
              <h1 style={{ marginTop: 6 }}>{p.product}</h1>
              {p.summary && <p>{p.summary}</p>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {open.length ? <span className="pill amber">{open.length} pending</span> : <span className="pill ok">Published</span>}
              <a className="src" href={p.url} target="_blank" rel="noopener noreferrer"><FileTextIcon aria-hidden="true" />{host(p.url)}</a>
            </div>
          </div>
          <div className="kpis">
            {[[`${p.review.usable}/${p.review.terms}`, "Usable in answers"], [p.review.unreviewed, "To sign off"], [p.review.due + p.review.stale, "Due or past review"], [open.length, "Pending approval"]].map(([n, l]) =>
              <div key={String(l)} className="kpi"><b>{n}</b><span>{l}</span></div>)}
          </div>
          <div className="sections">
            {GROUPS.map((g) => {
              const terms = p.terms.filter((t) => g.kinds.includes(t.kind));
              if (!terms.length) return null;
              return (
                <section key={g.key} className="card" aria-labelledby={`h-${g.key}`}>
                  <div className="card-h"><h2 id={`h-${g.key}`}>{g.title}</h2></div>
                  <div>{terms.map((t) => {
                    const pend = pendingOf(t.termId);
                    return <ValueRow key={t.termId} t={t} pending={pend} onEdit={() => setEditing(t.termId)} onView={() => pend && setViewing(pend.changeId)} />;
                  })}</div>
                </section>
              );
            })}
            <section className="card" aria-labelledby="h-history">
              <div className="card-h"><h2 id="h-history"><HistoryIcon aria-hidden="true" />Change history</h2></div>
              <p className="sec-intro" style={{ padding: "12px 16px 0", fontSize: 12.5, color: "var(--text-2)" }}>Published values are never edited without a record. A rollback restores the earlier value as a new change.</p>
              {changes.length ? <div className="hist">{changes.map((c) => (
                <div key={c.changeId} className="hv">
                  <span className="mono" style={{ fontSize: 11 }}>{c.changeId}</span>
                  <div>{KIND[c.kind]} {c.label}: {valueLabel(c.before.value, c.unit, null)} → {valueLabel(c.after.value, c.unit, null)}
                    <small style={{ display: "block", color: "var(--text-3)", fontSize: 11.5 }}>{day(c.proposedAt)} · {c.proposedByName}{c.decidedByName && c.status !== "pending" ? ` · ${c.status === "rejected" ? "rejected" : "published"} by ${c.decidedByName}` : ""}</small></div>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setViewing(c.changeId)} aria-label={`Open ${c.changeId}`}>{CHANGE_STATUS[c.status]}</button>
                </div>
              ))}</div> : <p className="empty-row">No changes yet. Values are as imported from the bank’s pages.</p>}
            </section>
          </div>
          {term && <EditSheet key={term.termId} t={term} me={me} onClose={() => setEditing(null)} onDone={done} />}
          {change && <ChangeSheet key={change.changeId} c={change} me={me} onClose={() => setViewing(null)} onDone={done} />}
        </>
      )}
      <Toast text={toast} />
    </Shell>
  );
}
