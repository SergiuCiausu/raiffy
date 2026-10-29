import { describe, expect, it } from "vitest";
import { planCheckEmail } from "./planCheckEmail";

describe("plan check e-mails", () => {
  it("says it was received, with the plan ID, the reference and the way back, and nothing else", () => {
    const e = planCheckEmail({ kind: "received", reference: "PC-7K2Q9D", planId: "PS-4821", appUrl: "https://raiffy.example/" });
    expect(e.subject).toBe("We’ve received your plan check PC-7K2Q9D");
    expect(e.text).toContain("will check plan PS-4821 against the bank’s terms.");
    expect(e.text).toContain("Your plans: https://raiffy.example/chat/plans");
    expect(e.text).toContain("Raiffeisen never asks for codes");
    expect(e.html).toContain('href="https://raiffy.example/chat/plans"');
    expect(e.text).not.toMatch(/lei|%/);
  });

  it("words each decision, and refuses a reference that isn't a plan check's", () => {
    const decided = (status: "confirmed" | "corrected" | "returned") => planCheckEmail({ kind: "decided", reference: "PC-7K2Q9D", planId: "PS-4821", status }).subject;
    expect([decided("confirmed"), decided("corrected"), decided("returned")]).toEqual([
      "A specialist confirmed your plan", "A specialist confirmed your plan, with a note", "A specialist replied about your plan",
    ]);
    expect(() => planCheckEmail({ kind: "received", reference: "AC-7K2Q9D", planId: "PS-4821" })).toThrow();
  });
});
