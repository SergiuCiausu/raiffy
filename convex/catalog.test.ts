import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import type { JSONValue } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { getProductTerms } from "./catalog";
import schema from "./schema";
import type { TermRecord } from "../lib/catalog/schemas";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./catalog.ts": () => import("./catalog"),
  "./audit.ts": () => import("./audit"),
};
const fresh = () => convexTest(schema, modules);
const identity = (subject: string, role?: JSONValue) => ({
  subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, ...(role === undefined ? {} : { role }),
});
const NOW = Date.parse("2026-10-28T12:00:00Z");

const record = (over: Partial<TermRecord> = {}): TermRecord => ({
  termId: "raiffeisen:loan#comision-de-analiza", productId: "raiffeisen:loan", product: "Credit de nevoi personale",
  bank: "raiffeisen", track: "personal", kind: "fee", label: "Comision de analiză",
  value: { type: "exact", amount: 20000 }, unit: "minor_ron", frequency: "once", conditions: [],
  comparability: { category: "personal_loan", currency: "RON" }, quote: "comision analiza 200 Lei",
  provenance: { bank: "raiffeisen", url: "https://www.raiffeisen.ro/loan.html", collectedAt: "2026-10-28T07:45:27+00:00", reviewBy: "2026-11-27", status: "fresh" },
  verification: { quoteFound: true },
  ...over,
});

async function seeded(...records: TermRecord[]) {
  const t = fresh();
  await t.run(async (ctx) => { for (const r of records) await ctx.db.insert("productTerms", r); });
  return t;
}
const lookup = (t: ReturnType<typeof fresh>, track: "personal" | "business", input: unknown) =>
  t.run((ctx) => getProductTerms(ctx as unknown as ActionCtx, track, input, NOW));

describe("get_product_terms handler", () => {
  it("rejects an anonymous caller before reading the catalog", async () => {
    const t = await seeded(record());
    await expect(lookup(t, "personal", { query: "fees", productIds: ["raiffeisen:loan"] })).rejects.toThrow("authentication_required");
  });

  it("rejects input outside the tool contract", async () => {
    const t = (await seeded(record())).withIdentity(identity("alice"));
    await expect(lookup(t as never, "personal", { query: "fees", productIds: ["a"], track: "business" })).rejects.toThrow();
    await expect(lookup(t as never, "personal", { query: "fees", productIds: Array(7).fill("a") })).rejects.toThrow();
  });

  it("returns unreviewed values as unavailable, then usable once reviewed", async () => {
    const base = await seeded(record());
    const alice = base.withIdentity(identity("alice"));
    const before = await lookup(alice as never, "personal", { query: "analysis fee", productIds: ["raiffeisen:loan"] });
    expect(before).toMatchObject({ status: "unavailable", unavailable: [{ reason: "unreviewed" }] });

    await base.withIdentity(identity("admin", "admin")).mutation(anyApi.catalog.markReviewed, { termId: record().termId });
    const after = await lookup(alice as never, "personal", { query: "analysis fee", productIds: ["raiffeisen:loan"] });
    expect(after.status).toBe("ok");
    expect(after.products[0].terms[0].verification.reviewedBy).toBe("admin");
  });

  it("keeps the business track away from personal records", async () => {
    const base = await seeded(record({ verification: { quoteFound: true, reviewedBy: "admin" } }));
    const input = { query: "fees", productIds: ["raiffeisen:loan"] };
    await expect(lookup(base.withIdentity(identity("alice")) as never, "business", input)).rejects.toThrow("organization_required");
    const company = base.withIdentity({ ...identity("bob"), org_id: "org_1" });
    expect((await lookup(company as never, "business", input)).unavailable).toEqual([{ productId: "raiffeisen:loan", reason: "unknown_product" }]);
  });
});

describe("catalog:markReviewed", () => {
  it("is for admins only", async () => {
    const t = await seeded(record());
    await expect(t.withIdentity(identity("op", "operator")).mutation(anyApi.catalog.markReviewed, { termId: record().termId })).rejects.toThrow("forbidden");
  });

  it("refuses a value whose quote wasn't found or that the source states as missing", async () => {
    const t = await seeded(
      record({ termId: "no-quote", verification: { quoteFound: false } }),
      record({ termId: "gap", value: { type: "unavailable", reason: "nu apare pe pagină" }, unit: "none" }),
    );
    const admin = t.withIdentity(identity("admin", "admin"));
    await expect(admin.mutation(anyApi.catalog.markReviewed, { termId: "no-quote" })).rejects.toThrow("quote_not_found");
    await expect(admin.mutation(anyApi.catalog.markReviewed, { termId: "gap" })).rejects.toThrow("quote_not_found");
  });

  it("writes an audit entry", async () => {
    const t = await seeded(record());
    await t.withIdentity(identity("admin", "admin")).mutation(anyApi.catalog.markReviewed, { termId: record().termId, note: "Checked on the page" });
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log).toMatchObject([{ actorUserId: "admin", action: "catalog.term_reviewed", details: { termId: record().termId }, note: "Checked on the page" }]);
  });
});
