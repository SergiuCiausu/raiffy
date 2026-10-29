import { describe, expect, it } from "vitest";
import { RESEND_TEST_INBOX, answerCheckEmail, checksUrl, emailDelivery, maskEmail } from "./answerCheckEmail";

describe("answerCheckEmail", () => {
  it("confirms a sent check with its reference and the safety line", () => {
    const e = answerCheckEmail({ kind: "received", reference: "AC-7K2Q9D" });
    expect(e.subject).toBe("We’ve received your request AC-7K2Q9D");
    expect(e.text).toContain("Reference: AC-7K2Q9D");
    expect(e.text).toContain("never asks for codes");
    expect(e.text).not.toContain("http");
    expect(e.html).not.toContain("<a ");
  });

  it("names each decision without carrying the note", () => {
    expect(answerCheckEmail({ kind: "decided", reference: "AC-7K2Q9D", status: "confirmed" }).subject).toBe("A specialist confirmed your answer");
    expect(answerCheckEmail({ kind: "decided", reference: "AC-7K2Q9D", status: "corrected" }).subject).toBe("A specialist corrected your answer");
    expect(answerCheckEmail({ kind: "decided", reference: "AC-7K2Q9D", status: "returned" }).subject).toBe("A specialist replied to your check");
  });

  it("links only to the checks page when an app URL is given", () => {
    const e = answerCheckEmail({ kind: "decided", reference: "AC-7K2Q9D", status: "confirmed", appUrl: "https://raiffy.example/anything?x=1" });
    expect(checksUrl("https://raiffy.example/anything")).toBe("https://raiffy.example/chat/checks");
    expect(e.text).toContain("https://raiffy.example/chat/checks");
    expect(e.html).toContain('href="https://raiffy.example/chat/checks"');
  });

  it("carries no figures apart from the reference", () => {
    for (const status of ["confirmed", "corrected", "returned"] as const) {
      const e = answerCheckEmail({ kind: "decided", reference: "AC-7K2Q9D", status });
      expect(`${e.subject}\n${e.text}`.replace("AC-7K2Q9D", "")).not.toMatch(/\d/);
    }
  });

  it("refuses an open status, a malformed reference and a non-URL", () => {
    // @ts-expect-error open is not a decision
    expect(() => answerCheckEmail({ kind: "decided", reference: "AC-7K2Q9D", status: "open" })).toThrow();
    expect(() => answerCheckEmail({ kind: "received", reference: "<b>AC-1</b>" })).toThrow();
    expect(() => answerCheckEmail({ kind: "received", reference: "AC-7K2Q9D", appUrl: "javascript:alert(1)" })).toThrow();
  });
});

describe("emailDelivery", () => {
  const url = "https://diligent-rhinoceros-830.eu-west-1.convex.cloud";
  const env = { enabled: true, deploymentUrl: url, cloudUrl: url, from: "Raiffy <raiffy@example.com>", appUrl: "https://raiffy.example", live: false };
  const check = { optIn: true, address: "ana@example.com" };

  it("is off unless turned on and pinned to this deployment", () => {
    expect(emailDelivery({ ...env, enabled: false }, check)).toEqual({ send: false, reason: "off" });
    expect(emailDelivery({ ...env, deploymentUrl: undefined }, check)).toEqual({ send: false, reason: "off" });
    expect(emailDelivery({ ...env, cloudUrl: "https://other.convex.cloud" }, check)).toEqual({ send: false, reason: "off" });
    expect(emailDelivery({ ...env, from: undefined }, check)).toEqual({ send: false, reason: "not_configured" });
  });

  it("respects the customer's choice and needs a valid address", () => {
    expect(emailDelivery(env, { ...check, optIn: false })).toEqual({ send: false, reason: "opted_out" });
    expect(emailDelivery(env, { ...check, address: null })).toEqual({ send: false, reason: "no_address" });
    expect(emailDelivery(env, { ...check, address: "not an address" })).toEqual({ send: false, reason: "no_address" });
  });

  it("writes to Resend's test inbox until it's live, and to the customer once it is", () => {
    expect(emailDelivery(env, check)).toEqual({ send: true, to: RESEND_TEST_INBOX, from: env.from, appUrl: env.appUrl, testMode: true });
    expect(emailDelivery({ ...env, live: true }, check)).toMatchObject({ send: true, to: "ana@example.com", testMode: false });
    expect(emailDelivery({ ...env, appUrl: "javascript:alert(1)" }, check)).not.toHaveProperty("appUrl");
  });
});

describe("maskEmail", () => {
  it("shows the first letter and the domain", () => {
    expect(maskEmail("sarah@gmail.com")).toBe("s•••@gmail.com");
    expect(maskEmail("@nope")).toBe("your e-mail");
  });
});
