import { describe, expect, it } from "vitest";
import * as mirror from "./roles";
import * as source from "../../lib/auth/roles";

// The web copy must agree with the root module Convex uses, for every role, action and odd claim
describe("web roles mirror", () => {
  it("has the same roles and actions", () => {
    expect([...mirror.ROLES]).toEqual([...source.roleSchema.options]);
    expect([...mirror.ACTIONS]).toEqual([...source.actionSchema.options]);
  });

  it("parses claims the same way", () => {
    for (const claim of [undefined, null, "", "member", "operator", "admin", "Admin", " admin", "customer", 1, ["admin"]]) {
      expect(mirror.parseRole(claim)).toBe(source.parseRole(claim));
    }
  });

  it("grants the same permissions", () => {
    for (const role of mirror.ROLES) {
      for (const min of mirror.ROLES) expect(mirror.atLeast(role, min)).toBe(source.atLeast(role, min));
      for (const action of mirror.ACTIONS) expect(mirror.can(role, action)).toBe(source.can(role, action));
    }
  });
});
