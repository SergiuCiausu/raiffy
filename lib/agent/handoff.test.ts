import { describe, expect, it } from "vitest";
import { HANDOFF_PREVIEW_MESSAGES, handoffPreview, handoffReference } from "./handoff";

describe("adviser handoff", () => {
  it("shares only the customer's recent messages, screened and capped", () => {
    const messages = Array.from({ length: 9 }, (_, i) => `Message ${i + 1}`);
    expect(handoffPreview(messages)).toEqual(messages.slice(-HANDOFF_PREVIEW_MESSAGES));
    const [line] = handoffPreview(["My IBAN is RO49AAAA1B31007593840000, call me on 0722 123 456."]);
    expect(line).not.toContain("RO49AAAA1B31007593840000");
    expect(line).not.toContain("0722 123 456");
    const long = handoffPreview(["a".repeat(1000), "b".repeat(1000)]);
    expect(long.join("").length).toBeLessThanOrEqual(1500);
    expect(long.at(-1)).toBe("b".repeat(1000));
  });

  it("issues a short reference without ambiguous characters", () => {
    expect(handoffReference(() => 0)).toBe("RF-222222");
    expect(handoffReference(() => 0.999)).toMatch(/^RF-[2-9A-HJ-NP-Z]{6}$/);
  });
});
