"use client";

import { useId, useState } from "react";
import { useMutation, useQueries, useQuery, type RequestForQueries } from "convex/react";
import { ConvexError } from "convex/values";
import { BadgeCheckIcon, ClockIcon, FilePlusIcon, PencilLineIcon, FileTextIcon, InfoIcon, SendIcon, Undo2Icon, UserCheckIcon } from "lucide-react";
import type { MessageId, ThreadId } from "@/lib/agent-api";
import { planApi, type BuildPlanResult } from "@/lib/booking-api";
import { lei } from "@/lib/format";
import { lei2, planCardView } from "@/lib/plan-view";
import { planCheckApi } from "@/lib/plan-check-api";
import { answerCheckApi } from "@/lib/agent-api";
import type { PlanSummary } from "../../../lib/plan/schemas";
import { RecBadge, type SimulationPick } from "@/components/agent/AnswerCards";

/*
 * "Build my plan" at the foot of a simulation (chat.html mkplan) and the plan it makes. The customer's amount and term
 * are what the simulator shows; the server takes the product from the answer and the rate and fees only from the
 * reviewed catalog (convex/plans.ts buildFromAnswer). Without reviewed terms it saves nothing and the note says so,
 * so the simulation stays an estimate. Each build is a new version of the chat's plan.
 */

const NOT_REVIEWED = "A plan needs this loan’s reviewed rate and fees from the bank’s catalog, and they aren’t there yet. The simulation above stays an estimate.";
const WHY: Record<Extract<BuildPlanResult, { status: "unavailable" }>["why"], string> = {
  no_figures: "A plan needs the amount and the term. Set them above, then build it.",
  not_in_catalog: NOT_REVIEWED,
  no_template: "This loan isn’t set up for plans in the bank’s catalog yet. The simulation above stays an estimate.",
  catalog_gaps: "Some of this loan’s terms in the catalog aren’t reviewed or exact yet (a rate range, for example), so a plan can’t be built. The simulation above stays an estimate.",
};

/** The latest plan built from this answer, if any. */
function usePlanFor(messageId: MessageId, threadId: ThreadId) {
  const plans = useQuery(planApi.listForThread, { threadId });
  return { loading: plans === undefined, plan: plans?.find((p) => p.messageId === messageId) };
}

export function PlanBuild({ messageId, threadId, pick, announce }: { messageId: MessageId; threadId: ThreadId; pick: SimulationPick; announce: (text: string) => void }) {
  const { loading, plan } = usePlanFor(messageId, threadId);
  const build = useMutation(planApi.buildFromAnswer);
  const [busy, setBusy] = useState(false);
  // A note answers the pick it was about; moving the simulator brings the button back
  const [note, setNote] = useState<{ text: string; for: string } | null>(null);
  const key = `${pick.amount}/${pick.termMonths}`;
  if (loading) return null;
  const shown = note?.for === key ? note.text : null;
  const same = plan && plan.amount === Math.round(pick.amount * 100) && plan.termMonths === pick.termMonths;

  const onBuild = async () => {
    setBusy(true);
    try {
      const r = await build({ messageId, amount: pick.amount, termMonths: pick.termMonths });
      if (r.status === "ok") { setNote(null); announce(plan ? "Your plan is updated." : "Your plan is ready."); return; }
      setNote({ text: WHY[r.why], for: key });
      announce("A plan isn’t available for this loan yet.");
    } catch {
      setNote({ text: "Couldn’t build the plan. Try again.", for: "" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gc-note plan-check" aria-live="polite">
      <span>{shown ?? (same ? "Your plan below matches this simulation." : plan ? "Changed the amount or term? Update your plan to match."
        : "Ready to decide? Turn the loan into a plan you can keep and have checked.")}</span>
      {!shown && !same && (
        <button type="button" className="vbtn" disabled={busy} onClick={() => void onBuild()}>
          <FilePlusIcon />{busy ? "Building…" : plan ? "Update my plan" : "Build my plan"}
        </button>
      )}
    </div>
  );
}

export function PlanForAnswer({ messageId, threadId }: { messageId: MessageId; threadId: ThreadId }) {
  const { plan } = usePlanFor(messageId, threadId);
  return plan ? <PlanCard planId={plan.planId} version={plan.version} /> : null;
}

function PlanCard({ planId, version }: { planId: string; version: number }) {
  const got = useQuery(planApi.get, { planId, version });
  if (!got) return null;
  const v = planCardView(got.plan);
  return (
    <div className="answer-cards">
      <div className="gcard plan-card">
        <div className="gc-h">
          <span><FileTextIcon />Your plan</span>
          <span className="plan-h"><span className="pill">{v.check}</span><span className="micro">{v.id} · v{v.version}</span></span>
        </div>
        <div className="gc-b plan-b">
          <div className="plan-goal">
            <span className="eyebrow">Goal</span><b>{v.goal}</b>
            <span className="plan-route">{v.product} · {lei(v.amount / 100)} over {v.termMonths} months{v.recommended ? <RecBadge /> : <span className="pill">Your choice</span>}</span>
          </div>
          {v.range ? <>
            <div className="plan-figs">
              <div><span>Monthly payment</span><b>{lei(Math.round(v.range.monthly / 100))} – {lei(Math.round(v.monthly / 100))}</b><small>At {v.range.minPercent} – {v.range.maxPercent}</small></div>
              <div><span>Total payable</span><b>{lei(Math.round(v.range.total / 100))} – {lei(Math.round(v.total / 100))}</b><small>{v.upfrontFee ? `With the ${lei(v.upfrontFee / 100)} fee` : "With every fee"}</small></div>
              <div><span>DAE</span><b>{v.range.daePercent} – {v.daePercent}</b><small>Estimate · no insurance</small></div>
            </div>
            <p className="plan-src">The bank sets your {v.fixedRate ? "fixed " : ""}rate between {v.range.minPercent} and {v.range.maxPercent} when it assesses your application. The balance below uses {v.range.maxPercent}, so it doesn’t understate the cost.</p>
          </> : (
            <div className="plan-figs">
              <div><span>Monthly payment</span><b>{lei2(v.monthly)}</b><small>Estimate</small></div>
              <div><span>Total payable</span><b>{lei2(v.total)}</b><small>{v.upfrontFee ? `With the ${lei(v.upfrontFee / 100)} fee` : "With every fee"}</small></div>
              <div><span>DAE</span><b>{v.daePercent}</b><small>Estimate · no insurance</small></div>
            </div>
          )}
          <div className="bal">
            <div className="bal-bars" aria-hidden="true">{v.bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
            <div className="bal-cap"><span>{lei(v.amount / 100)} to repay</span><span>Paid off · {v.paidOff}</span></div>
          </div>
          {v.cited
            ? <p className="plan-src">Figures from {v.sources.join(", ")} as cited in this chat on {v.cited.on}. The bank’s reviewed catalog doesn’t cover this loan yet{v.cited.unconfirmedFees ? ", and fees the page didn’t state aren’t counted" : ""}.</p>
            : <p className="plan-src">Rate and fees: the bank’s reviewed catalog ({v.sources.join(", ")}).</p>}
          <p className="plan-label"><InfoIcon /><span>Indicative simulation, not a firm credit offer. The bank issues the official offer and contract in Smart Mobile.</span></p>
        </div>
      </div>
      <PlanCheck planId={planId} version={version} verification={got.plan.verification} latest={got.latestVersion === version} />
    </div>
  );
}

/*
 * "Check my plan" (chat.html plan-check, convex/planChecks.ts): the customer sends this version to a specialist, then
 * sees the decision here. The figures never change; a rebuilt plan is a new version that says it changed after a check.
 */
// The same e-mail switch as answer checks; as a value, so if it can't be read the panel just doesn't mention it
const EMAIL_QUERY: RequestForQueries = { email: { query: answerCheckApi.emailAvailability, args: {} } };

export function PlanCheck({ planId, version, verification, latest }: { planId: string; version: number; verification: PlanSummary["verification"]; latest: boolean }) {
  const send = useMutation(planCheckApi.request);
  const [drafting, setDrafting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const email = useQueries(EMAIL_QUERY).email as { enabled: boolean; address: string | null; testMode: boolean } | Error | undefined;
  const emailed = email && !(email instanceof Error) && email.enabled ? email : null;
  const by = verification.reviewer ? `${verification.reviewer.name}, ${verification.reviewer.role.toLowerCase()}` : "a specialist";

  if (verification.level === "pending_review") {
    return <div className="vzone"><p className="vstat" role="status"><ClockIcon aria-hidden="true" /><span><b>Waiting for a specialist</b> · Ref. {verification.requestId}. You can keep chatting.</span></p></div>;
  }
  if (verification.level === "edited" && !verification.changed) {
    return <div className="vzone"><p className="vstat ok" role="status"><PencilLineIcon aria-hidden="true" /><span><b>Confirmed with a note by {by}:</b> “{verification.note}” Still indicative: the bank decides on credit.</span></p></div>;
  }
  if (verification.level === "confirmed" && !verification.changed) {
    return <div className="vzone"><p className="vstat ok" role="status"><BadgeCheckIcon aria-hidden="true" /><span><b>Confirmed by {by}</b>.{verification.note ? ` “${verification.note}”` : " The figures match the bank’s terms."} Still indicative: the bank decides on credit.</span></p></div>;
  }
  if (verification.level === "returned") {
    return <div className="vzone"><p className="vstat changed" role="status"><Undo2Icon aria-hidden="true" /><span><b>Sent back by {by}:</b> {verification.note}</span></p></div>;
  }
  if (!latest) return null;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await send({ planId, version, ...(note.trim() ? { note: note.trim() } : {}) });
      setDrafting(false);
    } catch (e) {
      setError(e instanceof ConvexError && e.data === "plan_check_limit_reached" ? "You’ve sent five plan checks today. Try again tomorrow."
        : e instanceof ConvexError && e.data === "plan_outdated" ? "Your plan changed. Check the latest version."
        : "That didn’t send. Try again in a moment.");
      setBusy(false);
    }
  };
  return (
    <div className="vzone">
      {verification.changed && <p className="vstat changed"><InfoIcon aria-hidden="true" /><span>A specialist checked an earlier version. This one changed since.</span></p>}
      {!drafting ? (
        <div className="gc-note plan-check"><span>Want a person to look at it? A specialist checks the figures against the bank’s terms.</span>
          <button type="button" className="vbtn" onClick={() => setDrafting(true)}><UserCheckIcon aria-hidden="true" />Check my plan</button></div>
      ) : (
        <div className="vreq" role="group" aria-labelledby={`${id}-h`}>
          <h3 id={`${id}-h`}>Check my plan with a specialist</h3>
          <p>A Raiffeisen specialist sees this plan: the amount, term, rate, fees, schedule and sources. They confirm the information, not a credit decision.</p>
          <label className="sr-only" htmlFor={`${id}-n`}>Note for the specialist</label>
          <textarea id={`${id}-n`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="What should they look at? (optional)" autoFocus />
          {emailed && (
            <p className="micro">We’ll e-mail {emailed.address} when it’s received and when the specialist replies: only the plan ID, the reference and the status, never the figures.
              {emailed.testMode && " In this preview the e-mails go to a test inbox, not to you."}</p>
          )}
          <p className="micro">In this preview there’s no set response time. The specialist’s reply appears here, on your plan, and in Your plans.</p>
          {error && <p className="micro" role="alert">{error}</p>}
          <div className="row">
            <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void submit()}><SendIcon aria-hidden="true" />Send request</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDrafting(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
