"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRightIcon, ClockAlertIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { adminApi, day, KIND_LABEL, TRACK_LABEL, valueLabel, type ProductRow } from "@/lib/admin-api";
import type { StaffMe } from "./AdminPage";
import { AdminNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";

/*
 * admin.html#products over convex/adminViews.ts products: Raiffeisen's imported product pages, with how many of
 * their values are usable in answers and when they need review. Read-only; editing arrives with versioning.
 */

type TrackFilter = "all" | "personal" | "business";
type Values = "all" | "with" | "without";

export function productHref(productId: string) { return `/admin/products/${encodeURIComponent(productId)}`; }

/** The status pills of a product: what its imported values allow today. */
export function ReviewPills({ r }: { r: ProductRow["review"] }) {
  if (!r.terms) return <span className="pill p-draft">No values imported</span>;
  return (
    <div className="pills">
      {r.stale > 0 && <span className="pill p-stale">{r.stale} past review</span>}
      {r.due > 0 && <span className="pill p-due">{r.due} due soon</span>}
      {r.unreviewed > 0 && <span className="pill p-pending">{r.unreviewed} to sign off</span>}
      <span className="pill">{r.usable} of {r.terms} usable</span>
    </div>
  );
}

export function ReviewDate({ r }: { r: ProductRow["review"] }) {
  if (!r.nextReviewBy) return <span className="micro">—</span>;
  if (r.stale) return <span className="stale-ic"><TriangleAlertIcon aria-hidden="true" />{day(r.nextReviewBy)}</span>;
  if (r.due) return <span className="pill p-due">{day(r.nextReviewBy)}</span>;
  return <span className="micro mono">{day(r.nextReviewBy)}</span>;
}

export function ProductsList({ me }: { me: StaffMe }) {
  const rows = useQuery(adminApi.products, {});
  const router = useRouter();
  const [q, setQ] = useState("");
  const [track, setTrack] = useState<TrackFilter>("all");
  const [values, setValues] = useState<Values>("with");
  const [review, setReview] = useState(false);
  const needle = q.trim().toLowerCase();

  const list = (rows ?? []).filter((p) =>
    (track === "all" || p.track === track)
    && (values === "all" || (values === "with" ? p.review.terms > 0 : p.review.terms === 0))
    && (!review || p.review.stale + p.review.due + p.review.unreviewed > 0)
    && (!needle || `${p.product} ${KIND_LABEL[p.kind] ?? p.kind} ${p.category ?? ""}`.toLowerCase().includes(needle)))
    .sort((a, b) => b.review.terms - a.review.terms || a.product.localeCompare(b.product, "ro"));
  const withValues = (rows ?? []).filter((p) => p.review.terms > 0).length;

  const seg = <T extends string>(label: string, value: T, set: (v: T) => void, opts: [T, string][]) => (
    <div className="seg" role="group" aria-label={label}>
      {opts.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => set(v)}>{text}</button>)}
    </div>
  );

  return (
    <StaffShell logoHref="/admin" nav={<AdminNav current="products" />} me={{ ...me, initials: initials(me.name) }}
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Products" }]}>
      <div className="pg-head">
        <div>
          <h2>Products</h2>
          <p>Raiffeisen’s products as imported from its public pages. Each value keeps its quote, source and review date, and only values a reviewer has signed off are used in answers. Editing and versioning come later.</p>
        </div>
      </div>

      <div className="filters">
        <label className="input"><SearchIcon aria-hidden="true" /><span className="sr-only">Search products</span>
          <input type="search" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
        {seg("Track", track, setTrack, [["all", "All"], ["personal", "Individuals"], ["business", "Business"]])}
        {seg("Imported values", values, setValues, [["with", "With values"], ["without", "Page only"], ["all", "All"]])}
        <button type="button" className="tog" aria-pressed={review} onClick={() => setReview((x) => !x)}><ClockAlertIcon aria-hidden="true" />Needs attention</button>
      </div>

      <div className="gcard">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th scope="col">Product</th><th scope="col">Track</th><th scope="col" className="r">Headline rate</th><th scope="col">Values</th><th scope="col">Review by</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {rows === undefined ? <tr><td colSpan={6} className="empty-row" role="status">Loading…</td></tr>
                : list.length ? list.map((p) => (
                  <tr key={p.productId} className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(productHref(p.productId)); }}>
                    <td className="nm"><b><Link href={productHref(p.productId)} style={{ textDecoration: "none" }}>{p.product}</Link></b><small>{KIND_LABEL[p.kind] ?? p.kind}{p.category ? ` · ${p.category}` : ""}</small></td>
                    <td>{p.track ? TRACK_LABEL[p.track] : <span className="micro">—</span>}</td>
                    <td className="r mono">{p.headline ? <>{valueLabel(p.headline.value, p.headline.unit, p.headline.frequency)}{p.headline.use !== "usable" && <div className="micro">not usable yet</div>}</> : <span className="micro">—</span>}</td>
                    <td><ReviewPills r={p.review} /></td>
                    <td><ReviewDate r={p.review} /></td>
                    <td className="go"><ChevronRightIcon aria-hidden="true" /></td>
                  </tr>
                )) : <tr><td colSpan={6} className="empty-row">No products match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="gc-note">{rows ? `${list.length} of ${rows.length} product pages · ${withValues} with imported values so far` : ""}</div>
      </div>
    </StaffShell>
  );
}
