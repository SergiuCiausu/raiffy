"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import { calendarApi, type AgendaItem, type Availability } from "@/lib/booking-api";
import { availabilityError, DEFAULT_AVAILABILITY, localAt, outsideHours } from "@/lib/calendar";
import { Sheet } from "./Sheet";

/*
 * The availability sheet (console.html#calendar, "Availability"): weekly hours, a daily break, calls a day, lead time,
 * call length, gap and days off. The operator edits their own from the calendar; an admin edits anyone's from
 * Admin › Specialists. convex/bookings.ts setAvailability validates and checks the role again.
 */

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymd = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00Z`);
export const dayMonth = (date: string) => `${ymd(date).getUTCDate()} ${MONTHS[ymd(date).getUTCMonth()]}`;
export const longDay = (date: string) => `${DAYS[ymd(date).getUTCDay()]} ${dayMonth(date)}`;

const ERRORS: Record<string, string> = {
  forbidden: "You can only change your own calendar.",
  not_a_specialist: "Only operators and admins can take calls. Change the role under Users and roles first.",
  availability_invalid: "These hours can’t be saved. Check the times and try again.",
  operator_name_invalid: "Add a title of up to 60 characters.",
};
export const errorText = (e: unknown, more: Record<string, string> = {}) =>
  (e instanceof ConvexError && typeof e.data === "string" && (more[e.data] ?? ERRORS[e.data])) || "That didn’t work. Try again in a moment.";

/** How customers see a specialist's name: "Ana M.", as in the prototype. */
export const shortName = (full: string) => {
  const [first, ...rest] = full.trim().split(/\s+/);
  const last = rest.at(-1);
  return `${first ?? "Specialist"}${last ? ` ${last[0]!.toUpperCase()}.` : ""}`.slice(0, 40);
};

export type Check = { s: "pass" | "warn" | "fail"; t: string; x: string };
export function Checks({ list }: { list: Check[] }) {
  return (
    <div className="checks">
      {list.map((c) => {
        const Icon = c.s === "pass" ? CheckIcon : c.s === "warn" ? MinusIcon : XIcon;
        return <div key={c.t} className={`chk ${c.s}`}><span className="dot" aria-hidden="true"><Icon /></span><div><b>{c.t}<span className="sr-only"> ({c.s})</span></b><small>{c.x}</small></div></div>;
      })}
    </div>
  );
}

/** Whose hours the sheet edits. `items` are the booked calls to warn about; leave it out where none are loaded. */
export type HoursOwner = {
  operatorId: string; name: string; title: string; active: boolean; availability: Availability | null;
  timeZone: string; today: string; items?: AgendaItem[];
};

const WEEKDAYS = [1, 2, 3, 4, 5];

export function AvailabilitySheet({ owner, own, onClose, onDone }: { owner: HoursOwner; own: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const save = useMutation(calendarApi.setAvailability);
  const [av, setAv] = useState<Availability>(() => structuredClone(owner.availability ?? DEFAULT_AVAILABILITY));
  const [title, setTitle] = useState(owner.title || "Credit specialist");
  const [active, setActive] = useState(owner.active);
  const [offDate, setOffDate] = useState("");
  const [offWhy, setOffWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowLocal] = useState(() => localAt(Date.now(), owner.timeZone));
  const set = (patch: Partial<Availability>) => setAv((a) => ({ ...a, ...patch }));
  const setDay = (i: number, h: string[] | null) => setAv((a) => {
    const weekly = { ...a.weekly };
    if (h) weekly[i] = h; else delete weekly[i];
    return { ...a, weekly };
  });
  const brk = av.breaks[0] ?? ["", ""];
  const setBreak = (k: 0 | 1, v: string) => {
    const next = [k === 0 ? v : brk[0]!, k === 1 ? v : brk[1]!];
    set({ breaks: next[0] || next[1] ? [next] : [] });
  };
  const hit = owner.items?.filter((b) => (b.state === "booked" || b.state === "pending") && b.start > nowLocal && outsideHours(av, b));
  const who = own ? "you" : owner.name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = { ...av, breaks: av.breaks.filter((b) => b[0] && b[1]) };
    const problem = availabilityError(clean);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr(null);
    try {
      await save({ operatorId: owner.operatorId, name: owner.name, title: title.trim(), active, availability: clean });
      onDone(active ? "Saved. New bookings use these hours." : `Saved. Customers can’t book ${who} until booking is back on.`);
    } catch (x) { setErr(errorText(x)); setBusy(false); }
  };

  const time = (id: string, value: string, label: string, onChange: (v: string) => void, disabled = false) =>
    <input className="input mono" type="time" step={1800} id={id} value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;

  return (
    <Sheet title={own ? "Availability" : `${owner.name}’s availability`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      <button type="submit" form="av-form" className="btn btn-dark btn-sm" disabled={busy}>Save</button>
    </>}>
      <form className="sheet-b" id="av-form" noValidate onSubmit={submit}>
        <p style={{ fontSize: 13, color: "var(--text-2)" }}>
          Customers see open slots inside these hours. Changes apply to new bookings; calls already booked stay.
          {!owner.availability && " These are the default hours until they’re saved."}
        </p>
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Customers can book calls with {own ? "me" : owner.name} from the chat</span></label>
        <div className="field"><label htmlFor="av-title">Title shown to customers</label>
          <input className="input" id="av-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><span className="lbl">Weekly hours</span>
          {WEEKDAYS.map((i) => {
            const h = av.weekly[i];
            return (
              <div key={i} className="day-row">
                <label className="check"><input type="checkbox" checked={!!h} onChange={(e) => setDay(i, e.target.checked ? ["09:00", "17:00"] : null)} /><span className="sr-only">Available on {LONG_DAYS[i]}</span></label>
                <span className="lbl">{DAYS[i]}</span>
                {time(`av-from-${i}`, h?.[0] ?? "09:00", `${LONG_DAYS[i]} from`, (v) => setDay(i, [v, h?.[1] ?? "17:00"]), !h)}
                {time(`av-to-${i}`, h?.[1] ?? "17:00", `${LONG_DAYS[i]} to`, (v) => setDay(i, [h?.[0] ?? "09:00", v]), !h)}
              </div>
            );
          })}
          <small>Weekends stay closed in this version.</small>
        </div>
        <div className="field"><span className="lbl">Daily break</span>
          <div className="row2">{time("av-brk-from", brk[0] ?? "", "Break from", (v) => setBreak(0, v))}{time("av-brk-to", brk[1] ?? "", "Break to", (v) => setBreak(1, v))}</div></div>
        <div className="row2">
          <div className="field"><label htmlFor="av-cap">Calls a day</label>
            <input className="input mono" id="av-cap" type="number" min={1} max={16} value={Number.isNaN(av.dailyCap) ? "" : av.dailyCap} onChange={(e) => set({ dailyCap: parseInt(e.target.value, 10) })} />
            <small>A full day shows no open slots.</small></div>
          <div className="field"><label htmlFor="av-lead">Earliest booking</label>
            <select className="select" id="av-lead" value={av.minLeadHours} onChange={(e) => set({ minLeadHours: +e.target.value })}>
              {[...new Set([1, 2, 4, 24, av.minLeadHours])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} h ahead</option>)}</select></div>
        </div>
        <div className="row2">
          <div className="field"><label htmlFor="av-len">Call length</label>
            <select className="select" id="av-len" value={av.slotMinutes} onChange={(e) => set({ slotMinutes: +e.target.value })}>
              {[30, 60].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></div>
          <div className="field"><label htmlFor="av-buf">Gap between calls</label>
            <select className="select" id="av-buf" value={av.bufferMinutes} onChange={(e) => set({ bufferMinutes: +e.target.value })}>
              {[...new Set([0, 10, av.bufferMinutes])].map((n) => <option key={n} value={n}>{n ? `${n} minutes` : "None"}</option>)}</select></div>
        </div>
        <div className="field"><span className="lbl">Days off</span>
          <div className="off-list">
            {av.daysOff.length ? av.daysOff.map((o) => (
              <div key={o.date} className="off-row"><span><span className="mono">{longDay(o.date)}</span> · {o.reason}</span>
                <button type="button" className="icon-btn" aria-label={`Remove ${longDay(o.date)}`} onClick={() => set({ daysOff: av.daysOff.filter((x) => x.date !== o.date) })}><XIcon aria-hidden="true" /></button></div>
            )) : <p className="micro" style={{ fontSize: 12, color: "var(--text-2)" }}>None planned.</p>}
          </div>
          <div className="row2">
            <input className="input mono" type="date" min={owner.today} value={offDate} onChange={(e) => setOffDate(e.target.value)} aria-label="Day off" />
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" value={offWhy} maxLength={80} placeholder="Reason" aria-label="Reason for the day off" onChange={(e) => setOffWhy(e.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm" disabled={!offDate || offDate < owner.today} onClick={() => {
                set({ daysOff: [...av.daysOff.filter((x) => x.date !== offDate), { date: offDate, reason: offWhy.trim() || "Day off" }].sort((a, b) => (a.date < b.date ? -1 : 1)) });
                setOffDate(""); setOffWhy("");
              }}>Add</button>
            </div>
          </div>
        </div>
        {hit && <div className="field"><span className="lbl">Booked calls this week</span>
          <div className="card"><Checks list={[hit.length
            ? { s: "warn", t: `${hit.length} booked call${hit.length === 1 ? " falls" : "s fall"} outside these hours`, x: `${hit.map((b) => `${longDay(b.start)} ${b.start.slice(11)}, ${b.customerName}`).join(" · ")}. They stay booked; cancel them from the calendar if you need to.` }
            : { s: "pass", t: "No booked call this week is affected", x: "New hours apply to new bookings." }]} /></div></div>}
        {err && <p className="err" role="alert">{err}</p>}
      </form>
    </Sheet>
  );
}
