import { z } from "zod";
import { httpUrl } from "../email/delivery";
import { channelSchema, localDateTimeSchema } from "./schemas";
import { toInstant } from "./rules";

/*
 * The e-mails sent when a customer books a call: one to the customer, one to the specialist. They carry the time,
 * the channel and the reference, and point back to the app. Never the topic, a shared plan or the video link: the
 * topic is the customer's own words, the plan opens only around the call, and the link only near the start.
 * Pure: the sender passes the booking's facts and the app URL in.
 */

const reference = z.string().regex(/^BK-\d{6}$/);
const base = {
  reference, start: localDateTimeSchema, timeZone: z.string().min(1), minutes: z.number().int().positive(), channel: channelSchema,
  appUrl: httpUrl.optional(),
};

export const bookingEmailInputSchema = z.discriminatedUnion("to", [
  z.object({ to: z.literal("customer"), ...base, operatorName: z.string().min(1).max(40),
    /** When the call must be confirmed by, or null when booking it confirmed it. */
    confirmBy: z.number().nullable() }).strict(),
  z.object({ to: z.literal("operator"), ...base, customerName: z.string().min(1).max(40), customerRef: z.string().min(1).max(20) }).strict(),
]);
export type BookingEmailInput = z.infer<typeof bookingEmailInputSchema>;

export const bookingEmailSchema = z.object({ subject: z.string().min(1), text: z.string().min(1), html: z.string().min(1) });
export type BookingEmail = z.infer<typeof bookingEmailSchema>;

const SAFETY = "Raiffeisen never asks for codes, passwords, card details or a transfer by e-mail.";
const CUSTOMER_WHY = "You’re getting this because you booked a call with a specialist in Raiffy. The call is about information, not a credit decision or financial advice.";
const OPERATOR_WHY = "You’re getting this because a customer booked a call with you in Raiffy.";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "Monday 2 November, 14:00 (Romania time)": the specialist's wall-clock time, named by its zone. */
export function whenText(start: string, timeZone: string): string {
  const at = new Date(toInstant(start, timeZone));
  const day = at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone });
  const zone = timeZone === "Europe/Bucharest" ? "Romania time" : timeZone.replace(/_/g, " ");
  return `${day}, ${start.slice(11, 16)} (${zone})`;
}

const confirmText = (at: number, timeZone: string) =>
  new Date(at).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });

export function bookingEmail(raw: BookingEmailInput): BookingEmail {
  const input = bookingEmailInputSchema.parse(raw);
  const when = whenText(input.start, input.timeZone);
  const how = `${input.minutes}-minute ${input.channel === "video" ? "video call" : "phone call"}`;
  const ref = `Reference: ${input.reference}`;
  let subject: string, lines: string[], link: { label: string; url: string } | null, why: string;
  if (input.to === "customer") {
    subject = `Your call with ${input.operatorName} is booked`;
    lines = [
      `You booked a ${how} with ${input.operatorName}, a Raiffeisen specialist, on ${when}.`,
      input.confirmBy === null ? "It’s confirmed." : `Confirm it in Raiffy by ${confirmText(input.confirmBy, input.timeZone)}, or the time is released for someone else.`,
      input.channel === "video" ? "The video link appears in Raiffy 10 minutes before the call." : "The specialist will phone you at that time.",
    ];
    link = input.appUrl ? { label: "Your calls", url: new URL("/chat/calls", input.appUrl).toString() } : null;
    why = CUSTOMER_WHY;
  } else {
    subject = `New call booked: ${when}`;
    lines = [
      `${input.customerName} (${input.customerRef}) booked a ${how} with you on ${when}.`,
      "The topic, and any plan they chose to share, are in the console.",
    ];
    link = input.appUrl ? { label: "Your calendar", url: new URL("/console", input.appUrl).toString() } : null;
    why = OPERATOR_WHY;
  }

  const text = [...lines, ref, ...(link ? [`${link.label}: ${link.url}`] : []), "", SAFETY, why].join("\n");
  const p = (s: string, style = "") => `<p style="margin:0 0 12px;font:14px/1.5 Geist,Arial,sans-serif;color:#1A1A1A;${style}">${s}</p>`;
  const html = [
    `<div style="max-width:520px;padding:24px">`,
    ...lines.map((l) => p(escape(l))),
    p(escape(ref), "font-family:'Geist Mono',Menlo,monospace;font-size:13px"),
    link ? p(`<a href="${escape(link.url)}" style="color:#1A1A1A">${escape(link.label)}</a>`) : "",
    p(escape(SAFETY), "color:#5C5C5C;font-size:13px"),
    p(escape(why), "color:#5C5C5C;font-size:13px"),
    `</div>`,
  ].join("");
  return bookingEmailSchema.parse({ subject, text, html });
}
