import { z } from "zod";
import { httpUrl } from "../email/delivery";
import { serviceEmail, type AnswerCheckEmail } from "./answerCheckEmail";

/*
 * The service e-mails about a plan check (convex/planChecks.ts): "received" when the customer sends a plan, "decided"
 * when a specialist confirms it, confirms it with a note, or sends it back. Like answer checks they carry only the plan
 * ID, the reference, the status and the way back to the app: never a figure, the plan, or anyone's note.
 */

const reference = z.string().regex(/^PC-[2-9A-HJ-NP-Z]{6}$/);
const planId = z.string().regex(/^PS-\d{3,8}$/);

export const planCheckEmailInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("received"), reference, planId, appUrl: httpUrl.optional() }).strict(),
  z.object({ kind: z.literal("decided"), reference, planId, status: z.enum(["confirmed", "corrected", "returned"]), appUrl: httpUrl.optional() }).strict(),
]);
export type PlanCheckEmailInput = z.infer<typeof planCheckEmailInputSchema>;

const WHY = "You’re getting this because you asked a specialist to check a plan in Raiffy. It isn’t a credit decision or financial advice.";

/** The path the e-mail points to: the customer's plans, behind the normal sign-in. */
export const plansUrl = (appUrl: string) => new URL("/chat/plans", appUrl).toString();

export function planCheckEmail(raw: PlanCheckEmailInput): AnswerCheckEmail {
  const input = planCheckEmailInputSchema.parse(raw);
  const plan = `plan ${input.planId}`;
  const { subject, lead } = input.kind === "received"
    ? { subject: `We’ve received your plan check ${input.reference}`, lead: `A Raiffeisen specialist will check ${plan} against the bank’s terms.` }
    : {
      confirmed: { subject: "A specialist confirmed your plan", lead: `A Raiffeisen specialist checked ${plan} and confirmed it.` },
      corrected: { subject: "A specialist confirmed your plan, with a note", lead: `A Raiffeisen specialist checked ${plan}, confirmed it and added a note.` },
      returned: { subject: "A specialist replied about your plan", lead: `A Raiffeisen specialist looked at ${plan} and sent it back with a reason.` },
    }[input.status];
  const where = input.kind === "received"
    ? "Their reply appears on the plan in Raiffy, and in Your plans."
    : "Open Raiffy to read it, on the plan or in Your plans.";
  return serviceEmail({ subject, lead, where, ref: `Reference: ${input.reference}`,
    link: input.appUrl ? { label: "Your plans", url: plansUrl(input.appUrl) } : null, why: WHY });
}
