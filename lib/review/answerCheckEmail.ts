import { z } from "zod";
import { answerCheckStatusSchema } from "./answerCheck";

/*
 * The service e-mails about an answer check: "received" when the customer sends it, "decided" when a specialist
 * replies. They carry only the reference, the status and the way back to the app: never the question, the answer, a
 * figure or the specialist's note, which are read in the app. Pure: the sender passes the reference and the app URL in.
 */

const httpUrl = z.url({ protocol: /^https?$/ });

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

/**
 * Where sending is allowed, read from the Convex environment by the caller. Sending is on only where the owner turned
 * it on and pinned it to this deployment's URL, as customer memory is. `live` false is Resend's test mode: the message
 * goes to Resend's test inbox, never to the customer.
 */
export type EmailEnvironment = {
  enabled: boolean; deploymentUrl?: string; cloudUrl?: string; from?: string; appUrl?: string; live: boolean;
};
export const RESEND_TEST_INBOX = "delivered@resend.dev";

export type EmailDelivery =
  | { send: true; to: string; from: string; appUrl?: string; testMode: boolean }
  | { send: false; reason: "off" | "not_configured" | "opted_out" | "no_address" };

export function emailDelivery(env: EmailEnvironment, check: { optIn: boolean; address: string | null | undefined }): EmailDelivery {
  if (!env.enabled || !env.deploymentUrl || env.deploymentUrl !== env.cloudUrl) return { send: false, reason: "off" };
  if (!env.from) return { send: false, reason: "not_configured" };
  if (!check.optIn) return { send: false, reason: "opted_out" };
  if (!check.address || !z.email().safeParse(check.address).success) return { send: false, reason: "no_address" };
  const appUrl = env.appUrl && httpUrl.safeParse(env.appUrl).success ? env.appUrl : undefined;
  return { send: true, to: env.live ? check.address : RESEND_TEST_INBOX, from: env.from, testMode: !env.live, ...(appUrl ? { appUrl } : {}) };
}

/** "s•••@gmail.com": how the request panel shows the address it will write to. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 1 ? "your e-mail" : `${address[0]}•••${address.slice(at)}`;
}

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
  const url = input.appUrl ? checksUrl(input.appUrl) : null;
  const ref = `Reference: ${input.reference}`;

  const text = [lead, where, ref, ...(url ? [`Your specialist checks: ${url}`] : []), "", SAFETY, WHY].join("\n");
  const p = (s: string, style = "") => `<p style="margin:0 0 12px;font:14px/1.5 Geist,Arial,sans-serif;color:#1A1A1A;${style}">${s}</p>`;
  const html = [
    `<div style="max-width:520px;padding:24px">`,
    p(escape(lead)),
    p(escape(where)),
    p(escape(ref), "font-family:'Geist Mono',Menlo,monospace;font-size:13px"),
    url ? p(`<a href="${escape(url)}" style="color:#1A1A1A">Your specialist checks</a>`) : "",
    p(escape(SAFETY), "color:#5C5C5C;font-size:13px"),
    p(escape(WHY), "color:#5C5C5C;font-size:13px"),
    `</div>`,
  ].join("");
  return answerCheckEmailSchema.parse({ subject, text, html });
}
