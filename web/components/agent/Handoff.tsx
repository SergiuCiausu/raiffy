"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckIcon, HeadsetIcon, UserRoundIcon } from "lucide-react";
import { handoffApi, type HandoffReason, type MessageId, type ThreadId } from "@/lib/agent-api";
import { BookingCard } from "@/components/booking/BookingCard";

const day = (at: number) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * "Talk to a specialist" under an answer, offered by code only where a person is needed and at most once per
 * conversation (lib/agent/handoff.ts). It opens the booking card with an operator, who checks information with the
 * customer and never advises or decides credit; only the customer's click books.
 */
export function SpecialistOffer({ threadId, label }: { threadId: ThreadId | null; label: string }) {
  const [open, setOpen] = useState(false);
  if (open) return <BookingCard threadId={threadId} />;
  return <button type="button" className="btn btn-ghost handoff-btn" onClick={() => setOpen(true)}><HeadsetIcon aria-hidden="true" />{label}</button>;
}

/**
 * Not shown in this preview: booking goes to operators (SpecialistOffer), so this adviser request is kept for later.
 * "Book an adviser" under an answer. The first tap shows exactly what the adviser will receive (the customer's own
 * messages, with identifiers masked); only "Send request" records it. The result says "requested", never "booked",
 * because no adviser queue is connected in this preview.
 */
export function AdviserHandoff({ messageId, label, reason }: { messageId: MessageId; label: string; reason: HandoffReason }) {
  const state = useQuery(handoffApi.forMessage, { messageId });
  const send = useMutation(handoffApi.request);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (state === undefined) return null;
  if (state.request) {
    return (
      <div className="gcard mem-card handoff-card" role="status">
        <div className="gc-h"><span><CheckIcon />Adviser request sent</span><span className="micro">Ref. {state.request.reference}</span></div>
        <p className="handoff-note">
          Recorded {day(state.request.createdAt)}. A Raiffeisen adviser picks it up with the messages you shared. Quote the
          reference if you contact the bank. In this preview no adviser is notified yet.
        </p>
      </div>
    );
  }
  if (!open) {
    return <button type="button" className="btn btn-ghost handoff-btn" onClick={() => setOpen(true)}><UserRoundIcon />{label}</button>;
  }

  const confirm = async () => {
    setBusy(true); setFailed(false);
    try { await send({ messageId, reason }); } catch { setFailed(true); } finally { setBusy(false); }
  };

  return (
    <div className="gcard mem-card handoff-card">
      <div className="gc-h"><span><UserRoundIcon />The adviser will see this conversation</span><span className="micro">You decide</span></div>
      <ul className="mem-list">
        {state.preview.map((line, i) => <li key={i} className="mem-item"><div className="mem-body"><small>{line}</small></div></li>)}
      </ul>
      <p className="handoff-note">Card numbers, CNP, IBAN, e-mail and phone numbers are masked. Nothing is sent until you choose Send request.</p>
      <div className="mem-acts handoff-acts">
        <button type="button" className="btn btn-dark" disabled={busy || !state.preview.length} onClick={() => void confirm()}>Send request</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {failed && <p className="mem-status" role="alert">Couldn’t send the request. Please try again.</p>}
    </div>
  );
}
