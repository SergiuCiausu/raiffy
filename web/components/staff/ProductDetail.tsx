"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { CheckIcon, ExternalLinkIcon, LinkIcon, TriangleAlertIcon } from "lucide-react";
import { adminApi, day, KIND_LABEL, TRACK_LABEL, USE_LABEL, valueLabel, type TermKind, type TermView } from "@/lib/admin-api";
import type { StaffMe } from "./AdminPage";
import { ReviewPills } from "./ProductsList";
import { AdminNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";

/*
 * admin.html#products/<id>, read-only, over convex/adminViews.ts product: every imported value with its quote, source,
 * review date and whether answers may use it. Groups follow lib/catalog/review.ts TERM_GROUPS.
 */

const GROUPS: { key: string; title: string; kinds: TermKind[] }[] = [
  { key: "rate", title: "Rate", kinds: ["interest_rate", "dae"] },
  { key: "fees", title: "Fees and commissions", kinds: ["fee"] },
  { key: "limits", title: "Amounts and terms", kinds: ["limit", "term"] },
  { key: "conditions", title: "Conditions, documents and benefits", kinds: ["eligibility", "document", "benefit"] },
];

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

function Use({ t }: { t: TermView }) {
  if (t.use === "usable") return <span className="ok-ic" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5 }}><CheckIcon aria-hidden="true" width={13} height={13} />{USE_LABEL.usable}</span>;
  return <span className={`pill ${t.use === "stale" ? "p-stale" : t.use === "unreviewed" ? "p-pending" : "p-draft"}`}>{USE_LABEL[t.use]}</span>;
}

function Review({ t }: { t: TermView }) {
  if (t.review === "stale") return <span className="stale-ic"><TriangleAlertIcon aria-hidden="true" />{day(t.reviewBy)} · passed</span>;
  if (t.review === "due") return <span className="pill p-due">{day(t.reviewBy)}</span>;
  return <span className="micro mono">{day(t.reviewBy)}</span>;
}

function TermRow({ t }: { t: TermView }) {
  return (
    <tr>
      <td className="nm" style={{ minWidth: 180 }}>
        <b>{t.label}</b>
        <small className="mono" style={{ color: "var(--text-1)", fontSize: 12.5 }}>{valueLabel(t.value, t.unit, t.frequency)}</small>
        {t.conditions.length > 0 && <small>{t.conditions.join(" · ")}</small>}
      </td>
      <td><Use t={t} /></td>
      <td style={{ maxWidth: 360 }}>
        <a className="src" href={t.url} target="_blank" rel="noopener noreferrer"><LinkIcon aria-hidden="true" />{host(t.url)}</a>
        {t.quote ? <p className="micro" style={{ marginTop: 6 }}>“{t.quote.trim()}”</p> : <p className="micro" style={{ marginTop: 6 }}>No quote located on the page.</p>}
        <p className="micro">Collected {day(t.collectedAt)}</p>
      </td>
      <td><Review t={t} /></td>
      <td style={{ fontSize: 12.5 }}>{t.reviewedBy ? <>{t.reviewedByName ?? t.reviewedBy}{t.reviewedAt && <div className="micro">{day(t.reviewedAt)}</div>}</> : <span className="micro">Not yet</span>}</td>
    </tr>
  );
}

export function ProductDetail({ me, productId }: { me: StaffMe; productId: string }) {
  const p = useQuery(adminApi.product, { productId });
  const shell = (title: string, body: React.ReactNode) => (
    <StaffShell logoHref="/admin" nav={<AdminNav current="products" />} me={{ ...me, initials: initials(me.name) }}
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Products", href: "/admin/products" }, { label: title }]}>{body}</StaffShell>
  );
  if (p === undefined) return shell("Loading", <p className="micro" role="status">Loading…</p>);
  if (p === null) return shell("Not found", <p className="empty-row">No Raiffeisen product with this ID. <Link className="link" href="/admin/products">Back to products</Link></p>);

  return shell(p.product, (
    <>
      <div className="ed-head">
        <h2>{p.product}</h2>
        <ReviewPills r={p.review} />
        <p className="micro">
          {KIND_LABEL[p.kind] ?? p.kind}{p.track ? ` · ${TRACK_LABEL[p.track]}` : ""}{p.category ? ` · ${p.category}` : ""} · page collected {day(p.collectedAt)} ·{" "}
          <a className="link" href={p.url} target="_blank" rel="noopener noreferrer">Product page <ExternalLinkIcon aria-hidden="true" width={11} height={11} /></a>
        </p>
      </div>
      {p.summary && <p className="check-line" style={{ marginBottom: 16 }}>{p.summary}</p>}

      {p.terms.length === 0 ? (
        <div className="gcard"><p className="empty-row">No values have been imported for this product yet. Answers about it use the cited page text only.</p></div>
      ) : GROUPS.map((g) => {
        const rows = p.terms.filter((t) => g.kinds.includes(t.kind));
        if (!rows.length) return null;
        return (
          <section key={g.key} className="gcard fgroup" aria-labelledby={`g-${g.key}`}>
            <div className="gc-h"><span id={`g-${g.key}`}>{g.title}</span><span className="micro">{rows.filter((t) => t.use === "usable").length} of {rows.length} usable</span></div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th scope="col">Value</th><th scope="col">In answers</th><th scope="col">Source and quote</th><th scope="col">Review by</th><th scope="col">Signed off</th></tr></thead>
                <tbody>{rows.map((t) => <TermRow key={t.termId} t={t} />)}</tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="micro" style={{ marginTop: 12 }}>Read-only. A value becomes usable once a reviewer signs it off against its quote; editing, versions and approvals arrive with the change workflow.</p>
    </>
  ));
}
