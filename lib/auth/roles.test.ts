import { describe, expect, it } from "vitest";
import { actionSchema, atLeast, can, canApproveAt, changeOutcome, parseRole, roleSchema, type Action, type Role } from "./roles";

describe("parseRole", () => {
  it("accepts the three roles exactly", () => {
    for (const role of roleSchema.options) expect(parseRole(role)).toBe(role);
  });

  it("falls back to member for missing or unexpected claims", () => {
    for (const value of [undefined, null, "", "Admin", " admin", "superadmin", "customer", 2, ["admin"], { role: "admin" }]) {
      expect(parseRole(value)).toBe("member");
    }
  });
});

describe("atLeast", () => {
  it("orders member < operator < admin", () => {
    expect(atLeast("admin", "operator")).toBe(true);
    expect(atLeast("operator", "operator")).toBe(true);
    expect(atLeast("operator", "admin")).toBe(false);
    expect(atLeast("member", "operator")).toBe(false);
  });
});

describe("can", () => {
  // The console.md table, row by row
  const table: Record<Action, Record<Role, boolean>> = {
    "chat.use": { member: true, operator: true, admin: true },
    "hardLimits.read": { member: false, operator: true, admin: true },
    "catalog.read": { member: false, operator: true, admin: true },
    "review.answer": { member: false, operator: true, admin: true },
    "change.propose": { member: false, operator: true, admin: true },
    "change.publish": { member: false, operator: false, admin: true },
    "change.approve": { member: false, operator: false, admin: true },
    "eval.decide": { member: false, operator: false, admin: true },
    "counterOffer.decide": { member: false, operator: true, admin: true },
    "users.manage": { member: false, operator: false, admin: true },
    "audit.read": { member: false, operator: false, admin: true },
  };

  it("covers every action", () => {
    expect(Object.keys(table).sort()).toEqual([...actionSchema.options].sort());
  });

  it.each(Object.entries(table))("%s", (action, expected) => {
    for (const role of roleSchema.options) expect(can(role, action as Action)).toBe(expected[role]);
  });
});

describe("changeOutcome", () => {
  it("sends an operator's change to approval and publishes an admin's directly", () => {
    expect(changeOutcome("operator")).toBe("pending_approval");
    expect(changeOutcome("admin")).toBe("published");
  });

  it("gives members no way to propose", () => {
    expect(changeOutcome("member")).toBeNull();
  });
});

describe("canApproveAt", () => {
  it("lets operators decide at the specialist level only", () => {
    expect(canApproveAt("operator", "specialist")).toBe(true);
    expect(canApproveAt("operator", "branchManager")).toBe(false);
    expect(canApproveAt("operator", "pricingCommittee")).toBe(false);
  });

  it("lets admins decide at any level and members at none", () => {
    expect(canApproveAt("admin", "pricingCommittee")).toBe(true);
    expect(canApproveAt("member", "specialist")).toBe(false);
  });
});
