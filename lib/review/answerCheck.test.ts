import { describe, expect, it } from "vitest";
import { answerCheckDecisionSchema, answerCheckReference, answerSnapshot, canFlag, decide } from "./answerCheck";

const answered = { role: "assistant" as const, status: "done" as const, text: "Here are your routes.", answer: { status: "answered" } };

describe("canFlag", () => {
  it("allows a finished answer, including one that found nothing", () => {
    expect(canFlag(answered)).toBe(true);
    expect(canFlag({ ...answered, status: undefined })).toBe(true);
    expect(canFlag({ ...answered, answer: { status: "no_results" } })).toBe(true);
  });

  it("refuses customer messages, unfinished, refused and empty answers", () => {
    expect(canFlag({ ...answered, role: "user" })).toBe(false);
    for (const status of ["streaming", "stopped", "failed"] as const) expect(canFlag({ ...answered, status })).toBe(false);
    expect(canFlag({ ...answered, answer: { status: "refused" } })).toBe(false);
    expect(canFlag({ ...answered, answer: { status: "failed_checks" } })).toBe(false);
    expect(canFlag({ ...answered, answer: undefined })).toBe(false);
    expect(canFlag({ ...answered, text: "  " })).toBe(false);
  });
});

describe("decisions", () => {
  it("needs a note to correct or return, not to confirm", () => {
    expect(answerCheckDecisionSchema.safeParse({ decision: "confirm" }).success).toBe(true);
    expect(answerCheckDecisionSchema.safeParse({ decision: "correct", note: "  " }).success).toBe(false);
    expect(answerCheckDecisionSchema.safeParse({ decision: "return" }).success).toBe(false);
    expect(answerCheckDecisionSchema.safeParse({ decision: "return", note: "x".repeat(501) }).success).toBe(false);
    expect(answerCheckDecisionSchema.parse({ decision: "correct", note: " The fee is 0 lei. " })).toEqual({ decision: "correct", note: "The fee is 0 lei." });
  });

  it("decides an open check once", () => {
    expect(decide("open", { decision: "confirm" })).toEqual({ ok: true, status: "confirmed" });
    expect(decide("open", { decision: "correct", note: "n" })).toEqual({ ok: true, status: "corrected" });
    expect(decide("open", { decision: "return", note: "n" })).toEqual({ ok: true, status: "returned" });
    expect(decide("confirmed", { decision: "return", note: "n" })).toEqual({ ok: false, reason: "already_decided" });
  });
});

describe("answerSnapshot", () => {
  it("masks identifiers in questions, answer and note, and keeps sources and route", () => {
    const s = answerSnapshot({
      customerMessages: ["My card is 4111 1111 1111 1111, can I borrow 50,000 lei?"],
      answerText: "For 4111 1111 1111 1111 the routes are:\n\nA personal loan.\n\n\nAn overdraft.",
      answer: {
        sources: [{ title: "Personal loan", url: "https://www.raiffeisen.ro/loan", collectedOn: "2026-10-01" }, { title: "no url" }],
        routing: { inquiry: "loan_solution", handler: "answer" },
        checks: { ungroundedNumbers: ["5.9"] },
      },
      note: "Email me at ana@example.com",
    });
    expect(s.questions[0]).not.toContain("4111");
    expect(s.paragraphs).toHaveLength(3);
    expect(s.paragraphs[0]).toContain("[REDACTED]");
    expect(s.sources).toEqual([{ title: "Personal loan", url: "https://www.raiffeisen.ro/loan", collectedOn: "2026-10-01" }]);
    expect(s).toMatchObject({ inquiry: "loan_solution", handler: "answer", ungroundedNumbers: 1 });
    expect(s.note).not.toContain("ana@example.com");
  });

  it("reads older answers without routing or checks", () => {
    const s = answerSnapshot({ customerMessages: [], answerText: "Hello.", answer: { status: "answered" }, note: "  " });
    expect(s).toMatchObject({ questions: [], paragraphs: ["Hello."], sources: [], inquiry: null, handler: null, ungroundedNumbers: 0, note: null });
  });

  it("caps a very long paragraph instead of failing", () => {
    const s = answerSnapshot({ customerMessages: [], answerText: "a".repeat(9000), answer: {} });
    expect(s.paragraphs[0]).toBe(`${"a".repeat(3800)}…`);
  });
});

describe("answerCheckReference", () => {
  it("is a short quotable code", () => {
    expect(answerCheckReference(() => 0)).toBe("AC-222222");
    expect(answerCheckReference(Math.random)).toMatch(/^AC-[2-9A-HJ-NP-Z]{6}$/);
  });
});
