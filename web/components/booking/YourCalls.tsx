"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { CalendarCheckIcon, CalendarXIcon, MessageCircleIcon, VideoIcon } from "lucide-react";
import { bookingApi, type CustomerBooking } from "@/lib/booking-api";
import { errorInfo, logChatError } from "@/lib/chat-log";
import { instantLabel, slotLabel } from "./BookingCard";

/*
 * "Your calls" (/chat/calls): every call the customer booked, as a list, not a calendar. Upcoming first, then past
 * ones. Read from convex/bookings.ts `mine`; each row offers what the booking card offers (confirm, cancel, join).
 */

const STATE: Record<string, [string, string]> = {
  pending: ["Waiting for you to confirm", "var(--amber-ink)"], booked: ["Confirmed", "var(--ok)"], done: ["Done", "var(--text-2)"],
  no_show: ["Missed", "var(--amber-ink)"], customer: ["Cancelled by you", "var(--text-2)"],
  operator: ["Cancelled by the specialist", "var(--amber-ink)"], not_confirmed: ["Released: not confirmed in time", "var(--text-2)"],
};
const upcoming = (b: CustomerBooking) => b.state === "pending" || b.state === "booked";

function Row({ b, busy, onConfirm, onCancel }: { b: CustomerBooking; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const [label, color] = STATE[b.state === "cancelled" ? b.cancelledBy ?? "customer" : b.state] ?? STATE.done!;
  return (
    <li className="chk">
      <div className="chk-h">
        <div>
          <b>{slotLabel(b.start)} · {b.operatorName}, {b.operatorTitle.toLowerCase()}</b>
          <small><span className="ref">{b.bookingId}</span> · {b.minutes}-minute {b.channel === "video" ? "video" : "phone"} call · {b.topic}</small>
        </div>
        <span className="pill" style={{ ["--c" as string]: color }}>{label}</span>
      </div>
      {b.state === "cancelled" && b.cancelledBy === "operator" && b.cancelReason && <p className="chk-wait">{b.operatorName}: {b.cancelReason}</p>}
      {b.canConfirm && <p className="chk-wait">Confirm by {instantLabel(b.confirmBy, b.timeZone)}, or the time is released for someone else.</p>}
      {(b.canConfirm || b.canCancel || b.joinUrl || b.threadId) && (
        <div className="plan-row-acts">
          {b.canConfirm && <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={onConfirm}><CalendarCheckIcon aria-hidden="true" />Confirm call</button>}
          {b.joinUrl && <a className="btn btn-dark btn-sm" href={b.joinUrl} target="_blank" rel="noopener noreferrer"><VideoIcon aria-hidden="true" />Join video call</a>}
          {b.canCancel && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}><CalendarXIcon aria-hidden="true" />Cancel call</button>}
          {b.threadId && <Link className="btn btn-ghost btn-sm" href={`/chat?thread=${b.threadId}`}><MessageCircleIcon aria-hidden="true" />Open the chat</Link>}
        </div>
      )}
    </li>
  );
}

export function YourCalls({ announce }: { announce: (text: string) => void }) {
  const rows = useQuery(bookingApi.mine, {});
  const confirm = useMutation(bookingApi.confirm);
  const cancel = useMutation(bookingApi.cancel);
  const [busy, setBusy] = useState(false);
  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); announce(done); }
    catch (e) { logChatError(`calls ${what} failed`, errorInfo(e)); announce("That didn’t go through. Please try again."); }
    finally { setBusy(false); }
  };
  const groups: [string, CustomerBooking[]][] = rows ? [["Upcoming", rows.filter(upcoming).reverse()], ["Past and cancelled", rows.filter((b) => !upcoming(b))]] : [];
  return (
    <section className="checks" aria-labelledby="title">
      <div className="checks-in">
        <p>Calls you booked with a Raiffeisen specialist. They go through information with you: not financial advice or a credit decision.</p>
        {rows === undefined ? <p className="chk-wait" role="status">Loading your calls…</p>
          : rows.length === 0 ? <p className="chk-empty">No calls yet. You can book one from any answer with “Talk to a specialist”.</p>
          : groups.map(([label, xs]) => xs.length > 0 && (
            <div key={label} style={{ display: "grid", gap: 10 }}>
              <span className="grp eyebrow">{label}</span>
              <ul className="chk-list">{xs.map((b) => (
                <Row key={b.bookingId} b={b} busy={busy}
                  onConfirm={() => void run("confirm", () => confirm({ bookingId: b.bookingId }), "Call confirmed.")}
                  onCancel={() => void run("cancel", () => cancel({ bookingId: b.bookingId }), "Call cancelled.")} />
              ))}</ul>
            </div>
          ))}
      </div>
    </section>
  );
}
