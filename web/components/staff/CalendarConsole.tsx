"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarCheckIcon, CalendarClockIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, FileCheck2Icon, FileX2Icon,
  HourglassIcon, LockIcon, PhoneIcon, ShieldCheckIcon, ShieldIcon, UserXIcon, VideoIcon,
} from "lucide-react";
import { calendarApi, type AgendaItem, type BookingState, type CalendarWeek } from "@/lib/booking-api";
import {
  dayOff, endOf, gridRange, hhmm, hoursOn, localAt, minutesOf,
} from "@/lib/calendar";
import type { Role } from "@/lib/roles";
import { ConsoleNav } from "./StaffNav";
import { AvailabilitySheet, Checks, DAYS, dayMonth, errorText as sheetErrorText, longDay, shortName, type Check } from "./AvailabilitySheet";
import { Sheet } from "./Sheet";
import { StaffShell, initials } from "./StaffShell";

/*
 * The operator's calendar (console.html#calendar) over convex/bookings.ts: a Monday-to-Friday week grid (an agenda
 * on phones), the next call, the booking rules, a sheet per call (join, cancel with a reason the customer sees, or
 * record the outcome) and an availability sheet. Open slots and every permission come from Convex; an admin can open
 * another operator's calendar. Times are wall-clock in the operator's zone.
 */

const STATE: Record<BookingState, string> = { booked: "Booked", pending: "Awaiting confirmation", done: "Done", no_show: "No-show", cancelled: "Cancelled" };
const STEP = 30;

const ymd = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00Z`);
const dayName = (date: string) => `${DAYS[ymd(date).getUTCDay()]} ${ymd(date).getUTCDate()}`;
const addDays = (date: string, n: number) => new Date(ymd(date).getTime() + n * 86_400_000).toISOString().slice(0, 10);

const ERRORS: Record<string, string> = {
  forbidden: "You can only change your own calendar.",
  booking_unavailable: "This call isn’t on your calendar any more.",
  booking_not_cancellable: "This call can’t be cancelled any more.",
  booking_outcome_too_early: "You can record what happened once the call has started.",
  cancel_reason_invalid: "Add a reason the customer will see (up to 200 characters).",
  availability_invalid: "These hours can’t be saved. Check the times and try again.",
  operator_name_invalid: "Add a title of up to 60 characters.",
};
const errorText = (e: unknown) => sheetErrorText(e, ERRORS);

/** Re-renders every minute, so past slots shade and the join button opens without a reload. */
function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
  return now;
}

/* ───────────── Week ───────────── */

function Call({ b, style, onOpen }: { b: AgendaItem; style?: React.CSSProperties; onOpen: (id: string) => void }) {
  const Icon = b.state === "pending" ? HourglassIcon : b.state === "done" ? CheckIcon : b.state === "no_show" ? UserXIcon : null;
  const time = b.start.slice(11);
  return (
    <button type="button" className={`bk ${b.state}`} style={style} onClick={() => onOpen(b.bookingId)}
      aria-label={`${longDay(b.start)}, ${time}, ${b.customerName}, ${b.topic}, ${STATE[b.state]}`}>
      <span className="l1"><span className="mono">{time}</span><b>{b.customerName}</b>{Icon && <Icon aria-hidden="true" />}</span>
      <span className="tp" title={b.topic}>{b.topic}</span>
      {b.state !== "booked" && <span className="st">{STATE[b.state]}</span>}
    </button>
  );
}

function Grid({ data, nowLocal, onOpen }: { data: CalendarWeek; nowLocal: string; onOpen: (id: string) => void }) {
  const av = data.availability;
  const dates = data.days.map((d) => d.date);
  const { first, last } = gridRange(dates, av, data.items);
  const rows = (last - first) / STEP;
  const at = (m: number, span: number, col: number) => ({ gridRow: `${2 + (m - first) / STEP} / span ${span}`, gridColumn: col });
  const cells: ReactNode[] = [<span key="corner" />];
  data.days.forEach((d, i) => {
    const off = dayOff(av, d.date);
    const n = data.items.filter((b) => b.start.startsWith(d.date) && (b.state === "booked" || b.state === "pending")).length;
    const today = d.date === data.today;
    cells.push(
      <div key={`hd-${d.date}`} className={`hd${today ? " today" : ""}`} style={{ gridColumn: i + 2 }}>
        {dayName(d.date)}{today && <span className="sr-only">, today</span>}
        <small>{off ? "Off" : n ? `${n} booked` : ""}</small>
        {!off && <span className="sr-only">, {d.open.length} open slots</span>}
      </div>,
    );
  });
  for (let r = 0; r < rows; r += 1) {
    const m = first + r * STEP;
    cells.push(<span key={`tm-${m}`} className="tm" style={{ gridRow: r + 2, gridColumn: 1 }}>{m % 60 ? "" : hhmm(m)}</span>);
    data.days.forEach((d, i) => {
      const h = hoursOn(av, d.date);
      const outside = !h || !!dayOff(av, d.date) || m < minutesOf(h[0]) || m >= minutesOf(h[1]);
      const past = `${d.date}T${hhmm(m + STEP)}` <= nowLocal;
      cells.push(<div key={`c-${d.date}-${m}`} className={`cell${m % 60 ? " half" : ""}${outside ? " off" : past ? " past" : ""}`} style={{ gridRow: r + 2, gridColumn: i + 2 }} />);
    });
  }
  data.days.forEach((d, i) => {
    const col = i + 2, off = dayOff(av, d.date), h = hoursOn(av, d.date);
    if (off) {
      cells.push(<span key={`off-${d.date}`} className="brk" style={{ ...at(first, rows, col), alignItems: "start", paddingTop: 10 }}>Day off · {off.reason}</span>);
      return;
    }
    if (h && av) av.breaks.forEach(([from, to]) => {
      const s = Math.max(first, minutesOf(from!)), e = Math.min(last, minutesOf(to!));
      if (e > s) cells.push(<span key={`br-${d.date}-${from}`} className="brk" aria-hidden="true" style={at(s, (e - s) / STEP, col)}>Break</span>);
    });
    if (av) d.open.forEach((s) => cells.push(<span key={`o-${s}`} className="open" aria-hidden="true" style={at(minutesOf(s.slice(11)), av.slotMinutes / STEP, col)}>Open</span>));
    data.items.filter((b) => b.start.startsWith(d.date)).forEach((b) => {
      const s = minutesOf(b.start.slice(11));
      cells.push(<Call key={b.bookingId} b={b} onOpen={onOpen}
        style={{ gridRow: `${2 + Math.floor((s - first) / STEP)} / span ${Math.max(1, Math.round(b.minutes / STEP))}`, gridColumn: col }} />);
    });
  });
  return <div className="cal">{cells}</div>;
}

function Agenda({ data, onOpen }: { data: CalendarWeek; onOpen: (id: string) => void }) {
  return (
    <div className="agenda">
      {data.days.map((d) => {
        const list = data.items.filter((b) => b.start.startsWith(d.date)), off = dayOff(data.availability, d.date);
        return (
          <div key={d.date}>
            <div className="ag-day">{longDay(d.date)}<small>{off ? "Off" : `${list.length} call${list.length === 1 ? "" : "s"}`}</small></div>
            <div className="ag-list">
              {list.map((b) => <Call key={b.bookingId} b={b} onOpen={onOpen} />)}
              <p className="ag-open">{off ? `Day off · ${off.reason}`
                : d.open.length ? <>{d.open.length} open: <span className="mono">{d.open.slice(0, 4).map((s) => s.slice(11)).join(", ")}{d.open.length > 4 ? " …" : ""}</span></>
                : "No open slots"}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NextUp({ data, now, onOpen }: { data: CalendarWeek; now: number; onOpen: (id: string) => void }) {
  const next = data.next;
  if (!next) {
    return <section className="card"><div className="card-h"><h2><CalendarClockIcon aria-hidden="true" />Next up</h2></div><div className="nextup"><p>No calls booked.</p></div></section>;
  }
  // Both sides are wall-clock in the operator's zone, so their difference is the time left
  const hrs = Math.round((Date.parse(`${next.start}:00Z`) - Date.parse(`${localAt(now, data.timeZone)}:00Z`)) / 3_600_000);
  return (
    <section className="card" aria-labelledby="nx-h">
      <div className="card-h"><h2 id="nx-h"><CalendarClockIcon aria-hidden="true" />Next up</h2><span className="micro mono">{hrs < 1 ? "within the hour" : `in ${hrs} h`}</span></div>
      <div className="nextup">
        <span className="when">{longDay(next.start)} · {next.start.slice(11)}–{hhmm(endOf(next))}</span>
        <div><b>{next.customerName} · {next.channel === "video" ? "video call" : "phone call"}</b><p>{next.topic}</p></div>
        <div className="access">{next.planShared ? <FileCheck2Icon aria-hidden="true" /> : <FileX2Icon aria-hidden="true" />}
          {next.planShared ? `Plan shared. It opens ${data.rules.shareBeforeMinutes} min before the call.` : "No plan shared."}</div>
        <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(next.bookingId)}>Open call</button></div>
      </div>
    </section>
  );
}

function Rules({ data }: { data: CalendarWeek }) {
  const r = data.rules, av = data.availability;
  const pending = data.items.filter((b) => b.state === "pending").length;
  const list: Check[] = [
    { s: "pass", t: "One open call per customer", x: "A customer who already has a call can cancel it, not book a second one." },
    { s: pending ? "warn" : "pass", t: "Confirmed the day before", x: `Calls not confirmed ${r.confirmBeforeHours} h before they start are released.${pending ? ` ${pending} awaiting confirmation this week.` : ""}` },
    ...(av ? [{ s: "pass" as const, t: `Up to ${av.dailyCap} calls a day, booked ${av.minLeadHours} h ahead`, x: "A full day shows no open slots to customers." }] : []),
    { s: "pass", t: "Plan only around the call", x: `A shared plan opens ${r.shareBeforeMinutes} min before and closes ${r.shareAfterHours} h after the call.` },
    { s: "pass", t: "Information, not advice", x: "You go through the information with the customer; it isn’t advice or a credit decision." },
    ...data.missed.map((m): Check => m.pausedUntil
      ? { s: "fail", t: `${m.customerName} missed ${m.count} calls`, x: `Booking is paused until ${longDay(localAt(m.pausedUntil, data.timeZone))}.` }
      : { s: "warn", t: `${m.customerName} missed a call`, x: `${r.noShowPauseAfter - m.count} more no-show${r.noShowPauseAfter - m.count === 1 ? "" : "s"} pauses booking for ${r.pauseDays} days.` }),
  ];
  return <section className="card" aria-labelledby="br-h"><div className="card-h"><h2 id="br-h"><ShieldCheckIcon aria-hidden="true" />Booking rules</h2></div><Checks list={list} /></section>;
}

/* ───────────── Sheets ───────────── */

const CANCEL_REASONS = ["I’m unavailable at this time", "The topic needs a licensed adviser", "The customer asked to cancel"];

function CallSheet({ b, data, now, onClose, onDone }: { b: AgendaItem; data: CalendarWeek; now: number; onClose: () => void; onDone: (msg: string) => void }) {
  const cancel = useMutation(calendarApi.operatorCancel);
  const outcome = useMutation(calendarApi.recordOutcome);
  const [step, setStep] = useState<"view" | "cancel">("view");
  const [why, setWhy] = useState(CANCEL_REASONS[0]!);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const live = b.state === "booked" || b.state === "pending";
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setErr(null);
    try { await fn(); onDone(msg); } catch (e) { setErr(errorText(e)); setBusy(false); }
  };
  const reason = note.trim() ? `${why}: ${note.trim()}` : why;
  const joinAt = localAt(b.joinFrom, data.timeZone);
  const plan = b.sharedPlan?.plan as { goal?: { summary?: string; product?: string } } | undefined;
  const facts: [string, string][] = [
    ["When", `${longDay(b.start)} · ${b.start.slice(11)}–${hhmm(endOf(b))}`],
    ["Channel", b.channel === "video" ? "Video call" : "Phone call"],
    ["Customer", `${b.customerName} · ${b.customerRef}`],
    ["Status", STATE[b.state] + (b.state === "cancelled" && b.cancelledBy ? ` · by ${b.cancelledBy === "not_confirmed" ? "release, not confirmed" : b.cancelledBy}` : "")],
  ];

  const footer = step === "cancel" ? (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep("view")} disabled={busy}>Back</button>
      <button type="submit" form="cancel-form" className="btn btn-dark btn-sm" disabled={busy}>Cancel call</button>
    </>
  ) : !live ? (
    <button type="button" className="btn btn-dark btn-sm" onClick={onClose}>Close</button>
  ) : b.canRecordOutcome ? (
    <>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => outcome({ bookingId: b.bookingId, outcome: "no_show" }), "Marked as a no-show.")}>No-show</button>
      <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => run(() => outcome({ bookingId: b.bookingId, outcome: "done" }), "Marked as done.")}><CheckIcon aria-hidden="true" />Mark as done</button>
    </>
  ) : (
    <>
      {b.canCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep("cancel")}>Cancel call</button>}
      {b.channel === "video" && (b.joinUrl
        ? <a className="btn btn-dark btn-sm" href={b.joinUrl} target="_blank" rel="noopener noreferrer"><VideoIcon aria-hidden="true" />Join call</a>
        : <button type="button" className="btn btn-dark btn-sm" disabled><VideoIcon aria-hidden="true" />Join from {joinAt.slice(0, 10) === localAt(now, data.timeZone).slice(0, 10) ? joinAt.slice(11) : `${dayMonth(joinAt)} ${joinAt.slice(11)}`}</button>)}
    </>
  );

  return (
    <Sheet title={`Call · ${b.customerRef}`} onClose={onClose} footer={footer}>
      {step === "cancel" ? (
        <form id="cancel-form" className="sheet-b" noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => cancel({ bookingId: b.bookingId, reason }), "Cancelled. The customer sees your reason in the chat and can book another time."); }}>
          <p style={{ fontSize: 13, color: "var(--text-2)" }}>The customer sees this in the chat and can pick another time.</p>
          <div className="field"><label htmlFor="cx-why">Reason</label>
            <select className="select" id="cx-why" value={why} onChange={(e) => setWhy(e.target.value)}>{CANCEL_REASONS.map((r) => <option key={r}>{r}</option>)}</select></div>
          <div className="field"><label htmlFor="cx-note">Note to the customer (optional)</label>
            <textarea className="input" id="cx-note" rows={3} value={note} maxLength={200 - why.length - 2} onChange={(e) => setNote(e.target.value)} placeholder="For example: I’m out of the office that morning. Please pick another time." /></div>
          {err && <p className="err" role="alert">{err}</p>}
        </form>
      ) : (
        <div className="sheet-b">
          <h3 style={{ fontSize: 16, letterSpacing: "-.01em" }}>{b.topic}</h3>
          <div className="card"><div className="facts">{facts.map(([k, v]) => <div key={k} className="fact"><span>{k}</span><b>{v}</b></div>)}</div></div>
          <div className="field"><span className="lbl">What the customer shared</span>
            {!b.planShared ? <p className="note-q">The customer didn’t share a plan. Ask them what they’d like to go through.</p>
              : b.sharedPlan ? <div className="note-q"><b>Plan {b.sharedPlan.planId} · version {b.sharedPlan.version}</b>{plan?.goal?.product ?? "Plan"}{plan?.goal?.summary ? `: ${plan.goal.summary}` : ""}</div>
              : <div className="access"><LockIcon aria-hidden="true" />A plan is shared. It opens {data.rules.shareBeforeMinutes} min before the call and closes {data.rules.shareAfterHours} h after it.</div>}
          </div>
          {b.channel === "phone" && live && <p className="access"><PhoneIcon aria-hidden="true" />Demo: nobody phones the customer from here.</p>}
          {b.state === "pending" && <p className="access"><HourglassIcon aria-hidden="true" />Not confirmed yet. It’s released {data.rules.confirmBeforeHours} h before the start if the customer doesn’t confirm.</p>}
          <p className="lock"><ShieldIcon aria-hidden="true" />You go through information with the customer. It isn’t advice or a credit decision, and investment questions go to a licensed adviser.</p>
          {err && <p className="err" role="alert">{err}</p>}
        </div>
      )}
    </Sheet>
  );
}

/* ───────────── Page ───────────── */

export function CalendarConsole({ me }: { me: { name: string; role: Role } }) {
  const admin = me.role === "admin";
  const [offset, setOffset] = useState(0);
  const [owner, setOwner] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const now = useMinute();
  const data = useQuery(calendarApi.calendar, { operatorId: owner, weekOffset: offset });
  const owners = useQuery(calendarApi.calendars, admin ? {} : "skip");

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const own = !owner;
  const opened = openId && data ? data.items.find((b) => b.bookingId === openId) ?? (data.next?.bookingId === openId ? data.next : null) : null;
  const done = (msg: string) => { setOpenId(null); setEditing(false); setToast(msg); };

  const top = data && (
    <>
      <div className="weeknav" role="group" aria-label="Week">
        <button type="button" className="icon-btn" aria-label="Previous week" disabled={data.weekOffset <= -8} onClick={() => setOffset(data.weekOffset - 1)}><ChevronLeftIcon aria-hidden="true" /></button>
        <span className="mono">{dayMonth(data.week)} – {dayMonth(addDays(data.week, 4))}</span>
        <button type="button" className="icon-btn" aria-label="Next week" disabled={data.weekOffset >= 8} onClick={() => setOffset(data.weekOffset + 1)}><ChevronRightIcon aria-hidden="true" /></button>
        {data.weekOffset !== 0 && <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOffset(0)}>This week</button>}
      </div>
      {data.availability && <button type="button" className="btn btn-ghost btn-sm" aria-label="Availability" onClick={() => setEditing(true)}><ClockIcon aria-hidden="true" /><span className="av-lbl">Availability</span></button>}
    </>
  );
  const count = (...s: BookingState[]) => data?.items.filter((b) => s.includes(b.state)).length ?? 0;
  const whose = own ? "Your calendar" : `${data?.operator?.name ?? "Specialist"}’s calendar`;

  return (
    <StaffShell logoHref="/console" nav={<ConsoleNav current="calendar" />} me={{ name: me.name, title: admin ? "Admin" : "Operator", initials: initials(me.name) }}
      crumbs={[{ label: "Console", href: "/console" }, { label: "Calendar" }]} top={top}>
      {data === undefined ? <p className="empty-row" role="status">Loading the calendar…</p> : (
        <>
          <div className="page-head">
            <div>
              <h1>{whose}</h1>
              <p>Customers book {data.availability?.slotMinutes ?? 30}-minute calls {own ? "with you " : ""}from the chat. You go through the information with them; it isn’t advice or a credit decision.</p>
            </div>
            {admin && owners && owners.length > 0 && (
              <div className="field">
                <label htmlFor="cal-owner">Calendar</label>
                <select className="select" id="cal-owner" value={owner ?? ""} onChange={(e) => { setOwner(e.target.value || undefined); setOpenId(null); }}>
                  <option value="">Mine</option>
                  {owners.map((o) => <option key={o.operatorId} value={o.operatorId}>{o.name}{o.active ? "" : " (not bookable)"}</option>)}
                </select>
              </div>
            )}
          </div>

          {!data.availability ? (
            <section className="card"><div className="nextup">
              <b>{own ? "Set your hours so customers can book a call with you" : "This specialist hasn’t set hours yet"}</b>
              <p>Raiffy offers customers open slots inside your weekly hours, around your breaks and days off.</p>
              {own && <div><button type="button" className="btn btn-dark btn-sm" onClick={() => setEditing(true)}><CalendarCheckIcon aria-hidden="true" />Set your hours</button></div>}
            </div></section>
          ) : (
            <>
              {!data.operator?.active && <p className="access" style={{ marginBottom: 16 }}><LockIcon aria-hidden="true" />Booking is off: customers don’t see {own ? "you" : "this specialist"} in the chat. Turn it on under Availability.</p>}
              <div className="kpis">
                {[[count("booked", "pending"), "Booked"], [data.days.reduce((a, d) => a + d.open.length, 0), "Open slots left"], [count("done"), "Done"], [count("no_show"), "No-shows"]].map(([n, l]) =>
                  <div key={l} className="kpi"><b>{n}</b><span>{l}</span></div>)}
              </div>
              <div className="cal-ws">
                <section className="card" aria-label={`Week of ${dayMonth(data.week)}`}>
                  <Grid data={data} nowLocal={localAt(now, data.timeZone)} onOpen={setOpenId} />
                  <Agenda data={data} onOpen={setOpenId} />
                </section>
                <div className="col"><NextUp data={data} now={now} onOpen={setOpenId} /><Rules data={data} /></div>
              </div>
            </>
          )}

          {opened && <CallSheet key={opened.bookingId} b={opened} data={data} now={now} onClose={() => setOpenId(null)} onDone={done} />}
          {editing && <AvailabilitySheet own={own} onClose={() => setEditing(false)} onDone={done} owner={{
            operatorId: data.operatorId, name: data.operator?.name ?? shortName(me.name), title: data.operator?.title ?? "", active: data.operator?.active ?? true,
            availability: data.availability, timeZone: data.timeZone, today: data.today, items: data.items,
          }} />}
        </>
      )}
      <div className="toast" role="status" hidden={!toast}>{toast && <><CalendarCheckIcon aria-hidden="true" />{toast}</>}</div>
    </StaffShell>
  );
}
