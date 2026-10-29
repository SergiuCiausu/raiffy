"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { DownloadIcon, SearchIcon } from "lucide-react";
import { adminApi, day, time, type AuditRow } from "@/lib/admin-api";
import { ROLE_LABEL, parseRole } from "@/lib/roles";
import type { StaffMe } from "./AdminPage";
import { AdminNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";

/*
 * admin.html#audit over convex/adminViews.ts audit: every privileged action, who, when, what and why. Append-only.
 * Only actions the backend writes today are listed; catalog edits and approvals join as versioning arrives.
 */

const ACTIONS: Record<string, { label: string; group: Group }> = {
  "user.role_changed": { label: "Changed a role", group: "users" },
  "user.sample_assigned": { label: "Assigned a sample customer", group: "users" },
  "catalog.term_reviewed": { label: "Signed off a value", group: "catalog" },
  "plan.template_set": { label: "Set a plan template", group: "catalog" },
  "booking.availability_set": { label: "Set booking hours", group: "bookings" },
  "booking.cancelled": { label: "Cancelled a booking", group: "bookings" },
};
type Group = "users" | "catalog" | "bookings" | "other";
const GROUPS: [Group | "all", string][] = [["all", "All"], ["catalog", "Catalog"], ["users", "Roles"], ["bookings", "Bookings"], ["other", "Other"]];
const groupOf = (a: string): Group => ACTIONS[a]?.group ?? "other";
/** "Signed off a value", or the raw action name for one this page doesn't know yet. */
export const actionLabel = (a: string) => ACTIONS[a]?.label ?? a;

const productHref = (termOrProductId: string) => `/admin/products/${encodeURIComponent(termOrProductId.split("#")[0]!)}`;
const who = (id: string, name: string | null) => name ?? id;

function Change({ e }: { e: AuditRow }) {
  const d = e.details ?? {};
  if (e.action === "user.role_changed") {
    return <><b style={{ fontWeight: 500 }}>{who(e.targetUserId ?? "", e.targetName)}</b>: <span className="del">{ROLE_LABEL[parseRole(d.from)]}</span> → <span className="ins">{ROLE_LABEL[parseRole(d.to)]}</span></>;
  }
  if (e.action === "user.sample_assigned") {
    const persona = (x?: string) => (!x || x === "none" ? "None" : x);
    return <><b style={{ fontWeight: 500 }}>{who(e.targetUserId ?? "", e.targetName)}</b>: <span className="del">{persona(d.from)}</span> → <span className="ins">{persona(d.to)}</span></>;
  }
  if (e.action === "catalog.term_reviewed" && d.termId) return <Link className="link" href={productHref(d.termId)}>{d.termId.split("#")[1] ?? d.termId}</Link>;
  if (e.action === "plan.template_set" && d.productId) return <Link className="link" href={productHref(d.productId)}>{d.productId}</Link>;
  if (e.action === "booking.availability_set") return <>{who(e.targetUserId ?? "", e.targetName)} · {d.active === "true" ? "taking bookings" : "not taking bookings"}</>;
  const pairs = Object.entries(d);
  return pairs.length ? <span className="mono" style={{ fontSize: 12 }}>{pairs.map(([k, v]) => `${k}: ${v}`).join(" · ")}</span> : <span className="micro">—</span>;
}

function csv(rows: AuditRow[]) {
  const head = ["at", "actor", "role", "action", "target", "details", "note"];
  const body = rows.map((e) => [new Date(e.at).toISOString(), who(e.actorUserId, e.actorName), e.actorRole, e.action, e.targetUserId ? who(e.targetUserId, e.targetName) : "",
    Object.entries(e.details ?? {}).map(([k, v]) => `${k}: ${v}`).join("; "), e.note ?? ""]);
  return [head, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function download(rows: AuditRow[]) {
  const url = URL.createObjectURL(new Blob([csv(rows)], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = `raiffy-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export function AuditLog({ me }: { me: StaffMe }) {
  const log = useQuery(adminApi.audit, { limit: 500 });
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group | "all">("all");
  const needle = q.trim().toLowerCase();
  const list = (log ?? []).filter((e) => (group === "all" || groupOf(e.action) === group) && (!needle ||
    [e.actorName, e.actorUserId, e.targetName, e.action, ACTIONS[e.action]?.label, e.note, ...Object.values(e.details ?? {})].join(" ").toLowerCase().includes(needle)));
  const count = (g: Group | "all") => (log ?? []).filter((e) => g === "all" || groupOf(e.action) === g).length;

  return (
    <StaffShell logoHref="/admin" nav={<AdminNav current="audit" />} me={{ ...me, initials: initials(me.name) }}
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Audit log" }]}
      top={<button type="button" className="btn btn-ghost btn-sm" disabled={!list.length} onClick={() => download(list)}><DownloadIcon aria-hidden="true" />Export CSV</button>}>
      <div className="pg-head">
        <div>
          <h2>Audit log</h2>
          <p>Every privileged action: who, when, what and why. Append-only, and nobody can edit it. Role changes, sample-customer assignments, signed-off catalog values, plan templates and booking changes are logged today.</p>
        </div>
      </div>

      <div className="filters">
        <label className="input"><SearchIcon aria-hidden="true" /><span className="sr-only">Search the audit log</span>
          <input type="search" placeholder="Search people, items, reasons" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
        <div className="seg" role="group" aria-label="Action">
          {GROUPS.map(([g, label]) => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>{label} <span className="mono">{count(g)}</span></button>)}
        </div>
      </div>

      <div className="gcard">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Change</th><th scope="col">Why</th></tr></thead>
            <tbody>
              {log === undefined ? <tr><td colSpan={5} className="empty-row" role="status">Loading…</td></tr>
                : list.length ? list.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{day(e.at)}<div className="micro">{time(e.at)}</div></td>
                    <td style={{ fontSize: 12.5 }}><span className="who"><span className="ava sm" aria-hidden="true">{initials(who(e.actorUserId, e.actorName))}</span>{who(e.actorUserId, e.actorName)}</span><div className="micro">{ROLE_LABEL[e.actorRole]}</div></td>
                    <td><span className="pill">{actionLabel(e.action)}</span></td>
                    <td className="aud-diff"><Change e={e} /></td>
                    <td style={{ fontSize: 12.5, color: "var(--text-2)", maxWidth: 320 }}>{e.note ?? "—"}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="empty-row">{log.length ? "No entries match." : "Nothing has been logged yet."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="gc-note">{log ? `${list.length} of ${log.length} entries${log.length === 500 ? " · the newest 500" : ""}` : ""}</div>
      </div>
    </StaffShell>
  );
}
