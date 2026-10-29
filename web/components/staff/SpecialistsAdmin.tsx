"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { CalendarCheckIcon, CalendarClockIcon, LockIcon } from "lucide-react";
import { calendarApi, type Availability, type SpecialistRow } from "@/lib/booking-api";
import type { StaffMe } from "./AdminPage";
import { AvailabilitySheet, DAYS, longDay } from "./AvailabilitySheet";
import { AdminNav } from "./StaffNav";
import { StaffShell, initials } from "./StaffShell";

/*
 * Admin › Specialists over convex/bookings.ts specialists: every operator and admin customers can book from the chat's
 * "Talk to a specialist", their hours, and the next slots the chat offers. "Edit hours" opens the console's
 * availability sheet (console.html#calendar) for anyone; setAvailability checks the admin role again.
 */

const ROLE_LABEL = { operator: "Operator", admin: "Admin" } as const;

/** "Mon–Fri 09:00–17:00", or each day when they differ. */
function weekLabel(av: Availability) {
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => av.weekly[d]?.length === 2);
  if (!days.length) return "No weekly hours";
  const span = (d: number) => av.weekly[d]!.join("–");
  const same = days.every((d) => span(d) === span(days[0]!));
  const run = days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  if (same && run && days.length > 1) return `${DAYS[days[0]!]}–${DAYS[days.at(-1)!]} ${span(days[0]!)}`;
  return days.map((d) => `${DAYS[d]} ${span(d)}`).join(" · ");
}

function hoursDetail(av: Availability, today: string) {
  const parts = [`${av.slotMinutes}-min calls`, `up to ${av.dailyCap} a day`];
  if (av.breaks[0]) parts.push(`break ${av.breaks[0].join("–")}`);
  const off = av.daysOff.filter((o) => o.date >= today).length;
  if (off) parts.push(`${off} day${off === 1 ? "" : "s"} off planned`);
  return parts.join(" · ");
}

export function SpecialistsAdmin({ me }: { me: StaffMe }) {
  const rows = useQuery(calendarApi.specialists, {});
  const [editing, setEditing] = useState<SpecialistRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const bookable = rows?.filter((r) => r.active && r.nextSlots.length).length ?? 0;

  return (
    <StaffShell logoHref="/admin" nav={<AdminNav current="specialists" counts={rows ? { specialists: rows.length } : {}} />} me={{ ...me, initials: initials(me.name) }}
      crumbs={[{ label: "Admin", href: "/admin" }, { label: "Specialists" }]}>
      <div className="pg-head">
        <div>
          <h2>Specialists</h2>
          <p>Every operator and admin can take calls that customers book from the chat’s “Talk to a specialist”. Until their hours are saved, they’re offered on the default hours. The call goes through information; it isn’t advice or a credit decision.</p>
        </div>
      </div>

      <section className="gcard" aria-labelledby="sp-h">
        <div className="gc-h"><span id="sp-h"><CalendarClockIcon aria-hidden="true" />Who customers can book</span>
          {rows && <span className="micro">{bookable} of {rows.length} with open slots</span>}</div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th scope="col">Specialist</th><th scope="col">Hours</th><th scope="col">Next open slots</th><th scope="col">Booked ahead</th><th scope="col">Booking</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows === undefined ? <tr><td colSpan={6} className="empty-row" role="status">Loading specialists…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={6} className="empty-row">No operators or admins yet. Give someone the operator role under Users and roles; they’re bookable once they’ve opened Raiffy.</td></tr>
                : rows.map((r) => (
                  <tr key={r.operatorId}>
                    <td className="nm">
                      <span className="who"><span className="ava sm" aria-hidden="true">{initials(r.name)}</span><b>{r.name}</b></span>
                      <small>{r.title} · {ROLE_LABEL[r.role]}{r.email ? ` · ${r.email}` : ""}</small>
                    </td>
                    <td data-label="Hours">
                      <span className="mono">{weekLabel(r.availability)}</span>
                      <small className="micro" style={{ display: "block" }}>{r.custom ? hoursDetail(r.availability, r.today) : "Default hours, not saved yet"}</small>
                    </td>
                    <td data-label="Next open slots">{!r.active ? <span className="micro">—</span>
                      : r.nextSlots.length ? <span className="mono">{r.nextSlots.map((s) => `${longDay(s)} ${s.slice(11)}`).join(" · ")}</span>
                      : <span className="pill p-due">None in the next {r.availability.horizonDays} days</span>}</td>
                    <td className="mono" data-label="Booked ahead">{r.upcoming}</td>
                    <td data-label="Booking">{r.active ? <span className="pill p-published">On</span>
                      : <span className="pill p-draft"><LockIcon aria-hidden="true" />Off</span>}</td>
                    <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(r)}>{r.custom ? "Edit hours" : "Set hours"}</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="gc-note">
          Times are in each specialist’s time zone. Changes apply to new bookings; calls already booked stay, and the specialist sees them in their console calendar. Someone moved back to member drops out of the chat. Every saved change goes into the audit log.
        </div>
      </section>

      {/* The sheet keeps the console's styles (console.html dialog.sheet) */}
      {editing && (
        <div className="pg-console" style={{ display: "contents" }}>
          <AvailabilitySheet own={false} onClose={() => setEditing(null)} onDone={(msg) => { setEditing(null); setToast(msg); }} owner={{
            operatorId: editing.operatorId, name: editing.name, title: editing.title, active: editing.active,
            availability: editing.custom ? editing.availability : null, timeZone: editing.availability.timeZone, today: editing.today,
          }} />
        </div>
      )}
      <div className="toasts" role="status">{toast && <div className="toast"><CalendarCheckIcon aria-hidden="true" /><span>{toast}</span></div>}</div>
    </StaffShell>
  );
}
