import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_AUTH, safeRedirect } from "./redirect";

const origin = "http://localhost:3000";

describe("safeRedirect", () => {
  it("keeps same-origin destinations, absolute or relative, with their query and hash", () => {
    expect(safeRedirect("http://localhost:3000/admin/users", origin)).toBe("/admin/users");
    expect(safeRedirect("/admin/users?tab=audit#log", origin)).toBe("/admin/users?tab=audit#log");
  });

  it("falls back to the chat when nothing is asked for", () => {
    for (const raw of [null, undefined, ""]) expect(safeRedirect(raw, origin)).toBe(DEFAULT_AFTER_AUTH);
  });

  it("refuses other origins and tricks that leave the site", () => {
    for (const raw of ["https://evil.example/admin", "//evil.example/x", "/\\evil.example", "http://localhost:3001/x", "javascript:alert(1)", "https://localhost:3000/x"]) {
      expect(safeRedirect(raw, origin)).toBe(DEFAULT_AFTER_AUTH);
    }
  });

  it("never sends people back to an auth page", () => {
    for (const raw of ["/sign-in", "/sign-up?x=1", "/sso-callback", "/verify-email"]) expect(safeRedirect(raw, origin)).toBe(DEFAULT_AFTER_AUTH);
  });
});
