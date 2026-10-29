"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { BadgeCheckIcon, CompassIcon, DatabaseIcon, FileTextIcon, MessagesSquareIcon, PencilLineIcon, ShieldCheckIcon, SparklesIcon, Undo2Icon } from "lucide-react";
import { answerCheckStaffApi, type AnswerCheckCase as Case, type AnswerCheckRow } from "@/lib/agent-api";

/*
 * One answer check (console.html#reviews/<id>, "Flagged answer"): the masked conversation and the customer's note,
 * the answer as the customer saw it, and what it was built from. The specialist confirms it, corrects it with a note,
 * or sends it back with a reason; the chat shows the result under the answer. Information only, never a credit decision.
 */

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
const sentence = (key: string) => { const s = key.replace(/_/g, " "); return s[0]!.toUpperCase() + s.slice(1); };

const SKIPPED: Record<string, string> = { off: "e-mail is off here", not_configured: "no sender set", opted_out: "sent before e-mails",
  no_address: "no address on file", not_decided: "not decided yet" };
/** The last e-mail, as a short label: never the address. */
function emailOutcome(e: Case["emails"][number]) {
  const what = e.kind === "received" ? "Confirmation" : "Reply";
  return e.outcome === "sent" ? `${what} sent` : e.outcome === "test" ? `${what} to test inbox` : `${what} not sent: ${SKIPPED[e.reason ?? ""] ?? e.reason}`;
}

export const checkTopic =(c: Pick<AnswerCheckRow, "topic">) =>
  !c.topic ? "Answer check" : c.topic.length > 90 ? `${c.topic.slice(0, 89)}…` : c.topic;

export function CheckStatus({ s }: { s: AnswerCheckRow["status"] }) {
  return s === "open" ? <span className="pill amber">Open</span>
    : s === "confirmed" ? <span className="pill ok"><BadgeCheckIcon aria-hidden="true" />Confirmed</span>
    : s === "corrected" ? <span className="pill ink"><PencilLineIcon aria-hidden="true" />Corrected</span>
    : <span className="pill line">Sent back</span>;
}

function Decided({ c }: { c: Case }) {
  const by = c.decidedBy ?? "a specialist";
  const at = c.decidedAt ? ` · ${when.format(c.decidedAt)}` : "";
  if (c.status === "confirmed") return <div className="sign"><BadgeCheckIcon aria-hidden="true" /><span><b>Confirmed by {by}{at}</b>. The customer sees the badge under the answer, still labelled AI-generated.</span></div>;
  if (c.status === "corrected") return <div className="sign"><PencilLineIcon aria-hidden="true" /><span><b>Corrected by {by}{at}</b>. The customer sees your note under the answer: “{c.customerNote}”</span></div>;
  return <div className="sign" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}><Undo2Icon aria-hidden="true" /><span><b>Sent back by {by}{at}</b>. “{c.customerNote}”</span></div>;
}

const MODES = [
  ["confirm", "Confirm", "Shown as confirmed by you"],
  ["correct", "Correct with a note", "Your signed note, under the answer"],
  ["return", "Send back with a reason", "Needs account data or advice"],
] as const;

function Decision({ c }: { c: Case }) {
  const decide = useMutation(answerCheckStaffApi.decide);
  const [mode, setMode] = useState<(typeof MODES)[number][0]>("confirm");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode !== "confirm" && !note.trim()) { setError(mode === "correct" ? "Write the correction the customer will see." : "Give the customer a reason in plain words."); return; }
    setBusy(true); setError(null);
    try { await decide({ checkId: c.id, decision: mode, ...(mode !== "confirm" ? { note: note.trim() } : {}) }); }
    catch (err) { setError(err instanceof ConvexError && err.data === "already_decided" ? "Someone else decided this check first." : "That didn’t save. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <form className="decide" onSubmit={submit} noValidate>
      <div className="radio-row" role="radiogroup" aria-label="Decision">
        {MODES.map(([v, label, sub]) => (
          <label className="radio" key={v}><input type="radio" name={`mode-${c.id}`} value={v} checked={mode === v} onChange={() => { setMode(v); setError(null); }} /><span>{label}<small>{sub}</small></span></label>
        ))}
      </div>
      {mode !== "confirm" && (
        <div className="field"><label htmlFor={`note-${c.id}`}>{mode === "correct" ? "Correction, shown to the customer and signed with your name" : "Reason, shown to the customer in plain words"}</label>
          <textarea className="textarea" id={`note-${c.id}`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!error} /></div>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-dark btn-sm" disabled={busy}>
          {mode === "confirm" ? <><BadgeCheckIcon aria-hidden="true" />Confirm</> : mode === "correct" ? <><PencilLineIcon aria-hidden="true" />Send correction</> : <><Undo2Icon aria-hidden="true" />Send back</>}
        </button>
        <span className="scope-note" style={{ alignSelf: "center" }}>You confirm information only, not credit approval or investment advice.</span>
      </div>
    </form>
  );
}

export function AnswerCheckCase({ row }: { row: AnswerCheckRow }) {
  const c = useQuery(answerCheckStaffApi.get, { checkId: row.id });
  if (c === undefined) return <p className="empty-row" role="status">Loading the check…</p>;
  if (c === null) return <p className="empty-row">This check is no longer available.</p>;
  const s = c.snapshot;
  return (
    <>
      <div className="page-head">
        <div><span className="eyebrow">Answer check · {c.reference}</span><h1 style={{ marginTop: 6 }}>{checkTopic(c)}</h1></div>
        <CheckStatus s={c.status} />
      </div>
      <div className="ws">
        <div className="col ctx-col">
          <div className="access"><ShieldCheckIcon aria-hidden="true" /><span>The customer asked for this check. Card numbers, CNP, IBAN, e-mail and phone numbers are masked; no identity is shown.</span></div>
          <section className="card" aria-labelledby={`cv-${c.id}`}>
            <div className="card-h"><h2 id={`cv-${c.id}`}><MessagesSquareIcon aria-hidden="true" />Conversation</h2><span className="micro">{c.track === "business" ? "Business" : "Personal"}</span></div>
            <div className="convo">
              {s.questions.map((q, i) => <div className="bub" key={i}>{q}</div>)}
              <div className="bub-r flagged"><span className="ava-raiffy" aria-hidden="true"><CompassIcon /></span>
                <span>{s.paragraphs[0]!.length > 120 ? `${s.paragraphs[0]!.slice(0, 119)}…` : s.paragraphs[0]}<br /><span className="micro">This is the answer under review</span></span></div>
            </div>
          </section>
          {s.note && <div className="note-q"><b>Customer’s note</b>{s.note}</div>}
        </div>

        <div className="col">
          <section className="card" aria-labelledby={`ans-${c.id}`}>
            <div className="card-h"><h2 id={`ans-${c.id}`}><SparklesIcon aria-hidden="true" />Answer as the customer saw it</h2>{s.inquiry && <span className="pill line">{sentence(s.inquiry)}</span>}</div>
            <div className="answer">
              <div className="answer-text">{s.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
              {s.sources.length > 0 && <div className="srcs">{s.sources.map((src) => (
                <a key={src.url} className="src" href={src.url} target="_blank" rel="noreferrer"><FileTextIcon aria-hidden="true" />{src.title}</a>
              ))}</div>}
              {c.status !== "open" && <Decided c={c} />}
            </div>
            {c.status === "open" && <Decision c={c} />}
          </section>
        </div>

        <div className="col">
          <section className="card" aria-labelledby={`bf-${c.id}`}>
            <div className="card-h"><h3 id={`bf-${c.id}`}><DatabaseIcon aria-hidden="true" />Built from</h3></div>
            <div className="facts">
              <div className="fact"><span>Question type</span><b>{s.inquiry ? sentence(s.inquiry) : "Not recorded"}</b></div>
              <div className="fact"><span>Handled by</span><b>{s.handler ? sentence(s.handler) : "Not recorded"}</b></div>
              {s.sources.map((src) => <div className="fact" key={src.url}><span>{src.title}</span><b className="mono">{src.collectedOn || "No date"}</b><span className="sub">Collected on</span></div>)}
              <div className={s.ungroundedNumbers ? "fact warn" : "fact"}><span>Number check</span>
                <b>{s.ungroundedNumbers ? `${s.ungroundedNumbers} not found in sources` : "All found in sources"}</b>
                <span className="sub">Against the cited passages</span></div>
              <div className="fact"><span>Sent</span><b className="mono">{when.format(c.createdAt)}</b></div>
              <div className="fact"><span>E-mail updates</span><b>{c.emailOptIn ? "On" : "Off, sent before e-mails"}</b>
                {c.emails.length > 0 && <span className="sub">{emailOutcome(c.emails[c.emails.length - 1]!)}</span>}</div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
