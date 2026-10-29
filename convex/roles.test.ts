import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { anyApi } from "convex/server";
import type { JSONValue } from "convex/values";
import schema from "./schema";

const modules = {
  "./_generated/server.js": () => import("./_generated/server"),
  "./users.ts": () => import("./users"),
  "./audit.ts": () => import("./audit"),
};
const fresh = () => convexTest(schema, modules);
const identity = (subject: string, role?: JSONValue) => ({
  subject, issuer: "https://clerk.test", tokenIdentifier: `https://clerk.test|${subject}`, email: `${subject}@example.ro`,
  ...(role === undefined ? {} : { role }),
});
const change = { targetUserId: "bob", from: "member" as const, to: "operator" as const };

describe("roles from the JWT claim", () => {
  it("rejects anonymous callers", async () => {
    await expect(fresh().query(anyApi.users.me, {})).rejects.toThrow("authentication_required");
  });

  it.each([
    [undefined, "member"], ["member", "member"], ["operator", "operator"], ["admin", "admin"],
    ["Admin", "member"], ["customer", "member"], [["admin"], "member"],
  ])("claim %j reads as %s", async (claim, expected) => {
    const me = await fresh().withIdentity(identity("alice", claim)).query(anyApi.users.me, {});
    expect(me).toEqual({ clerkUserId: "alice", role: expected });
  });
});

describe("users.ensure", () => {
  it("creates the mirror row once and follows role changes", async () => {
    const t = fresh();
    await t.withIdentity(identity("alice")).mutation(anyApi.users.ensure, {});
    await t.withIdentity(identity("alice")).mutation(anyApi.users.ensure, {});
    expect(await t.withIdentity(identity("alice", "operator")).mutation(anyApi.users.ensure, {})).toEqual({ role: "operator" });
    const rows = await t.run((ctx) => ctx.db.query("users").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clerkUserId: "alice", role: "operator", email: "alice@example.ro" });
  });
});

describe("admin-only functions", () => {
  it.each(["member", "operator", undefined])("refuses %s callers", async (claim) => {
    const caller = fresh().withIdentity(identity("eve", claim));
    await expect(caller.query(anyApi.users.list, {})).rejects.toThrow("forbidden");
    await expect(caller.query(anyApi.audit.list, {})).rejects.toThrow("forbidden");
    await expect(caller.mutation(anyApi.users.recordRoleChange, change)).rejects.toThrow("forbidden");
  });

  it("lets an admin record a role change, updating the mirror and the audit log together", async () => {
    const t = fresh();
    await t.withIdentity(identity("bob")).mutation(anyApi.users.ensure, {});
    const admin = t.withIdentity(identity("ada", "admin"));
    await admin.mutation(anyApi.users.recordRoleChange, { ...change, note: "  Joins the review team  " });

    const users = await admin.query(anyApi.users.list, {});
    expect(users.find((u: { clerkUserId: string }) => u.clerkUserId === "bob")).toMatchObject({ role: "operator" });
    const log = await admin.query(anyApi.audit.list, { targetUserId: "bob" });
    expect(log).toEqual([expect.objectContaining({
      actorUserId: "ada", actorRole: "admin", action: "user.role_changed", targetUserId: "bob",
      details: { from: "member", to: "operator" }, note: "Joins the review team",
    })]);
  });

  it("rejects no-op changes and oversized notes", async () => {
    const admin = fresh().withIdentity(identity("ada", "admin"));
    await expect(admin.mutation(anyApi.users.recordRoleChange, { ...change, to: "member" })).rejects.toThrow("role_unchanged");
    await expect(admin.mutation(anyApi.users.recordRoleChange, { ...change, note: "x".repeat(501) })).rejects.toThrow("audit_note_too_long");
  });
});
