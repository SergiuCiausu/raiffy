import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireAgentScope, requireAgentThread } from "./agentAuth";
import { writeAudit } from "./audit";
import { scheduleEmail } from "./answerCheckEmails";
import { requirePermission } from "./roles";
import { HANDOFF_PREVIEW_MESSAGES } from "../lib/agent/handoff";
import {
  answerCheckDecisionSchema, answerCheckReference, answerCheckRequestSchema, answerSnapshot, canFlag, decide as decideCheck,
  type AnswerCheckView,
} from "../lib/review/answerCheck";

/*
 * Answer checks (lib/review/answerCheck.ts). The customer flags an answer from the chat and sees its status there;
 * operators and admins work the queue in /console/reviews. Every decision is written to the audit log.
 */

const MAX_REQUESTS_PER_DAY = 5;
const QUEUE_LIMIT = 50;

function customerView(c: Doc<"answerChecks">): AnswerCheckView {
  return { reference: c.reference, status: c.status, createdAt: c.createdAt, decidedAt: c.decidedAt ?? null,
    reviewer: c.decidedBy ?? null, note: c.customerNote ?? null };
}

/** The answer, checked to belong to the signed-in customer, and the customer's questions before it. */
async function flaggableAnswer(ctx: QueryCtx, messageId: Id<"ragMessages">) {
  const message = await ctx.db.get(messageId);
  if (!message) throw new ConvexError("conversation_unavailable");
  const thread = await requireAgentThread(ctx, message.threadId);
  if (!canFlag(message)) throw new ConvexError("request_unavailable");
  const rows = await ctx.db.query("ragMessages").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).order("desc").take(40);
  const questions = rows.filter((m) => m.role === "user" && m._creationTime < message._creationTime)
    .slice(0, HANDOFF_PREVIEW_MESSAGES).reverse().map((m) => m.text);
  return { message, thread, questions };
}

/**
 * Sends one answer for a check. Repeating it returns the same check; at most five new checks a day per customer.
 * Every check is e-mailed where e-mail is on: the confirmation now, and the reply later. The customer can't opt out.
 */
export const request = mutation({
  args: { messageId: v.id("ragMessages"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const parsed = answerCheckRequestSchema.safeParse({ note: args.note });
    if (!parsed.success) throw new ConvexError("note_too_long");
    const { note } = parsed.data;
    const { message, thread, questions } = await flaggableAnswer(ctx, args.messageId);
    const existing = await ctx.db.query("answerChecks").withIndex("by_message", (q) => q.eq("messageId", message._id)).first();
    if (existing) return customerView(existing);
    const now = Date.now();
    const recent = await ctx.db.query("answerChecks")
      .withIndex("by_owner", (q) => q.eq("ownerKey", thread.ownerKey!).gte("createdAt", now - 24 * 60 * 60 * 1000)).take(MAX_REQUESTS_PER_DAY);
    if (recent.length >= MAX_REQUESTS_PER_DAY) throw new ConvexError("answer_check_limit_reached");
    const id = await ctx.db.insert("answerChecks", {
      ownerKey: thread.ownerKey!, track: thread.track, organizationKey: thread.organizationKey ?? null, threadId: thread._id, messageId: message._id,
      reference: answerCheckReference(Math.random), status: "open", createdAt: now, emailOptIn: true,
      snapshot: answerSnapshot({ customerMessages: questions, answerText: message.text, answer: message.answer, note }),
    });
    await scheduleEmail(ctx, id, "received");
    return customerView((await ctx.db.get(id))!);
  },
});

/** Every check in one conversation, for the status line under each answer. One query per thread, not per answer. */
export const forThread = query({
  args: { threadId: v.id("ragThreads") },
  handler: async (ctx, { threadId }) => {
    const thread = await requireAgentThread(ctx, threadId);
    const rows = await ctx.db.query("answerChecks").withIndex("by_thread", (q) => q.eq("threadId", thread._id)).collect();
    return rows.map((c) => ({ messageId: c.messageId, ...customerView(c) }));
  },
});

/**
 * The customer's own checks on one track, newest first, for "Your specialist checks" (/chat/checks). Business checks
 * are scoped to the caller's current organization, as the chat is. Their question comes from the masked snapshot.
 */
export const mine = query({
  args: { track: v.union(v.literal("personal"), v.literal("business")) },
  handler: async (ctx, { track }) => {
    const scope = await requireAgentScope(ctx, track);
    const rows = await ctx.db.query("answerChecks").withIndex("by_owner", (q) => q.eq("ownerKey", scope.ownerKey)).order("desc").take(100);
    return rows.filter((c) => c.track === scope.track && c.organizationKey === scope.organizationKey)
      .map((c) => ({ id: c._id, threadId: c.threadId, messageId: c.messageId, question: c.snapshot.questions.at(-1) ?? null, ...customerView(c) }));
  },
});

/* ── Operators: the queue in /console/reviews ── */

function queueRow(c: Doc<"answerChecks">) {
  return { id: c._id, reference: c.reference, status: c.status, track: c.track, topic: c.snapshot.questions.at(-1) ?? null,
    inquiry: c.snapshot.inquiry, hasNote: c.snapshot.note !== null, ungroundedNumbers: c.snapshot.ungroundedNumbers,
    createdAt: c.createdAt, decidedAt: c.decidedAt ?? null, decidedBy: c.decidedBy?.name ?? null };
}

/** Open checks oldest first, and the most recently created decided ones. No customer identity. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "review.answer");
    const open = await ctx.db.query("answerChecks").withIndex("by_status", (q) => q.eq("status", "open")).order("asc").take(QUEUE_LIMIT);
    const decided = (await ctx.db.query("answerChecks").withIndex("by_created").order("desc").take(QUEUE_LIMIT)).filter((c) => c.status !== "open");
    return { open: open.map(queueRow), decided: decided.map(queueRow) };
  },
});

/** One case with the masked snapshot the customer agreed to send. */
export const get = query({
  args: { checkId: v.id("answerChecks") },
  handler: async (ctx, { checkId }) => {
    await requirePermission(ctx, "review.answer");
    const c = await ctx.db.get(checkId);
    if (!c) return null;
    return { ...queueRow(c), snapshot: c.snapshot, customerNote: c.customerNote ?? null, emailOptIn: c.emailOptIn === true,
      emails: (c.emails ?? []).map(({ kind, outcome, reason, at }) => ({ kind, outcome, reason: reason ?? null, at })) };
  },
});

/** Confirm, correct with a note, or send back with a reason. Final; the chat shows it under the answer. */
export const decide = mutation({
  args: { checkId: v.id("answerChecks"), decision: v.union(v.literal("confirm"), v.literal("correct"), v.literal("return")), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requirePermission(ctx, "review.answer");
    const parsed = answerCheckDecisionSchema.safeParse(args.decision === "confirm" ? { decision: "confirm" } : { decision: args.decision, note: args.note ?? "" });
    if (!parsed.success) throw new ConvexError("note_required");
    const c = await ctx.db.get(args.checkId);
    if (!c) throw new ConvexError("not_found");
    const next = decideCheck(c.status, parsed.data);
    if (!next.ok) throw new ConvexError(next.reason);
    const name = caller.identity.name ?? caller.identity.email ?? "A specialist";
    const customerNote = parsed.data.decision === "confirm" ? undefined : parsed.data.note;
    await ctx.db.patch(c._id, { status: next.status, decidedBy: { name, role: "Specialist" }, decidedAt: Date.now(), ...(customerNote ? { customerNote } : {}) });
    await scheduleEmail(ctx, c._id, "decided");
    await writeAudit(ctx, caller, { action: "answerCheck.decide", details: { checkId: c._id, reference: c.reference, decision: parsed.data.decision }, note: customerNote });
    return null;
  },
});
