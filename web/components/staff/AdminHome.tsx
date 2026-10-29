"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { BellIcon, ChartColumnIcon, ClockIcon, HistoryIcon, HourglassIcon, TriangleAlertIcon, UserCheckIcon } from "lucide-react";
import { adminApi, day, type AdminHome as Home } from "@/lib/admin-api";
import type { StaffMe } from "./AdminPage";
import { actionLabel } from "./AuditLog";
import { productHref } from "./ProductsList";
import { AdminNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";

/*
 * admin.html#home over convex/adminViews.ts home: catalog values that need a review or a sign-off, escalated
 * counter-offers waiting in the console, recent changes, and last week's volume. Pending approvals join with versioning.
 */

const num = new Intl.NumberFormat("en-GB");

function AttentionRow({ a }: { a: Home["attention"][number] }) {
  const stale = a.stale > 0;
  const what = [a.stale && `${a.stale} past review`, a.due && `${a.due} due for review`, a.unreviewed && `${a.unreviewed} waiting for a sign-off`].filter(Boolean).join(" · ");
  return (
    <div className="att-row">
      <span className={stale ? "ic bad" : a.unreviewed ? "ic warm" : "ic"}>{stale ? <TriangleAlertIcon aria-hidden="true" /> : a.unreviewed ? <HourglassIcon aria-hidden="true" /> : <ClockIcon aria-hidden="true" />}</span>
      <div>
        <b>{a.product}</b>
        <small className={stale ? "stale" : undefined}>{what}{a.nextReviewBy ? ` · review by ${day(a.nextReviewBy)}` : ""}{stale ? ". Answers that need these values can’t use them." : ""}</small>
      </div>
      <Link className="btn btn-ghost btn-sm" href={productHref(a.productId)}>Open</Link>
    </div>
  );
}

export function AdminHome({ me }: { me: StaffMe }) {
  const h = useQuery(adminApi.home, {});
  const first = me.name.split(" ")[0];
  const rows = h ? h.attention.length + (h.escalations.open ? 1 : 0) : 0;

  return (
    <StaffShell logoHref="/admin" nav={<AdminNav current="home" />} me={{ ...me, initials: initials(me.name) }} crumbs={[{ label: "Home" }]}>
      <div className="pg-head hello">
        <div className="bloom" aria-hidden="true" />
        <div>
          <h2>Hello, {first}</h2>
          <p>What needs you in the catalog, what changed and how much Raiffy answered this week. Everything here is read-only; editing and approvals come with versioning.</p>
        </div>
      </div>

      {!h ? <p className="micro" role="status">Loading…</p> : (
        <div className="home-grid">
          <section className="gcard" aria-labelledby="att-h">
            <div className="gc-h"><span id="att-h"><BellIcon aria-hidden="true" />Needs attention</span><span className="micro">{rows} {rows === 1 ? "item" : "items"}</span></div>
            <div className="att">
              {h.escalations.open > 0 && (
                <div className="att-row">
                  <span className="ic warm"><UserCheckIcon aria-hidden="true" /></span>
                  <div>
                    <b>{h.escalations.open} escalated counter-{h.escalations.open === 1 ? "offer" : "offers"} waiting</b>
                    <small>{h.escalations.oldestAt ? `Oldest from ${day(h.escalations.oldestAt)} · ` : ""}decided by operators and admins in the console</small>
                  </div>
                  <span />
                </div>
              )}
              {h.attention.map((a) => <AttentionRow key={a.productId} a={a} />)}
              {rows === 0 && <p className="empty-row">Nothing needs you right now.</p>}
            </div>
          </section>

          <div style={{ display: "grid", gap: 16 }}>
            <section className="gcard" aria-labelledby="wk-h">
              <div className="gc-h"><span id="wk-h"><ChartColumnIcon aria-hidden="true" />Last 7 days</span><Link className="link" href="/admin/sentiment">Sentiment</Link></div>
              <div className="gc-b stat-rows">
                <div className="stat"><span>Conversations started</span><b>{num.format(h.week.conversations)}</b></div>
                <div className="stat"><span>Answers given</span><b>{num.format(h.week.answers)}</b></div>
                <div className="stat"><span>Replies that failed</span><b>{num.format(h.week.failed)}</b></div>
              </div>
              <div className="gc-note">{h.week.capped ? "Counted up to the first 10,000 conversations. " : ""}Account-data and offer figures come with Analytics.</div>
            </section>

            <section className="gcard" aria-labelledby="rc-h">
              <div className="gc-h"><span id="rc-h"><HistoryIcon aria-hidden="true" />Recent changes</span><Link className="link" href="/admin/audit">Audit log</Link></div>
              <div className="att">
                {h.recent.length ? h.recent.map((e, i) => {
                  const name = e.actorName ?? e.actorUserId;
                  return (
                    <div key={`${e.at}-${i}`} className="att-row">
                      <span className="ava" aria-hidden="true">{initials(name)}</span>
                      <div><b>{name} · {actionLabel(e.action).toLowerCase()}</b><small>{day(e.at)}{e.note ? ` · ${e.note}` : ""}</small></div>
                      <span />
                    </div>
                  );
                }) : <p className="empty-row">Nothing logged yet.</p>}
              </div>
            </section>
          </div>
        </div>
      )}
    </StaffShell>
  );
}
