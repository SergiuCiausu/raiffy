import { describe, expect, it } from "vitest";
import type { Role } from "./roles";
import { checkRoleChanges, countChanges, MAX_BATCH, userChangesSchema } from "./user-changes";

const team = (entries: [string, Role][]) => new Map(entries);

describe("saving the Users and roles table", () => {
  it("accepts role and sample customer edits, and refuses empty, unknown or oversized batches", () => {
    expect(userChangesSchema.safeParse({ changes: [{ userId: "u1", role: "operator" }, { userId: "u2", sample: null }], note: " Pilot " }).data?.note).toBe("Pilot");
    expect(userChangesSchema.safeParse({ changes: [] }).success).toBe(false);
    expect(userChangesSchema.safeParse({ changes: [{ userId: "u1" }] }).success).toBe(false);
    expect(userChangesSchema.safeParse({ changes: [{ userId: "u1", role: "owner" }] }).success).toBe(false);
    expect(userChangesSchema.safeParse({ changes: Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ userId: `u${i}`, sample: null })) }).success).toBe(false);
    expect(userChangesSchema.safeParse({ changes: [{ userId: "u1", role: "member" }], note: "x".repeat(501) }).success).toBe(false);
  });

  it("refuses your own role, users that no longer exist, and a batch that would leave no admin", () => {
    const current = team([["me", "admin"], ["elena", "admin"], ["ana", "member"]]);
    const refused = checkRoleChanges([
      { userId: "me", role: "member" }, { userId: "gone", role: "operator" }, { userId: "ana", sample: "small-loan" },
    ], current, "me");
    expect([...refused.keys()]).toEqual(["me", "gone"]);

    // Demoting the other admin is fine while you stay one; the batch counts promotions before demotions that follow.
    expect(checkRoleChanges([{ userId: "elena", role: "member" }], current, "me").size).toBe(0);
    const solo = team([["me", "operator"], ["elena", "admin"], ["ana", "member"]]);
    expect(checkRoleChanges([{ userId: "elena", role: "member" }], solo, "me").get("elena")).toMatch(/only admin/);
    expect(checkRoleChanges([{ userId: "ana", role: "admin" }, { userId: "elena", role: "member" }], solo, "me").size).toBe(0);
  });

  it("counts a row that changes both its role and sample customer as two changes", () => {
    expect(countChanges([{ userId: "a", role: "admin", sample: "new-client" }, { userId: "b", sample: null }])).toBe(3);
  });
});
