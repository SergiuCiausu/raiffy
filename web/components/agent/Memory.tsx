"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { BookmarkIcon, CheckIcon, Trash2Icon } from "lucide-react";
import { memoryApi, type MemoryBlock, type MemoryKind, type MemoryView, type Track } from "@/lib/agent-api";

const KIND: Record<MemoryKind, string> = { goal: "Goal", preference: "Preference", constraint: "Constraint", stated_financial: "Your figure" };
const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

type Outcome = "saved" | "dismissed" | "failed";

/**
 * Raiffy's memory proposals under an answer (DESIGN.md → One-time allow): the object, then equal "Remember" (ink)
 * and "Not now" (ghost). Nothing is kept until the customer chooses Remember.
 */
export function MemoryProposals({ block, track, pendingIds, savedTexts }: {
  block: MemoryBlock; track: Track; pendingIds?: ReadonlySet<string>; savedTexts?: ReadonlySet<string>;
}) {
  const confirm = useMutation(memoryApi.confirm);
  const reject = useMutation(memoryApi.reject);
  const [outcome, setOutcome] = useState<Record<string, Outcome>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // While the store loads every proposal counts as pending; afterwards one that is neither pending nor saved is gone.
  const stateOf = (id: string, text: string): Outcome | "pending" | "gone" =>
    outcome[id] ?? (!pendingIds || pendingIds.has(id) ? "pending" : savedTexts?.has(text) ? "saved" : "gone");
  const items = block.proposals.map((p) => ({ ...p, state: stateOf(p.id, p.text) })).filter((p) => p.state !== "gone");
  if (!items.length) return null;

  const decide = async (id: string, remember: boolean) => {
    setBusy(id);
    try {
      await (remember ? confirm : reject)({ track, proposalId: id });
      setOutcome((o) => ({ ...o, [id]: remember ? "saved" : "dismissed" }));
    } catch {
      setOutcome((o) => ({ ...o, [id]: "failed" }));
    } finally { setBusy(null); }
  };

  return (
    <div className="gcard mem-card">
      <div className="gc-h"><span><BookmarkIcon />Remember this for next time?</span><span className="micro">You decide</span></div>
      <ul className="mem-list">
        {items.map((p) => (
          <li key={p.id} className="mem-item">
            <div className="mem-body">
              <span className="mem-kind">{KIND[p.kind]}</span>
              <b>{p.text}</b>
              <small>From your message: “{p.customerQuote}”</small>
            </div>
            {p.state === "pending" ? (
              <div className="mem-acts">
                <button type="button" className="btn btn-dark" disabled={busy !== null} onClick={() => void decide(p.id, true)}>Remember</button>
                <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void decide(p.id, false)}>Not now</button>
              </div>
            ) : (
              <p className="mem-status" role="status">
                {p.state === "saved" ? <><CheckIcon />Saved. You can delete it anytime in Context.</>
                  : p.state === "dismissed" ? "Not saved. Raiffy won’t keep this."
                  : "Couldn’t save this one. It may have expired."}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "What Raiffy remembers" in the Context panel: every saved memory, with its dates and a way to delete it. */
export function MemoryPanel({ track, memories }: { track: Track; memories?: MemoryView[] }) {
  const forgetOne = useMutation(memoryApi.forgetOne);
  const forgetAll = useMutation(memoryApi.forgetAll);
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="ctx-sec" aria-labelledby="mem-title">
      <h3 id="mem-title">What Raiffy remembers</h3>
      {memories && memories.length > 0 && (
        <ul className="mem-saved">
          {memories.map((m) => (
            <li key={m.id} className="mem-row">
              <div className="mem-body">
                <span className="mem-kind">{KIND[m.kind]}</span>
                <p>{m.text}</p>
                <small>Told {day(m.statedAt)} · kept until {day(m.expiresAt)}</small>
              </div>
              <button type="button" className="icon-btn" aria-label={`Forget: ${m.text}`} onClick={() => void forgetOne({ track, memoryId: m.id })}><Trash2Icon /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="empty-note" hidden={!memories || memories.length > 0}>Nothing saved yet. Raiffy asks before it remembers anything, and you can delete it here.</p>
      {memories && memories.length > 0 && (confirming ? (
        <div className="mem-confirm">
          <button type="button" className="btn btn-dark" onClick={() => void forgetAll({ track }).then(() => setConfirming(false))}>Yes, forget everything</button>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost mem-forget-all" onClick={() => setConfirming(true)}>Forget everything</button>
      ))}
    </section>
  );
}
