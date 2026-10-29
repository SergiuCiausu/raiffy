"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueries, type RequestForQueries } from "convex/react";
import { ConvexError } from "convex/values";
import { BadgeCheckIcon, ClockIcon, PencilLineIcon, SendIcon, Undo2Icon, UserCheckIcon } from "lucide-react";
import { answerCheckApi, type AnswerCheck, type MessageId } from "@/lib/agent-api";

/*
 * "Ask a specialist" under an answer (chat.html → Human verification). The button sits in the answer's footer; the
 * request panel and the status that comes back sit below it. A specialist confirms the information, never a credit
 * decision. The status arrives live from convex/answerChecks.ts forThread, read once per conversation by AgentChat.
 */

const NOTE_MAX = 500;
const EMAIL_QUERY: RequestForQueries = { email: { query: answerCheckApi.emailAvailability, args: {} } };
const time = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });

/** Only finished answers with text can be checked; the server checks the same (lib/review/answerCheck.ts canFlag). */
export function canAskSpecialist(status: string | undefined): boolean {
  return status === "answered" || status === "no_results";
}

export function AnswerCheckButton({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="vbtn" data-act="verify" onClick={onOpen}><UserCheckIcon aria-hidden="true" />Ask a specialist</button>;
}

/** The request panel while drafting, then the check's status. Renders nothing before either. */
export function AnswerCheckZone({ messageId, check, drafting, onClose, announce }: {
  messageId: MessageId; check: AnswerCheck | undefined; drafting: boolean; onClose: (sent: boolean) => void; announce: (msg: string) => void;
}) {
  const previous = useRef(check?.status);
  useEffect(() => {
    if (!check || previous.current === check.status) return;
    if (previous.current === "open") {
      announce(check.status === "confirmed" ? "A specialist confirmed an answer." : check.status === "corrected" ? "A specialist corrected an answer." : "A specialist sent an answer back.");
    }
    previous.current = check.status;
  }, [check, announce]);

  if (check) return <div className="vzone"><Status check={check} /></div>;
  if (drafting) return <div className="vzone"><Request messageId={messageId} onClose={onClose} announce={announce} /></div>;
  return null;
}

function Request({ messageId, onClose, announce }: { messageId: MessageId; onClose: (sent: boolean) => void; announce: (msg: string) => void }) {
  const send = useMutation(answerCheckApi.request);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  // As a value, not a throw: if e-mail can't be checked, the panel just doesn't mention it
  const email = useQueries(EMAIL_QUERY).email as { enabled: boolean; address: string | null; testMode: boolean } | Error | undefined;
  const emailed = email && !(email instanceof Error) && email.enabled ? email : null;
  useEffect(() => { field.current?.focus(); }, []);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await send({ messageId, ...(note.trim() ? { note: note.trim() } : {}) });
      announce("Request sent. A specialist will check this answer.");
      onClose(true);
    } catch (e) {
      setError(e instanceof ConvexError && e.data === "answer_check_limit_reached"
        ? "You’ve sent five checks today. Try again tomorrow, or talk to a specialist from the header."
        : "That didn’t send. Try again in a moment.");
      setBusy(false);
    }
  };

  return (
    <div className="vreq" role="group" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Ask a specialist to check this answer</h3>
      <p>A Raiffeisen specialist sees your recent questions and this answer. They confirm the information, not a credit decision.</p>
      <details>
        <summary>See what’s sent</summary>
        <ul>
          <li>Your last few questions in this chat, with card numbers, CNP, IBAN, e-mail addresses and phone numbers masked</li>
          <li>This answer and its sources</li>
          <li>Your note, if you add one</li>
        </ul>
      </details>
      <label className="sr-only" htmlFor={`${id}-n`}>Note for the specialist</label>
      <textarea id={`${id}-n`} ref={field} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="What should they look at? (optional)" />
      {emailed && (
        <p className="micro">We’ll e-mail {emailed.address} when it’s received and when the specialist replies: only the reference and the status, never the answer.
          {emailed.testMode && " In this preview the e-mails go to a test inbox, not to you."}</p>
      )}
      <p className="micro">In this preview there’s no set response time. The specialist’s reply appears here, under the answer.</p>
      {error && <p className="micro" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void submit()}><SendIcon aria-hidden="true" />Send request</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onClose(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** The status line under an answer, also used in "Your specialist checks". */
export function Status({ check }: { check: AnswerCheck }) {
  const by = check.reviewer ? `${check.reviewer.name}, ${check.reviewer.role.toLowerCase()}` : "a specialist";
  const at = check.decidedAt ? ` · ${time.format(check.decidedAt)}` : "";
  if (check.status === "open") {
    return <p className="vstat" role="status"><ClockIcon aria-hidden="true" /><span><b>Waiting for a specialist</b> · Ref. {check.reference}. You can keep chatting.</span></p>;
  }
  if (check.status === "confirmed") {
    return <p className="vstat ok" role="status"><BadgeCheckIcon aria-hidden="true" /><span><b>Confirmed by {by}{at}</b>. Still AI-generated, checked by a person.</span></p>;
  }
  if (check.status === "corrected") {
    return <p className="vstat ok" role="status"><PencilLineIcon aria-hidden="true" /><span><b>Corrected by {by}{at}</b>. “{check.note}”</span></p>;
  }
  return <p className="vstat changed" role="status"><Undo2Icon aria-hidden="true" /><span><b>Sent back by {by}{at}:</b> {check.note}</span></p>;
}
