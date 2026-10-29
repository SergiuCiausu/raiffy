import { v } from "convex/values";
import { Resend } from "@convex-dev/resend";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { emailEnvironment } from "./answerCheckEmails";
import { emailDelivery } from "../lib/review/answerCheckEmail";
import { planCheckEmail } from "../lib/review/planCheckEmail";

/*
 * The plan-check e-mails (lib/review/planCheckEmail.ts), on the same switches, sender and test mode as answer checks
 * (convex/answerCheckEmails.ts). `planChecks.request` and `.decide` schedule `send` in the same transaction as their
 * write. Every outcome is recorded on the check, never the address, which is read from the users mirror at send time.
 */

const kind = v.union(v.literal("received"), v.literal("decided"));

async function record(ctx: MutationCtx, c: Doc<"planChecks">, entry: NonNullable<Doc<"planChecks">["emails"]>[number]) {
  await ctx.db.patch(c._id, { emails: [...(c.emails ?? []), entry] });
}

export const send = internalMutation({
  args: { checkId: v.id("planChecks"), kind },
  returns: v.null(),
  handler: async (ctx, { checkId, kind }) => {
    const c = await ctx.db.get(checkId);
    if (!c) return null;
    const at = Date.now();
    if (kind === "decided" && c.status === "open") { await record(ctx, c, { kind, outcome: "skipped", reason: "not_decided", at }); return null; }
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", c.ownerKey)).first();
    // Plan checks are always e-mailed, as answer checks are: there is no opt-out
    const plan = emailDelivery(emailEnvironment(), { optIn: true, address: user?.email });
    if (!plan.send) { await record(ctx, c, { kind, outcome: "skipped", reason: plan.reason, at }); return null; }
    const appUrl = plan.appUrl ? { appUrl: plan.appUrl } : {};
    const content = planCheckEmail(kind === "received"
      ? { kind, reference: c.reference, planId: c.planId, ...appUrl }
      : { kind, reference: c.reference, planId: c.planId, status: c.status as Exclude<typeof c.status, "open">, ...appUrl });
    const resend = new Resend(components.resend, { testMode: plan.testMode });
    const emailId = await resend.sendEmail(ctx, { from: plan.from, to: plan.to, subject: content.subject, html: content.html, text: content.text });
    await record(ctx, c, { kind, outcome: plan.testMode ? "test" : "sent", emailId: String(emailId), at });
    return null;
  },
});

/** Schedules the e-mail for a check; call it from the mutation that wrote the check. */
export async function schedulePlanEmail(ctx: MutationCtx, checkId: Id<"planChecks">, which: "received" | "decided") {
  await ctx.scheduler.runAfter(0, internal.planCheckEmails.send, { checkId, kind: which });
}
