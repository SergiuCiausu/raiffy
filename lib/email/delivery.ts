import { z } from "zod";

/* Whether and where a service e-mail may go: shared by the answer-check and booking e-mails. Pure. */

export const httpUrl = z.url({ protocol: /^https?$/ });

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
