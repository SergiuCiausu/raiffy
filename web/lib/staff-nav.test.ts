import { describe, expect, it } from "vitest";
import { ADMIN_NAV, CHAT_HREF, CONSOLE_NAV, staysInArea } from "./staff-nav";

describe("staff navigation stays in its area", () => {
  for (const area of [ADMIN_NAV, CONSOLE_NAV]) {
    it(`${area.root} links only to ${area.root}/* and the chat`, () => {
      for (const l of area.work) expect(staysInArea(area, l.href), l.href).toBe(true);
    });
  }
  it("rejects cross-area links", () => {
    expect(staysInArea(ADMIN_NAV, "/console/reviews")).toBe(false);
    expect(staysInArea(CONSOLE_NAV, "/admin/users")).toBe(false);
    expect(staysInArea(CONSOLE_NAV, "/consoles")).toBe(false);
    expect(staysInArea(ADMIN_NAV, CHAT_HREF)).toBe(true);
  });
});
