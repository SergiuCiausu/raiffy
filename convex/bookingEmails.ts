import { v } from "convex/values";
import { Resend } from "@convex-dev/resend";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { emailEnvironment } from "./answerCheckEmails";
import { bookingEmail } from "../lib/booking/bookingEmail";
import { releaseAt } from "../lib/booking/rules";
import { DEFAULT_BOOKING_RULES as RULES } from "../lib/booking/schemas";
import { emailDelivery } from "../lib/email/delivery";

/*
 * The e-mails for a new booking (lib/booking/bookingEmail.ts): one to the customer, one to the specialist. `book`
 * schedules them in the same transaction as the booking, so they go out only for a saved booking, and a failed send
 * can't undo it. Sent by default: they confirm what the customer just did. Each recipient gets at most one per
 * booking, recorded on the booking. The address is always the one on the user's account, never one from the client.
 * The same switches as the answer-check e-mails: off unless RAIFFY_EMAIL_ENABLED is pinned to this deployment, and
 * Resend's test inbox until RAIFFY_EMAIL_LIVE.
 */

const to = v.union(v.literal("customer"), v.literal("operator"));
type Entry = NonNullable<Doc<"bookings">["emails"]>[number];

export const send = internalMutation({
  args: { id: v.id("bookings"), to },
  returns: v.null(),
  handler: async (ctx, { id, to }) => {
    const b = await ctx.db.get(id);
    if (!b || (b.emails ?? []).some((e) => e.kind === "booked" && e.to === to)) return null;
    const at = Date.now();
    const record = (entry: Omit<Entry, "kind" | "to" | "at">) => ctx.db.patch(b._id, { emails: [...(b.emails ?? []), { kind: "booked", to, at, ...entry }] });
    if (b.status === "cancelled") { await record({ outcome: "skipped", reason: "cancelled" }); return null; }
    const user = to === "customer"
      ? await ctx.db.query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", b.ownerKey)).first()
      : await ctx.db.query("users").withIndex("by_clerk_user", (q) => q.eq("clerkUserId", b.operatorId)).unique();
    const plan = emailDelivery(emailEnvironment(), { optIn: true, address: user?.email });
    if (!plan.send) { await record({ outcome: "skipped", reason: plan.reason }); return null; }
    const call = { reference: b.bookingId, start: b.start, timeZone: b.timeZone, minutes: b.minutes, channel: b.channel, ...(plan.appUrl ? { appUrl: plan.appUrl } : {}) };
    const content = to === "customer"
      ? bookingEmail({ to, ...call, operatorName: b.operatorName, confirmBy: b.confirmedAt === null ? releaseAt(b, b.timeZone, RULES) : null })
      : bookingEmail({ to, ...call, customerName: b.customerName, customerRef: b.customerRef });
    const resend = new Resend(components.resend, { testMode: plan.testMode });
    const emailId = await resend.sendEmail(ctx, { from: plan.from, to: plan.to, subject: content.subject, html: content.html, text: content.text });
    await record({ outcome: plan.testMode ? "test" : "sent", emailId: String(emailId) });
    return null;
  },
});

/** Schedules both e-mails for a booking; call it from the mutation that saved it. One after the other, so their records don't race. */
export async function scheduleBookingEmails(ctx: MutationCtx, id: Id<"bookings">) {
  await ctx.scheduler.runAfter(0, internal.bookingEmails.send, { id, to: "customer" });
  await ctx.scheduler.runAfter(1_000, internal.bookingEmails.send, { id, to: "operator" });
}
