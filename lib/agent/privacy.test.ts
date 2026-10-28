import { describe, expect, it } from "vitest";
import { screenChat } from "./privacy";

describe("provider-boundary screening", () => {
  it("removes contact, account, identity and credential values while preserving the inquiry", () => {
    const input = "My name is Alice Smith. Email alice@example.com, phone 0722 123 456, CNP 2990101123456, IBAN RO49AAAA1B31007593840000, card 4111 1111 1111 1111, PIN 1234. Explain term deposits.";
    const result = screenChat(input);
    expect(result.redacted).toBe(true);
    for (const value of ["Alice", "Smith", "alice@example.com", "0722", "2990101123456", "RO49", "4111", "1234"]) expect(result.text).not.toContain(value);
    expect(result.text).toContain("Explain term deposits");
  });
  it("keeps ordinary financial inputs and bounds messages", () => {
    expect(screenChat("I earn 5,000 lei and can save 500 each month.")).toEqual({ text: "I earn 5,000 lei and can save 500 each month.", redacted: false });
    expect(() => screenChat("x".repeat(4001))).toThrow();
  });
});
