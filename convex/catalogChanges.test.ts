import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anyApi } from "convex/server";
import type { JSONValue } from "convex/values";
import schema from "./schema";
import { termUse } from "../lib/catalog/review";
import type { TermRecord } from "../lib/catalog/schemas";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./catalogChanges.ts": () => import("./catalogChanges"),
  "./audit.ts": () => import("./audit"),
};
const identity = (subject: string, role?: JSONValue) => ({ subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, ...(role === undefined ? {} : { role }) });
const NOW = Date.parse("2026-10-29T10:00:00Z");
const TERM: TermRecord = {
  termId: "rf-rate", productId: "rf", product: "Flexicredit", bank: "raiffeisen", track: "personal", kind: "interest_rate", label: "Interest rate",
  value: { type: "exact", amount: 940 }, unit: "bps", conditions: [],
  comparability: { category: "personal_loan", currency: "RON", rateType: "fixed" },
  quote: "dobândă fixă 9,40%",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/flexicredit.html", chunkId: "c1", collectedAt: "2026-10-01T07:45:27+00:00", reviewBy: "2026-12-01", status: "fresh" },
  verification: { quoteFound: true },
};
const edit = (over: Record<string, unknown> = {}) => ({
  termId: "rf-rate", value: { type: "exact", amount: 920 }, quote: "dobândă fixă 9,20%", url: "https://www.raiffeisen.ro/flexicredit.html", reviewBy: "2027-01-31", note: "October rate sheet", ...over,
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("productTerms", TERM as never));
  return {
    t,
    operator: t.withIdentity(identity("user_op", "operator")),
    admin: t.withIdentity(identity("user_admin", "admin")),
    member: t.withIdentity(identity("user_m", "member")),
    term: () => t.run(async (ctx) => (await ctx.db.query("productTerms").withIndex("by_termId", (q) => q.eq("termId", "rf-rate")).unique())!),
    audit: () => t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).map((e) => e.action)),
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("catalog changes", () => {
  it("waits for an admin when an operator proposes, then reaches the catalog the chat reads", async () => {
    const { operator, admin, term, audit } = await setup();
    const { changeId, status } = await operator.mutation(anyApi.catalogChanges!.propose!, edit());
    expect(status).toBe("pending");
    expect((await term()).value).toEqual({ type: "exact", amount: 940 });
    // One open change per value at a time
    await expect(admin.mutation(anyApi.catalogChanges!.propose!, edit({ value: { type: "exact", amount: 900 }, quote: "9,00%" }))).rejects.toThrow("change_pending");
    await expect(operator.mutation(anyApi.catalogChanges!.approve!, { changeId })).rejects.toThrow("forbidden");

    await admin.mutation(anyApi.catalogChanges!.approve!, { changeId, note: "Matches the ALCO sheet" });
    const after = await term();
    expect(after).toMatchObject({ value: { type: "exact", amount: 920 }, quote: "dobândă fixă 9,20%", verification: { quoteFound: true, reviewedBy: "user_admin" } });
    expect(after.provenance).toMatchObject({ reviewBy: "2027-01-31", status: "fresh", chunkId: "c1" });
    // An imported value waiting for a reviewer becomes usable once a person publishes it
    expect(termUse(TERM, NOW)).toBe("unreviewed");
    const { _id, _creationTime, ...record } = after;
    expect(termUse(record as TermRecord, NOW)).toBe("usable");
    expect(await audit()).toEqual(["catalog.proposed", "catalog.published"]);
  });

  it("publishes an admin's change at once, and refuses one that changes nothing", async () => {
    const { admin, term } = await setup();
    expect((await admin.mutation(anyApi.catalogChanges!.propose!, edit({ url: "https://www.raiffeisen.ro/rates.pdf" }))).status).toBe("published");
    const after = await term();
    expect(after.provenance.url).toBe("https://www.raiffeisen.ro/rates.pdf");
    expect(after.provenance).not.toHaveProperty("chunkId");
    await expect(admin.mutation(anyApi.catalogChanges!.propose!, edit({ url: "https://www.raiffeisen.ro/rates.pdf" }))).rejects.toThrow("no_change");
  });

  it("re-confirms a value with a fresh source, and rejects with a reason the operator sees", async () => {
    const { operator, admin } = await setup();
    const confirm = await operator.mutation(anyApi.catalogChanges!.propose!, edit({ value: { type: "exact", amount: 940 }, quote: "dobândă fixă 9,40%" }));
    await expect(admin.mutation(anyApi.catalogChanges!.reject!, { changeId: confirm.changeId, note: " " })).rejects.toThrow("reason_required");
    await admin.mutation(anyApi.catalogChanges!.reject!, { changeId: confirm.changeId, note: "Use the November sheet" });
    const [c] = await operator.query(anyApi.catalogChanges!.forProduct!, { productId: "rf" });
    expect(c).toMatchObject({ kind: "confirm", status: "rejected", decisionNote: "Use the November sheet" });
    await expect(admin.mutation(anyApi.catalogChanges!.approve!, { changeId: confirm.changeId })).rejects.toThrow("change_not_pending");
    expect(await operator.query(anyApi.catalogChanges!.pending!, {})).toEqual([]);
    expect((await operator.query(anyApi.catalogChanges!.decided!, {})).map((c: { changeId: string }) => c.changeId)).toEqual([confirm.changeId]);
  });

  it("rolls back only the latest published change, restoring the value before it", async () => {
    const { operator, admin, term, audit } = await setup();
    const first = await admin.mutation(anyApi.catalogChanges!.propose!, edit());
    const second = await admin.mutation(anyApi.catalogChanges!.propose!, edit({ value: { type: "exact", amount: 900 }, quote: "dobândă fixă 9,00%" }));
    await expect(operator.mutation(anyApi.catalogChanges!.rollBack!, { changeId: first.changeId, note: "Wrong" })).rejects.toThrow("rollback_not_latest");
    const back = await operator.mutation(anyApi.catalogChanges!.rollBack!, { changeId: second.changeId, note: "Published too early" });
    expect(back.status).toBe("pending");
    await admin.mutation(anyApi.catalogChanges!.approve!, { changeId: back.changeId });
    expect((await term()).value).toEqual({ type: "exact", amount: 920 });
    const list = await operator.query(anyApi.catalogChanges!.forProduct!, { productId: "rf" });
    expect(list.map((c: { kind: string; status: string; latest: boolean }) => [c.kind, c.status, c.latest])).toEqual([
      ["rollback", "published", true], ["edit", "rolledBack", false], ["edit", "published", false],
    ]);
    expect((await audit()).at(-1)).toBe("catalog.rolled_back");
  });

  it("refuses an approval once the value has changed underneath it", async () => {
    const { operator, admin, t } = await setup();
    const { changeId } = await operator.mutation(anyApi.catalogChanges!.propose!, edit());
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("productTerms").withIndex("by_termId", (q) => q.eq("termId", "rf-rate")).unique())!;
      await ctx.db.patch(row._id, { quote: "re-imported" });
    });
    await expect(admin.mutation(anyApi.catalogChanges!.approve!, { changeId })).rejects.toThrow("change_outdated");
  });

  it("is closed to customers", async () => {
    const { member } = await setup();
    await expect(member.mutation(anyApi.catalogChanges!.propose!, edit())).rejects.toThrow("forbidden");
    await expect(member.query(anyApi.catalogChanges!.pending!, {})).rejects.toThrow("forbidden");
  });
});
