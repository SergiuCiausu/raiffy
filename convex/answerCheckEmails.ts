import { v } from "convex/values";
import { Resend } from "@convex-dev/resend";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import { requireUser } from "./roles";
import { answerCheckEmail, emailDelivery, maskEmail, type EmailEnvironment } from "../lib/review/answerCheckEmail";

/*
 * The answer-check e-mails (lib/review/answerCheckEmail.ts). `answerChecks.request` and `.decide` schedule `send` in the
 * same transaction as their write, so an e-mail goes out only for a saved check, once, and a failed send can't undo it.
 * Off unless RAIFFY_EMAIL_ENABLED is "true" and RAIFFY_EMAIL_DEPLOYMENT_URL matches this deployment. Until
 * RAIFFY_EMAIL_LIVE is "true" it runs in Resend's test mode and writes only to Resend's test inbox.
 * Also needed: RESEND_API_KEY, RAIFFY_EMAIL_FROM ("Raiffy <…@verified-domain>") and RAIFFY_APP_URL for the link.
 */

export function emailEnvironment(): EmailEnvironment {
  return {
    enabled: process.env.RAIFFY_EMAIL_ENABLED === "true",
    deploymentUrl: process.env.RAIFFY_EMAIL_DEPLOYMENT_URL, cloudUrl: process.env.CONVEX_CLOUD_URL,
    from: process.env.RAIFFY_EMAIL_FROM, appUrl: process.env.RAIFFY_APP_URL,
    live: process.env.RAIFFY_EMAIL_LIVE === "true",
  };
}

const kind = v.union(v.literal("received"), v.literal("decided"));

async function record(ctx: MutationCtx, c: Doc<"answerChecks">, entry: NonNullable<Doc<"answerChecks">["emails"]>[number]) {
  await ctx.db.patch(c._id, { emails: [...(c.emails ?? []), entry] });
}

export const send = internalMutation({
  args: { checkId: v.id("answerChecks"), kind },
  returns: v.null(),
  handler: async (ctx, { checkId, kind }) => {
    const c = await ctx.db.get(checkId);
    if (!c) return null;
    const at = Date.now();
    if (kind === "decided" && c.status === "open") { await record(ctx, c, { kind, outcome: "skipped", reason: "not_decided", at }); return null; }
    const user = await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", c.ownerKey)).first();
    const plan = emailDelivery(emailEnvironment(), { optIn: c.emailOptIn === true, address: user?.email });
    if (!plan.send) { await record(ctx, c, { kind, outcome: "skipped", reason: plan.reason, at }); return null; }
    const content = answerCheckEmail(kind === "received"
      ? { kind, reference: c.reference, ...(plan.appUrl ? { appUrl: plan.appUrl } : {}) }
      : { kind, reference: c.reference, status: c.status as Exclude<typeof c.status, "open">, ...(plan.appUrl ? { appUrl: plan.appUrl } : {}) });
    const resend = new Resend(components.resend, { testMode: plan.testMode });
    const emailId = await resend.sendEmail(ctx, { from: plan.from, to: plan.to, subject: content.subject, html: content.html, text: content.text });
    await record(ctx, c, { kind, outcome: plan.testMode ? "test" : "sent", emailId: String(emailId), at });
    return null;
  },
});

/** Schedules the e-mail for a check; call it from the mutation that wrote the check. */
export async function scheduleEmail(ctx: MutationCtx, checkId: Id<"answerChecks">, which: "received" | "decided") {
  await ctx.scheduler.runAfter(0, internal.answerCheckEmails.send, { checkId, kind: which });
}

/**
 * For the request panel: whether e-mail is on here, the caller's address masked ("s•••@gmail.com"), and whether it's
 * Resend's test mode, where the panel must say the e-mail goes to a test inbox, not to them.
 */
export const availability = query({
  args: {},
  handler: async (ctx) => {
    const { identity } = await requireUser(ctx);
    const env = emailEnvironment();
    const on = env.enabled && !!env.deploymentUrl && env.deploymentUrl === env.cloudUrl && !!env.from;
    const address = typeof identity.email === "string" ? identity.email : null;
    return { enabled: on && address !== null, address: address ? maskEmail(address) : null, testMode: !env.live };
  },
});
