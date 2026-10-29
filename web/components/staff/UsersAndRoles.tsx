"use client";

import { useEffect, useState, useTransition } from "react";
import { CircleAlertIcon, SearchIcon } from "lucide-react";
import { saveUserChanges } from "@/app/admin/users/actions";
import { ROLES, ROLE_LABEL, parseRole, type Role } from "@/lib/roles";
import { countChanges, type UserChange } from "@/lib/user-changes";
import type { AuditEntry, SampleAssignments } from "@/lib/users-api";
import { SaveBar } from "./SaveBar";
import { AdminNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";

/*
 * Users and roles (admin.html#users: shell, page head, filters, .tbl and the save bar). Members use Raiffy, operators
 * review answers and counter-offers, admins approve changes and manage roles; admins also give testers a sample
 * customer. Edits stay pending, marked on their row, until "Save changes" saves them all through saveUserChanges,
 * which writes Clerk, Convex and the audit log. Failed rows stay pending with their error.
 */

export type UserRow = {
  id: string; name: string; email: string; role: Role; createdAt: number; lastActiveAt: number | null;
  marketing: { value: boolean; at: string | null } | null;
};

type Edit = { role?: Role; sample?: string | null };

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Bucharest" });
const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
const FILTERS: [Role | "all", string][] = [["all", "All"], ["member", "Members"], ["operator", "Operators"], ["admin", "Admins"]];

export function UsersAndRoles({ users, totalCount, log, samples, selfId, me }: {
  users: UserRow[]; totalCount: number; log: AuditEntry[] | null; samples: SampleAssignments | null; selfId: string; me: { name: string; title: string };
}) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "all">("all");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState("Changes are saved together");
  const [saving, startSaving] = useTransition();

  const needle = q.trim().toLowerCase();
  const list = users.filter((u) => (role === "all" || u.role === role) && (!needle || `${u.name} ${u.email}`.toLowerCase().includes(needle)));
  const count = (r: Role | "all") => users.filter((u) => r === "all" || u.role === r).length;
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email || u.id]));
  const admins = count("admin");
  const recent = (log ?? []).filter((e) => e.action === "user.role_changed" || e.action === "user.sample_assigned");
  const sampleOf = new Map((samples?.users ?? []).map((s) => [s.clerkUserId, s]));
  const personaName = (id: string | null | undefined) => !id || id === "none" ? "None" : samples?.personas.find((p) => p.id === id)?.label ?? id;

  // What's saved, and the batch: only fields that differ from it
  const saved = (u: UserRow) => ({ role: u.role, sample: sampleOf.get(u.id)?.assigned ?? null });
  const changes: UserChange[] = users.flatMap((u) => {
    const e = edits[u.id], s = saved(u);
    if (!e) return [];
    const c: UserChange = { userId: u.id, ...(e.role !== undefined && e.role !== s.role ? { role: e.role } : {}), ...(e.sample !== undefined && e.sample !== s.sample ? { sample: e.sample } : {}) };
    return c.role !== undefined || c.sample !== undefined ? [c] : [];
  });
  const n = countChanges(changes);
  const hidden = changes.filter((c) => !list.some((u) => u.id === c.userId)).length;
  const promoting = changes.filter((c) => c.role === "admin");

  // The browser asks before leaving with unsaved edits
  useEffect(() => {
    if (!n) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [n]);

  const edit = (u: UserRow, patch: Edit) => {
    setEdits((all) => ({ ...all, [u.id]: { ...all[u.id], ...patch } }));
    setErrors((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== u.id)));
    setConfirm(false);
  };
  const discard = () => { setEdits({}); setErrors({}); setNote(""); setConfirm(false); setStatus("Changes discarded"); };
  const save = () => {
    if (promoting.length && !confirm) { setConfirm(true); return; }
    setConfirm(false);
    startSaving(async () => {
      const outcome = await saveUserChanges({ changes, note: note.trim() || undefined }).catch(() => ({ error: "That didn’t save. Try again." }));
      if ("error" in outcome) { setStatus(outcome.error); return; }
      const failed = Object.fromEntries(outcome.results.flatMap((r) => r.ok ? [] : [[r.userId, r.error]]));
      setEdits((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id in failed)));
      setErrors(failed);
      const ok = countChanges(changes.filter((c) => !(c.userId in failed)));
      if (!Object.keys(failed).length) setNote("");
      setStatus(ok ? `${ok} change${ok > 1 ? "s" : ""} saved and recorded in the audit log` : "Nothing saved");
    });
  };

  const nav = <AdminNav current="users" counts={{ users: users.length }} />;
  const firstName = (id: string) => (nameOf.get(id) ?? "").split(" ")[0];

  return (
    <StaffShell logoHref="/admin" nav={nav} me={{ ...me, initials: initials(me.name) }} crumbs={[{ label: "Admin", href: "/admin" }, { label: "Users and roles" }]}>
      <div className="pg-head">
        <div>
          <h2>Users and roles</h2>
          <p>Members use Raiffy. Operators review answers and counter-offers. Admins approve changes and manage roles. A new role takes effect within about a minute.</p>
        </div>
      </div>

      <div className="filters">
        <label className="input"><SearchIcon aria-hidden="true" /><span className="sr-only">Search users</span>
          <input type="search" placeholder="Search names and emails" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" /></label>
        <div className="seg" role="group" aria-label="Role">
          {FILTERS.map(([v, label]) => (
            <button key={v} type="button" aria-pressed={role === v} onClick={() => setRole(v)}>{label} <span className="mono">{count(v)}</span></button>
          ))}
        </div>
      </div>

      <section className="gcard usr-card" aria-labelledby="usr-h">
        <div className="gc-h">
          <span id="usr-h">Users</span>
          <SaveBar count={n} failed={Object.keys(errors).length} hidden={hidden} note={note} onNote={setNote} onDiscard={discard} onSave={save}
            onCancel={() => setConfirm(false)} saving={saving} idle={status}
            confirm={confirm ? `Yes, make ${promoting.map((c) => firstName(c.userId)).join(" and ")} admin` : null} />
        </div>
        {confirm && <div className="gc-note" style={{ borderTop: 0, borderBottom: "1px solid var(--border)" }}>Admins approve changes and manage every role.</div>}
        <div className="tbl-wrap">
          <table className="tbl usr-tbl">
            <thead><tr><th scope="col">User</th><th scope="col">Joined</th><th scope="col">Last active</th><th scope="col">Personalised offers</th><th scope="col">Sample customer</th><th scope="col">Role</th></tr></thead>
            <tbody>
              {list.length ? list.map((u) => {
                const label = nameOf.get(u.id)!, s = saved(u), e = edits[u.id] ?? {};
                const nextRole = e.role ?? s.role, nextSample = e.sample !== undefined ? e.sample : s.sample;
                const edited = nextRole !== s.role || nextSample !== s.sample;
                const assignable = sampleOf.get(u.id);
                return (
                  <tr key={u.id} className={edited ? "is-edited" : undefined}>
                    <td className="nm">
                      <span className="who"><span className="ava sm" aria-hidden="true">{initials(u.name || u.email)}</span><b>{u.name || "No name"}</b></span><small>{u.email || u.id}</small>
                      {errors[u.id] ? <p className="err"><CircleAlertIcon aria-hidden="true" />{errors[u.id]}</p> : edited && <small>Edited, not saved</small>}
                    </td>
                    <td className="mono" data-label="Joined">{day.format(u.createdAt)}</td>
                    <td className="mono" data-label="Last active">{u.lastActiveAt ? when.format(u.lastActiveAt) : "—"}</td>
                    <td data-label="Personalised offers">{u.marketing === null ? <span className="micro">Not recorded</span>
                      : u.marketing.value ? <>Yes{u.marketing.at && <small className="micro"> · {day.format(new Date(u.marketing.at))}</small>}</> : "No"}</td>
                    <td data-label="Sample customer">{samples === null ? <span className="micro">Not reachable</span>
                      : !assignable ? <span className="micro">Hasn’t opened Raiffy yet</span>
                      : <>
                        <label className="input usr-sel wide"><span className="sr-only">Sample customer for {label}</span>
                          <select value={nextSample ?? ""} onChange={(ev) => edit(u, { sample: ev.target.value || null })} disabled={saving}>
                            <option value="">None</option>
                            {samples.personas.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                          </select></label>
                        {assignable.inUse && assignable.inUse !== assignable.assigned && <small className="micro">Using {personaName(assignable.inUse)} now</small>}
                      </>}</td>
                    <td data-label="Role">{u.id === selfId ? <span className="micro">{ROLE_LABEL[u.role]} · you can’t change your own role</span>
                      : u.role === "admin" && admins <= 1 ? <span className="micro">{ROLE_LABEL[u.role]} · the only admin</span>
                      : <label className="input usr-sel"><span className="sr-only">Role for {label}</span>
                          <select value={nextRole} onChange={(ev) => edit(u, { role: ev.target.value as Role })} disabled={saving}>
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select></label>}</td>
                  </tr>
                );
              }) : <tr><td colSpan={6} className="empty-row">No users match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="gc-note">
          {totalCount > users.length ? `Showing the newest ${users.length} of ${totalCount} users. ` : `${users.length} users. `}
          Roles live in Clerk publicMetadata; marketing consent is optional and never a condition of access. A sample customer is test data for trying account questions; the tester still switches on what Raiffy may read. Every saved change goes into the audit log.
        </div>
      </section>

      <section className="sec" aria-labelledby="rc-h">
        <div className="sec-h"><h3 id="rc-h">Recent changes</h3><p>Append-only. Nobody can edit it.</p></div>
        <div className="gcard">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">User</th><th scope="col">Change</th><th scope="col">Why</th></tr></thead>
              <tbody>
                {log === null ? <tr><td colSpan={5} className="empty-row">The audit log isn’t reachable right now.</td></tr>
                  : recent.length === 0 ? <tr><td colSpan={5} className="empty-row">No role or sample customer changes yet.</td></tr>
                  : recent.map((e) => (
                    <tr key={`${e.at}-${e.action}-${e.targetUserId}`}>
                      <td className="mono">{when.format(e.at)}</td>
                      <td>{nameOf.get(e.actorUserId) ?? e.actorUserId}</td>
                      <td>{nameOf.get(e.targetUserId ?? "") ?? e.targetUserId}</td>
                      <td>{e.action === "user.sample_assigned"
                        ? <>Sample customer: <span className="del">{personaName(e.details?.from)}</span> → <span className="ins">{personaName(e.details?.to)}</span></>
                        : <><span className="del">{ROLE_LABEL[parseRole(e.details?.from)]}</span> → <span className="ins">{ROLE_LABEL[parseRole(e.details?.to)]}</span></>}</td>
                      <td>{e.note ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </StaffShell>
  );
}
