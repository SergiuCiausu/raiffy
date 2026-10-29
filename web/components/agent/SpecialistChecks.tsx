"use client";

import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";
import type { AnswerCheckStatus, MyAnswerCheck, Track } from "@/lib/agent-api";
import { Status } from "./AnswerCheck";

/*
 * "Your specialist checks" (chat.html#checks, /chat/checks): every answer the customer sent to a person, waiting first,
 * read from convex/answerChecks.ts `mine`. Each reply is the same status line the answer shows, so they never disagree.
 */

const sent = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
const PILL: Record<AnswerCheckStatus, [string, string]> = {
  open: ["Waiting", "var(--amber-ink)"], confirmed: ["Confirmed", "var(--ok)"], corrected: ["Corrected", "var(--ok)"], returned: ["Sent back", "var(--amber-ink)"],
};

export type CheckRow = MyAnswerCheck & { track: Track };

function Row({ c, title }: { c: CheckRow; title: string | undefined }) {
  const [label, color] = PILL[c.status];
  return (
    <li className="chk">
      <div className="chk-h">
        <div>
          <b>{c.question ?? title ?? "Answer check"}</b>
          <small><span className="ref">{c.reference}</span> · sent {sent.format(c.createdAt)}{title ? ` · ${title}` : ""}{c.track === "business" ? " · Business" : ""}</small>
        </div>
        <span className="pill" style={{ ["--c" as string]: color }}>{label}</span>
      </div>
      {c.status === "open" ? <p className="chk-wait">Waiting for a specialist. Their reply appears here and under the answer.</p> : <Status check={c} />}
      <div><Link className="btn btn-ghost btn-sm" href={`/chat?thread=${c.threadId}`}><MessageCircleIcon aria-hidden="true" />Open conversation</Link></div>
    </li>
  );
}

/** `rows` is undefined while loading. `titles` names each conversation from the sidebar's list. */
export function SpecialistChecks({ rows, titles }: { rows: CheckRow[] | undefined; titles: ReadonlyMap<string, string> }) {
  const open = rows?.filter((c) => c.status === "open") ?? [];
  const done = rows?.filter((c) => c.status !== "open") ?? [];
  const group = (label: string, xs: CheckRow[]) => xs.length > 0 && <>
    <span className="grp eyebrow">{label}</span>
    <ul className="chk-list">{xs.map((c) => <Row key={c.id} c={c} title={titles.get(c.threadId)} />)}</ul>
  </>;
  return (
    <section className="checks" aria-labelledby="title">
      <div className="checks-in">
        <p>Answers you asked a Raiffeisen specialist to check. They confirm the information, not a credit decision. Each reply also appears under its answer.</p>
        {rows === undefined ? <p className="chk-wait" role="status">Loading your checks…</p>
          : rows.length === 0 ? <p className="chk-empty">No checks yet. Under any answer, “Ask a specialist” sends it to a person to check.</p>
          : <>{group("Waiting", open)}{group("Answered", done)}</>}
      </div>
    </section>
  );
}
