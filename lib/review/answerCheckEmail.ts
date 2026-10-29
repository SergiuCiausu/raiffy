import { z } from "zod";
import { answerCheckStatusSchema } from "./answerCheck";
import { httpUrl } from "../email/delivery";

/*
 * The service e-mails about an answer check: "received" when the customer sends it, "decided" when a specialist
 * replies. They carry only the reference, the status and the way back to the app: never the question, the answer, a
 * figure or the specialist's note, which are read in the app. Pure: the sender passes the reference and the app URL in.
 */

export const answerCheckEmailInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("received"), reference: z.string().regex(/^AC-[2-9A-HJ-NP-Z]{6}$/), appUrl: httpUrl.optional() }).strict(),
  z.object({ kind: z.literal("decided"), reference: z.string().regex(/^AC-[2-9A-HJ-NP-Z]{6}$/),
    status: answerCheckStatusSchema.exclude(["open"]), appUrl: httpUrl.optional() }).strict(),
]);
export type AnswerCheckEmailInput = z.infer<typeof answerCheckEmailInputSchema>;

export const answerCheckEmailSchema = z.object({ subject: z.string().min(1), text: z.string().min(1), html: z.string().min(1) });
export type AnswerCheckEmail = z.infer<typeof answerCheckEmailSchema>;

const DECIDED: Record<"confirmed" | "corrected" | "returned", { subject: string; lead: string }> = {
  confirmed: { subject: "A specialist confirmed your answer", lead: "A Raiffeisen specialist checked the answer and confirmed it." },
  corrected: { subject: "A specialist corrected your answer", lead: "A Raiffeisen specialist checked the answer and added a correction." },
  returned: { subject: "A specialist replied to your check", lead: "A Raiffeisen specialist looked at the answer and sent it back with a reason." },
};

const SAFETY = "Raiffeisen never asks for codes, passwords, card details or a transfer by e-mail.";
const WHY = "You’re getting this because you asked a specialist to check an answer in Raiffy. It isn’t a credit decision or financial advice.";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export { emailDelivery, maskEmail, RESEND_TEST_INBOX, type EmailDelivery, type EmailEnvironment } from "../email/delivery";

/** The path the e-mail points to: the customer's list of checks, behind the normal sign-in. */
export function checksUrl(appUrl: string): string {
  return new URL("/chat/checks", appUrl).toString();
}

export function answerCheckEmail(raw: AnswerCheckEmailInput): AnswerCheckEmail {
  const input = answerCheckEmailInputSchema.parse(raw);
  const { subject, lead } = input.kind === "received"
    ? { subject: `We’ve received your request ${input.reference}`, lead: "A Raiffeisen specialist will check the answer you flagged." }
    : DECIDED[input.status];
  const where = input.kind === "received"
    ? "Their reply appears under the answer in Raiffy, and in Your specialist checks."
    : "Open Raiffy to read it, under the answer or in Your specialist checks.";
  return serviceEmail({ subject, lead, where, ref: `Reference: ${input.reference}`,
    link: input.appUrl ? { label: "Your specialist checks", url: checksUrl(input.appUrl) } : null, why: WHY });
}

/**
 * The layout every check e-mail shares (answer checks here, plan checks in planCheckEmail.ts): the lead, where to read
 * the reply, the reference, the link back into the app, and the safety and why lines.
 */
export function serviceEmail(e: { subject: string; lead: string; where: string; ref: string; link: { label: string; url: string } | null; why: string }): AnswerCheckEmail {
  const text = [e.lead, e.where, e.ref, ...(e.link ? [`${e.link.label}: ${e.link.url}`] : []), "", SAFETY, e.why].join("\n");
  const p = (s: string, style = "") => `<p style="margin:0 0 12px;font:14px/1.5 Geist,Arial,sans-serif;color:#1A1A1A;${style}">${s}</p>`;
  const html = [
    `<div style="max-width:520px;padding:24px">`,
    p(escape(e.lead)),
    p(escape(e.where)),
    p(escape(e.ref), "font-family:'Geist Mono',Menlo,monospace;font-size:13px"),
    e.link ? p(`<a href="${escape(e.link.url)}" style="color:#1A1A1A">${escape(e.link.label)}</a>`) : "",
    p(escape(SAFETY), "color:#5C5C5C;font-size:13px"),
    p(escape(e.why), "color:#5C5C5C;font-size:13px"),
    `</div>`,
  ].join("");
  return answerCheckEmailSchema.parse({ subject: e.subject, text, html });
}
