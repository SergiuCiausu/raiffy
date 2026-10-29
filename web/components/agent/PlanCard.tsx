"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { FilePlusIcon, FileTextIcon, InfoIcon } from "lucide-react";
import type { MessageId, ThreadId } from "@/lib/agent-api";
import { planApi, type BuildPlanResult } from "@/lib/booking-api";
import { lei } from "@/lib/format";
import { lei2, planCardView } from "@/lib/plan-view";
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
  no_template: NOT_REVIEWED,
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
          <div className="plan-figs">
            <div><span>Monthly payment</span><b>{lei2(v.monthly)}</b><small>Estimate</small></div>
            <div><span>Total payable</span><b>{lei2(v.total)}</b><small>{v.upfrontFee ? `With the ${lei(v.upfrontFee / 100)} fee` : "With every fee"}</small></div>
            <div><span>DAE</span><b>{v.daePercent}</b><small>Estimate · no insurance</small></div>
          </div>
          <div className="bal">
            <div className="bal-bars" aria-hidden="true">{v.bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
            <div className="bal-cap"><span>{lei(v.amount / 100)} to repay</span><span>Paid off · {v.paidOff}</span></div>
          </div>
          <p className="plan-src">Rate and fees: the bank’s reviewed catalog ({v.sources.join(", ")}).</p>
          <p className="plan-label"><InfoIcon /><span>Indicative simulation, not a firm credit offer. The bank issues the official offer and contract in Smart Mobile.</span></p>
        </div>
      </div>
    </div>
  );
}
