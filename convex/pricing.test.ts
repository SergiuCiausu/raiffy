import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import schema from "./schema";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./pricing.ts": () => import("./pricing"),
  "./accounts.ts": () => import("./accounts"),
};
const who = (subject: string, role?: string) => ({ subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, name: subject, ...(role ? { role } : {}) });
const owner = (subject: string) => `https://clerk.test|${subject}`;

const log = (ownerKey: string, over: Record<string, unknown> = {}) => ({
  ownerKey, productId: "raiffy-mortgage", segment: "A:salary", amount: 40_000_000, months: 240, today: "2026-10-29",
  competitor: { id: "sample-bank-c-mortgage", bank: "Bank C (sample)", source: "official_store", totalPayable: 67_846_257 },
  ourListTotal: 70_000_000, ourTotal: 69_284_618, resolution: "escalate",
  internal: { bandId: "mortgage-ab", level: "specialist", neededCutBps: 25 }, ...over,
});

async function setup() {
  const t = convexTest(schema, modules);
  const messageId = await t.run(async (ctx) => {
    const threadId = await ctx.db.insert("ragThreads", { track: "personal", title: "t", ownerKey: owner("alice"), organizationKey: null });
    return ctx.db.insert("ragMessages", { threadId, role: "assistant", text: "" } as never);
  });
  return { t, messageId };
}

describe("negotiation: review cases, offers and the win rate", () => {
  it("lets only the customer ask for a review of their own escalated case", async () => {
    const { t, messageId } = await setup();
    const { logId } = await t.mutation(anyApi.pricing.logNegotiation, { ...log(owner("alice")), messageId });
    await expect(t.withIdentity(who("bob")).mutation(anyApi.pricing.requestReview, { logId })).rejects.toThrow(/not_found/);
    await t.withIdentity(who("alice")).mutation(anyApi.pricing.requestReview, { logId });
    await t.withIdentity(who("alice")).mutation(anyApi.pricing.requestReview, { logId });
    const cases = await t.run((ctx) => ctx.db.query("reviewCases").collect());
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ level: "specialist", status: "open" });
  });

  it("keeps the queue and the win rate to operators, and a specialist's price comes back as a personal offer", async () => {
    const { t, messageId } = await setup();
    const { logId } = await t.mutation(anyApi.pricing.logNegotiation, { ...log(owner("alice")), messageId });
    await t.withIdentity(who("alice")).mutation(anyApi.pricing.requestReview, { logId });
    await expect(t.withIdentity(who("alice")).query(anyApi.pricing.listReviews, {})).rejects.toThrow(/forbidden/);
    await expect(t.withIdentity(who("alice")).query(anyApi.pricing.winRate, {})).rejects.toThrow(/forbidden/);

    const ana = t.withIdentity(who("Ana M.", "operator"));
    const queue = await ana.query(anyApi.pricing.listReviews, {});
    expect(queue.open).toHaveLength(1);
    expect(queue.open[0]).toMatchObject({ canDecide: true, levelLabel: "Credit specialist" });
    await ana.mutation(anyApi.pricing.decideReview, { caseId: queue.open[0].id, decision: "approve", rateBps: 565, waiveFee: true });

    const offers = await t.query(anyApi.pricing.offersFor, { ownerKey: owner("alice"), productId: "raiffy-mortgage" });
    expect(offers).toEqual([expect.objectContaining({ rateBps: 565, upfrontFee: 0, origin: "specialist", issuedBy: { name: "Ana M.", role: "Credit specialist" } })]);
    expect(await t.query(anyApi.pricing.offersFor, { ownerKey: owner("bob"), productId: "raiffy-mortgage" })).toEqual([]);
    const mine = await t.withIdentity(who("alice")).query(anyApi.pricing.myNegotiations, { logIds: [logId] });
    expect(mine[0]).toMatchObject({ review: "approved", approvedOffer: { rateBps: 565, approvedBy: "Ana M." } });
  });

  it("doesn't let an operator decide above their approval level", async () => {
    const { t, messageId } = await setup();
    const { logId } = await t.mutation(anyApi.pricing.logNegotiation, { ...log(owner("alice"), { internal: { bandId: null, level: "pricingCommittee", neededCutBps: 955 } }), messageId });
    await t.withIdentity(who("alice")).mutation(anyApi.pricing.requestReview, { logId });
    const ana = t.withIdentity(who("ana", "operator"));
    const [c] = (await ana.query(anyApi.pricing.listReviews, {})).open;
    expect(c.canDecide).toBe(false);
    await expect(ana.mutation(anyApi.pricing.decideReview, { caseId: c.id, decision: "approve", rateBps: 500 })).rejects.toThrow(/forbidden/);
    await t.withIdentity(who("root", "admin")).mutation(anyApi.pricing.decideReview, { caseId: c.id, decision: "decline" });
  });

  it("returns the same counter-offer and expiry when asked again, and records simulated outcomes", async () => {
    const { t, messageId } = await setup();
    const offer = { levers: ["Origination fee waived"], rateBps: 790, upfrontFee: 0, monthlyFee: 0, totalPayable: 834_645, validUntil: "2026-11-05" };
    const band = log(owner("alice"), { productId: "raiffy-personal-loan", resolution: "band", offer, competitor: { id: "sample-bank-b-loan", bank: "Bank B (sample)", source: "official_store", totalPayable: 847_428 } });
    const first = await t.mutation(anyApi.pricing.logNegotiation, { ...band, messageId });
    const again = await t.mutation(anyApi.pricing.logNegotiation, { ...band, messageId, today: "2026-11-01", offer: { ...offer, validUntil: "2026-11-08" } });
    expect(again).toEqual(first);
    await expect(t.withIdentity(who("bob")).mutation(anyApi.pricing.setOutcome, { logId: first.logId, outcome: "accepted" })).rejects.toThrow(/not_found/);
    // The offer's validity is checked against today's date: this one, dated in the past, has expired
    await t.run((ctx) => ctx.db.patch(first.logId, { offer: { ...offer, validUntil: "2020-01-01" } }));
    await expect(t.withIdentity(who("alice")).mutation(anyApi.pricing.setOutcome, { logId: first.logId, outcome: "accepted" })).rejects.toThrow(/offer_expired/);

    const second = await t.mutation(anyApi.pricing.logNegotiation, { ...band, messageId, offer: { ...offer, validUntil: "2099-01-01" } });
    await t.withIdentity(who("alice")).mutation(anyApi.pricing.setOutcome, { logId: second.logId, outcome: "accepted" });
    await t.mutation(anyApi.pricing.logNegotiation, { ...log(owner("alice"), { resolution: "not_needed", internal: { bandId: null, level: null, neededCutBps: null } }), messageId });

    const kpi = await t.withIdentity(who("ana", "operator")).query(anyApi.pricing.winRate, {});
    expect(kpi.total).toBe(3);
    expect(kpi.notNeeded).toBe(1);
    expect(kpi.byResolution).toEqual([expect.objectContaining({ key: "Inside the band", offered: 2, accepted: 1, expired: 1, winRate: 0.5 })]);
  });
});
