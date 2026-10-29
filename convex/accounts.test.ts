import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import schema from "./schema";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./accounts.ts": () => import("./accounts"),
  "./audit.ts": () => import("./audit"),
};
const identity = (subject: string, role?: string) => ({ subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, ...(role ? { role } : {}) });

describe("What Raiffy can see", () => {
  it("starts with everything off and no sample account", async () => {
    const t = convexTest(schema, modules);
    const access = await t.withIdentity(identity("alice")).query(anyApi.accounts.getAccess, {});
    expect(access).toMatchObject({ persona: null, account: false, savings: false, cards: false });
    expect(access.personas.length).toBeGreaterThanOrEqual(4);
  });

  it("requires sign-in and a known sample account", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(anyApi.accounts.getAccess, {})).rejects.toThrow(/authentication_required/);
    await expect(t.mutation(anyApi.accounts.setAccess, { account: true })).rejects.toThrow(/authentication_required/);
    await expect(t.withIdentity(identity("alice")).mutation(anyApi.accounts.setAccess, { persona: "someone-else" })).rejects.toThrow(/unknown_persona/);
  });

  it("can't switch anything on without a sample account, and clearing it switches everything off", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity(identity("alice"));
    await alice.mutation(anyApi.accounts.setAccess, { account: true });
    expect(await alice.query(anyApi.accounts.getAccess, {})).toMatchObject({ persona: null, account: false });
    await alice.mutation(anyApi.accounts.setAccess, { persona: "new-client", account: true, cards: true });
    expect(await alice.query(anyApi.accounts.getAccess, {})).toMatchObject({ persona: "new-client", account: true, savings: false, cards: true });
    await alice.mutation(anyApi.accounts.setAccess, { persona: null });
    expect(await alice.query(anyApi.accounts.getAccess, {})).toMatchObject({ persona: null, account: false, cards: false });
  });

  it("keeps each customer's choice to themselves", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(identity("alice")).mutation(anyApi.accounts.setAccess, { persona: "long-time-client", account: true, cards: true });
    expect(await t.withIdentity(identity("bob")).query(anyApi.accounts.getAccess, {})).toMatchObject({ persona: null, account: false, cards: false });
    expect(await t.query(anyApi.accounts.accessFor, { ownerKey: "https://clerk.test|bob" })).toMatchObject({ persona: null, account: false });
    expect(await t.query(anyApi.accounts.accessFor, { ownerKey: "https://clerk.test|alice" })).toMatchObject({ persona: "long-time-client", account: true });
  });
});

describe("Sample customers for testers", () => {
  const signedIn = async (t: ReturnType<typeof convexTest>, subject: string) =>
    t.run((ctx) => ctx.db.insert("users", { clerkUserId: subject, tokenIdentifier: `https://clerk.test|${subject}`, role: "member", firstSeenAt: 1, lastSeenAt: 1 }));

  it("lets only admins assign one, audits it, and starts the tester with every switch off", async () => {
    const t = convexTest(schema, modules);
    await signedIn(t, "tess");
    const tess = t.withIdentity(identity("tess"));
    await tess.mutation(anyApi.accounts.setAccess, { persona: "new-client", account: true, loans: true });
    await expect(t.withIdentity(identity("op", "operator")).mutation(anyApi.accounts.assignSample, { targetUserId: "tess", persona: "fixed-rate-ending" })).rejects.toThrow(/forbidden/);
    const admin = t.withIdentity(identity("radu", "admin"));
    await expect(admin.mutation(anyApi.accounts.assignSample, { targetUserId: "tess", persona: "nobody" })).rejects.toThrow(/unknown_persona/);
    await expect(admin.mutation(anyApi.accounts.assignSample, { targetUserId: "ghost", persona: "fixed-rate-ending" })).rejects.toThrow(/user_never_signed_in/);

    await admin.mutation(anyApi.accounts.assignSample, { targetUserId: "tess", persona: "fixed-rate-ending", note: "Fixed-rate test" });
    expect(await tess.query(anyApi.accounts.getAccess, {})).toMatchObject({ persona: "fixed-rate-ending", assigned: "fixed-rate-ending", account: false, loans: false });
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log).toMatchObject([{ actorUserId: "radu", action: "user.sample_assigned", targetUserId: "tess", details: { from: "none", to: "fixed-rate-ending" }, note: "Fixed-rate test" }]);
    // Assigning the same one again changes and records nothing.
    await admin.mutation(anyApi.accounts.assignSample, { targetUserId: "tess", persona: "fixed-rate-ending" });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(1);

    const { users, personas } = await admin.query(anyApi.accounts.assignments, {});
    expect(users).toEqual([{ clerkUserId: "tess", assigned: "fixed-rate-ending", inUse: "fixed-rate-ending", assignedAt: expect.any(Number) }]);
    expect(personas).toHaveLength(10);
    await expect(tess.query(anyApi.accounts.assignments, {})).rejects.toThrow(/forbidden/);
  });

  it("resets the tester to the assigned customer with everything off", async () => {
    const t = convexTest(schema, modules);
    await signedIn(t, "tess");
    const tess = t.withIdentity(identity("tess"));
    await t.withIdentity(identity("radu", "admin")).mutation(anyApi.accounts.assignSample, { targetUserId: "tess", persona: "near-age-limit" });
    await tess.mutation(anyApi.accounts.setAccess, { persona: "small-loan", account: true, cards: true });
    await tess.mutation(anyApi.accounts.resetSample, {});
    expect(await tess.query(anyApi.accounts.getAccess, {})).toMatchObject({ persona: "near-age-limit", assigned: "near-age-limit", account: false, cards: false });
    // Without an assignment, a reset just clears the sample account.
    const bo = t.withIdentity(identity("bo"));
    await bo.mutation(anyApi.accounts.setAccess, { persona: "small-loan", account: true });
    await bo.mutation(anyApi.accounts.resetSample, {});
    expect(await bo.query(anyApi.accounts.getAccess, {})).toMatchObject({ persona: null, assigned: null, account: false });
  });
});
