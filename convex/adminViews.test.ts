import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import type { JSONValue } from "convex/values";
import schema from "./schema";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./adminViews.ts": () => import("./adminViews"),
};
const fresh = () => convexTest(schema, modules);
const identity = (subject: string, role?: JSONValue) => ({
  subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, ...(role === undefined ? {} : { role }),
});
const FLAGS = {
  personal_bank_product_docs: true, personal_competitor_docs: false, personal_banking_help: false,
  business_bank_product_docs: false, business_competitor_docs: false, business_banking_help: false,
};
const PID = "raiffeisen:credit";
const future = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

async function seed(t: ReturnType<typeof fresh>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("products", { productId: PID, bank: "raiffeisen", product: "Credit de nevoi personale", kind: "personal_loan", url: "https://www.raiffeisen.ro/c.html",
      collectedAt: "2026-10-28T07:50:00+00:00", summary: "Credit", guide: false, ...FLAGS });
    await ctx.db.insert("products", { productId: "ing:credit", bank: "ing", product: "ING credit", kind: "personal_loan", url: "https://ing.ro/c.html",
      collectedAt: "2026-10-28T07:50:00+00:00", summary: "Credit", guide: false, ...FLAGS });
    const term = {
      productId: PID, product: "Credit de nevoi personale", bank: "raiffeisen" as const, track: "personal" as const, unit: "bps" as const, conditions: [],
      comparability: { category: "personal_loan" }, quote: "dobândă fixă 7,90%",
      provenance: { bank: "raiffeisen" as const, url: "https://www.raiffeisen.ro/c.html", collectedAt: "2026-10-28T07:50:00+00:00", reviewBy: future, status: "fresh" as const },
    };
    await ctx.db.insert("productTerms", { ...term, termId: `${PID}#rate`, kind: "interest_rate", label: "Dobândă", value: { type: "exact", amount: 790 },
      verification: { quoteFound: true, reviewedBy: "user_admin", reviewedAt: "2026-10-28T10:00:00Z" } });
    await ctx.db.insert("productTerms", { ...term, termId: `${PID}#fee`, kind: "fee", label: "Comision", value: { type: "exact", amount: 0 }, unit: "minor_ron",
      verification: { quoteFound: true } });
    await ctx.db.insert("users", { clerkUserId: "user_admin", tokenIdentifier: "t|user_admin", role: "admin", name: "Radu Ionescu", firstSeenAt: 1, lastSeenAt: 1 });
    await ctx.db.insert("auditLog", { actorUserId: "user_admin", actorRole: "admin", action: "catalog.term_reviewed", details: { termId: `${PID}#rate` }, at: 5 });
  });
}

describe("admin views: roles", () => {
  it("refuses anonymous callers and members everywhere", async () => {
    const t = fresh();
    for (const fn of [anyApi.adminViews.products, anyApi.adminViews.audit, anyApi.adminViews.home]) {
      await expect(t.query(fn, {})).rejects.toThrow("authentication_required");
      await expect(t.withIdentity(identity("m", "member")).query(fn, {})).rejects.toThrow("forbidden");
    }
  });

  it("lets operators read the catalog but not the audit log or the admin home", async () => {
    const op = fresh().withIdentity(identity("o", "operator"));
    await expect(op.query(anyApi.adminViews.products, {})).resolves.toEqual([]);
    await expect(op.query(anyApi.adminViews.audit, {})).rejects.toThrow("forbidden");
    await expect(op.query(anyApi.adminViews.home, {})).rejects.toThrow("forbidden");
  });
});

describe("admin views: data", () => {
  it("lists only Raiffeisen products, with their values summarized", async () => {
    const t = fresh(); await seed(t);
    const rows = await t.withIdentity(identity("a", "admin")).query(anyApi.adminViews.products, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productId: PID, track: "personal", review: { terms: 2, usable: 1, unreviewed: 1, headlineTermId: `${PID}#rate` },
      headline: { value: { type: "exact", amount: 790 }, unit: "bps", use: "usable" } });
  });

  it("shows a product's values with the reviewer's name, and nothing for another bank's product", async () => {
    const t = fresh(); await seed(t);
    const admin = t.withIdentity(identity("a", "admin"));
    const p = await admin.query(anyApi.adminViews.product, { productId: PID });
    expect(p.terms.find((x: { termId: string }) => x.termId === `${PID}#rate`)).toMatchObject({ use: "usable", reviewedByName: "Radu Ionescu", review: "ok" });
    expect(p.terms.find((x: { termId: string }) => x.termId === `${PID}#fee`)).toMatchObject({ use: "unreviewed", reviewedByName: null });
    expect(await admin.query(anyApi.adminViews.product, { productId: "ing:credit" })).toBeNull();
  });

  it("names the people in the audit log and lists unreviewed values on the home page", async () => {
    const t = fresh(); await seed(t);
    const admin = t.withIdentity(identity("a", "admin"));
    expect(await admin.query(anyApi.adminViews.audit, {})).toEqual([
      { actorUserId: "user_admin", actorRole: "admin", action: "catalog.term_reviewed", details: { termId: `${PID}#rate` }, at: 5, actorName: "Radu Ionescu", targetName: null },
    ]);
    const home = await admin.query(anyApi.adminViews.home, {});
    expect(home.attention).toEqual([expect.objectContaining({ productId: PID, product: "Credit de nevoi personale", unreviewed: 1, stale: 0 })]);
    expect(home.escalations).toEqual({ open: 0, oldestAt: null });
    expect(home.recent[0]).toMatchObject({ action: "catalog.term_reviewed", actorName: "Radu Ionescu" });
  });

  it("rejects an out-of-range audit limit", async () => {
    await expect(fresh().withIdentity(identity("a", "admin")).query(anyApi.adminViews.audit, { limit: 0 })).rejects.toThrow("audit_limit_invalid");
  });
});

describe("admin views: rules", () => {
  it("lists hard limits and parameters for operators and admins only", async () => {
    const t = fresh();
    await expect(t.withIdentity(identity("m", "member")).query(anyApi.adminViews.rules, {})).rejects.toThrow("forbidden");
    const r = await t.withIdentity(identity("o", "operator")).query(anyApi.adminViews.rules, {});
    expect(r.hardLimits.length).toBeGreaterThan(0);
    expect(r.parameters.find((p: { id: string }) => p.id === "analytics-min")).toMatchObject({ value: 10, unit: "people" });
  });
});
