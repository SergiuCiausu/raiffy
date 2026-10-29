"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarCheckIcon, CalendarXIcon, ClockIcon, HeadsetIcon, InfoIcon, ShieldCheckIcon, VideoIcon } from "lucide-react";
import Link from "next/link";
import { answerCheckApi, type ThreadId } from "@/lib/agent-api";
import { bookingApi, planListApi, type BookableOperator, type BookingOptions, type Channel, type CustomerBooking } from "@/lib/booking-api";
import { errorInfo, logChatError } from "@/lib/chat-log";

/*
 * Booking a call with a specialist (chat.html's `.book` card, DESIGN.md → Calendar and booking). Slots come from
 * convex/bookings.ts, computed from the operator's hours; only the customer's click books. The card says what the
 * call is not, how the bank will and won't contact the customer, and leaves plan sharing unticked.
 */

/** "Thu 29 Oct, 10:00" for a wall-clock start, read as written (it is already in the operator's zone). */
export function slotLabel(start: string) {
  const at = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(at);
  return `${day}, ${start.slice(11, 16)}`;
}
export const instantLabel = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ms);
export const timeLabel = (ms: number, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(ms);

const REFUSED: Record<string, string> = {
  slot_unavailable: "That time was just taken. Pick another one.",
  already_booked: "You already have a call booked. Cancel it first to pick another time.",
  same_time: "You already have a call at that time. Pick another one.",
  one_per_day: "You already have a call with this specialist that day. Pick another day.",
  paused: "Booking is paused after two missed calls.",
  paused_cancellations: "Booking is paused after several cancellations this week.",
  too_many_attempts: "Too many tries in a few minutes. Wait a little, then try again.",
};
const PAUSED = { missed: "after two missed calls", cancellations: "after three cancellations in a week" } as const;

export function BookingCard({ threadId, topic = "" }: { threadId: ThreadId | null; topic?: string }) {
  const options = useQuery(bookingApi.options, {});
  const plans = useQuery(planListApi.listForThread, threadId ? { threadId } : "skip");
  const book = useMutation(bookingApi.book);
  const confirm = useMutation(bookingApi.confirm);
  const cancel = useMutation(bookingApi.cancel);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); }
    catch (e) { logChatError(`booking ${what} failed`, errorInfo(e)); setError("That didn’t go through. Please try again."); }
    finally { setBusy(false); }
  };

  const plan = plans?.[0] ?? null;
  return (
    <div className="answer-cards">
      <div className="gcard book-card">
        <div className="gc-h"><span><HeadsetIcon aria-hidden="true" />Talk to a specialist</span><span className="micro">Demo</span></div>
        <div className="gc-b book solo">
          {options === undefined ? <p className="micro">Loading open times…</p>
            : options.booking && (options.booking.state === "booked" || options.booking.state === "pending")
              ? <Booked b={options.booking} busy={busy}
                  onConfirm={() => run("confirm", () => confirm({ bookingId: options.booking!.bookingId }))}
                  onCancel={() => run("cancel", () => cancel({ bookingId: options.booking!.bookingId }))} />
              : <Picker operator={options.operators.find((o) => o.slots.length) ?? options.operators[0] ?? null}
                  notice={options.booking} pausedUntil={options.pausedUntil} pauseCause={options.pauseCause} topic={topic} planId={plan?.planId ?? null} busy={busy}
                  onBook={(args) => run("book", async () => {
                    const r = await book({ ...args, ...(threadId ? { threadId } : {}) });
                    if (r.status === "refused") setError(REFUSED[r.reason] ?? "That time isn’t available. Pick another one.");
                  })} />}
          {error && <p className="book-note" role="alert"><InfoIcon aria-hidden="true" /><span>{error}</span></p>}
        </div>
      </div>
    </div>
  );
}

function Booked({ b, busy, onConfirm, onCancel }: { b: CustomerBooking; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const how = b.channel === "video" ? "a video call" : "a phone call";
  return (
    <>
      <div className="booked" role="status">
        <CalendarCheckIcon aria-hidden="true" />
        <span><b>Booked: {slotLabel(b.start)}</b> with {b.operatorName}, {how}. {b.sharePlan && b.planId ? `${b.operatorName} can see plan ${b.planId} from 15 minutes before.` : "No plan shared."}</span>
      </div>
      {b.reminder === "confirm" && (
        <p className="book-note"><ClockIcon aria-hidden="true" /><span><b>Please confirm by {instantLabel(b.confirmBy, b.timeZone)}</b>, or the time is released for someone else.</span></p>
      )}
      {b.reminder === "starts_soon" && b.channel === "video" && !b.joinUrl && (
        <p className="book-note"><ClockIcon aria-hidden="true" /><span>Starts soon. The video link appears here at {timeLabel(b.joinFrom, b.timeZone)}.</span></p>
      )}
      {b.channel === "phone" && (
        <p className="book-note"><InfoIcon aria-hidden="true" /><span>Demo: nobody will phone you. In the real service the bank calls from its official number.</span></p>
      )}
      <p className="book-note"><ShieldCheckIcon aria-hidden="true" /><span>You have one call booked. To pick another time, cancel this one first. <Link href="/chat/calls">See all your calls</Link></span></p>
      <div className="book-row">
        {b.canConfirm && <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={onConfirm}><CalendarCheckIcon aria-hidden="true" />Confirm call</button>}
        {b.joinUrl && (
          <a className="btn btn-dark btn-sm" href={b.joinUrl} target="_blank" rel="noopener noreferrer"><VideoIcon aria-hidden="true" />Join video call</a>
        )}
        {b.canCancel && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}><CalendarXIcon aria-hidden="true" />Cancel call</button>}
        {b.joinUrl && <span className="micro">Demo: a public Jitsi room</span>}
      </div>
    </>
  );
}

type BookArgs = { operatorId: string; start: string; channel: Channel; topic: string; sharePlan: boolean };

function Picker({ operator, notice, pausedUntil, pauseCause, topic, planId, busy, onBook }: {
  operator: BookableOperator | null; notice: CustomerBooking | null; pausedUntil: number | null; pauseCause: BookingOptions["pauseCause"];
  topic: string; planId: string | null; busy: boolean; onBook: (args: BookArgs) => void;
}) {
  const id = useId();
  const email = useQuery(answerCheckApi.emailAvailability, {});
  const [start, setStart] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>("video");
  const [about, setAbout] = useState(topic.slice(0, 120));
  const [share, setShare] = useState(false);

  const cancelled = notice?.state === "cancelled" && (
    notice.cancelledBy === "operator"
      ? `${notice.operatorName} cancelled your call on ${slotLabel(notice.start)}${notice.cancelReason ? `: ${notice.cancelReason}` : ""}.`
      : notice.cancelledBy === "not_confirmed" ? `Your call on ${slotLabel(notice.start)} was released because it wasn’t confirmed in time.` : null);

  if (pausedUntil !== null) {
    return <p className="book-note"><InfoIcon aria-hidden="true" /><span>Booking is paused until {instantLabel(pausedUntil, operator?.timeZone ?? "Europe/Bucharest")} {PAUSED[pauseCause ?? "missed"]}. You can still reach Raiffeisen at a branch or through raiffeisen.ro.</span></p>;
  }
  if (!operator || !operator.slots.length) {
    return <p className="book-note"><InfoIcon aria-hidden="true" /><span>No specialist has open times right now. You can still reach Raiffeisen at a branch or through raiffeisen.ro.</span></p>;
  }
  const ready = !!start && !!about.trim() && !busy;
  return (
    <>
      {cancelled && <div className="booked off" role="status"><CalendarXIcon aria-hidden="true" /><span>{cancelled} Pick another time below.</span></div>}
      <div className="adv">
        <span className="ava" aria-hidden="true">{operator.initials}</span>
        <div><b>{operator.name}, {operator.title.toLowerCase()}</b><span className="micro">{operator.minutes}-minute call · video or phone</span></div>
      </div>
      <div className="slots" role="group" aria-label="Choose a time">
        {operator.slots.map((s) => <button key={s} type="button" aria-pressed={start === s} onClick={() => setStart(s)}>{slotLabel(s)}</button>)}
      </div>
      <div className="slots" role="group" aria-label="Call type">
        {(["video", "phone"] as const).map((c) => (
          <button key={c} type="button" aria-pressed={channel === c} onClick={() => setChannel(c)}>{c === "video" ? "Video" : "Phone"}</button>
        ))}
      </div>
      <div className="book-topic">
        <label htmlFor={`${id}-topic`}>What would you like to go through?</label>
        <input id={`${id}-topic`} className="input" value={about} maxLength={120} placeholder="For example: documents for a personal loan" onChange={(e) => setAbout(e.target.value)} />
      </div>
      {planId && (
        <>
          <label className="check"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span><b>Share plan {planId} with {operator.name}</b><br />Only around this call: from 15 minutes before until a day after.</span></label>
          <details><summary>See what’s sent</summary><ul>
            <li>The plan’s goal, figures, routes and sources</li><li>Not this conversation’s messages</li><li>Never your balance, card numbers, IBAN or CNP</li>
          </ul></details>
        </>
      )}
      <p className="book-note"><InfoIcon aria-hidden="true" /><span>{operator.name} goes through the information with you. It isn’t financial advice or a credit decision.</span></p>
      <p className="book-note"><ShieldCheckIcon aria-hidden="true" /><span>
        {email?.enabled ? `We’ll e-mail the time and reference to ${email.testMode ? "a test inbox in this preview, not to you" : email.address}. ` : ""}
        You confirm only in the app. {operator.name} will never ask for codes, card details or a transfer.</span></p>
      <div className="book-row">
        <button type="button" className="btn btn-dark btn-sm" disabled={!ready}
          onClick={() => start && onBook({ operatorId: operator.operatorId, start, channel, topic: about.trim(), sharePlan: share && !!planId })}>
          <CalendarCheckIcon aria-hidden="true" />Book call
        </button>
        <span className="micro">{!start ? "Pick a time first" : !about.trim() ? "Add what you’d like to go through" : "Demo booking"}</span>
      </div>
    </>
  );
}
