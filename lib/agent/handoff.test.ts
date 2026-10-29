import { describe, expect, it } from "vitest";
import cases from "../../evals/specialist-offer.json";
import { composeAnswer, offersSpecialist, routeResponse } from "./composer";
import { HANDOFF_PREVIEW_MESSAGES, SPECIALIST_LABEL, handoffActionFor, handoffPreview, handoffReference } from "./handoff";
import type { RoutePlan } from "./route";

describe("adviser handoff", () => {
  it("shares only the customer's recent messages, screened and capped", () => {
    const messages = Array.from({ length: 9 }, (_, i) => `Message ${i + 1}`);
    expect(handoffPreview(messages)).toEqual(messages.slice(-HANDOFF_PREVIEW_MESSAGES));
    const [line] = handoffPreview(["My IBAN is RO49AAAA1B31007593840000, call me on 0722 123 456."]);
    expect(line).not.toContain("RO49AAAA1B31007593840000");
    expect(line).not.toContain("0722 123 456");
    const long = handoffPreview(["a".repeat(1000), "b".repeat(1000)]);
    expect(long.join("").length).toBeLessThanOrEqual(1500);
    expect(long.at(-1)).toBe("b".repeat(1000));
  });

  it("issues a short reference without ambiguous characters", () => {
    expect(handoffReference(() => 0)).toBe("RF-222222");
    expect(handoffReference(() => 0.999)).toMatch(/^RF-[2-9A-HJ-NP-Z]{6}$/);
  });
});

describe("evals/specialist-offer.json", () => {
  type Case = { id: string; inquiry: RoutePlan["inquiry"]; handler: RoutePlan["handler"]; mode: Parameters<typeof handoffActionFor>[1];
    offered?: boolean; review?: boolean; expect: string | null };
  for (const c of cases.cases as Case[]) {
    it(`${c.id}: ${c.expect ?? "no button"}`, () => {
      const plan = { inquiry: c.inquiry, handler: c.handler } as RoutePlan;
      if (c.expect === "booking_card") {
        // The contact answer shows the booking card itself (convex/agent.ts), and the composer adds no button
        const envelope = composeAnswer("m1", { ...plan, candidates: [], scope: null, suppressOffers: false } as RoutePlan, routeResponse(plan));
        expect(envelope.actions).toEqual([]);
        expect(offersSpecialist(envelope, plan.handler)).toBe(true);
        return;
      }
      const action = handoffActionFor(plan, c.mode, { offered: c.offered, review: c.review });
      expect(action?.reason ?? null).toBe(c.expect);
      if (action) expect(action.label).toBe(SPECIALIST_LABEL);
    });
  }
});
