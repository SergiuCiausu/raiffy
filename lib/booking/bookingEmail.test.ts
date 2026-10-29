import { describe, expect, it } from "vitest";
import { bookingEmail, whenText } from "./bookingEmail";
import { toInstant } from "./rules";

const call = { reference: "BK-482913", start: "2026-11-02T14:00", timeZone: "Europe/Bucharest", minutes: 30, channel: "video" as const, appUrl: "https://raiffy.example" };

describe("booking e-mails", () => {
  it("names the specialist's time and zone", () => {
    expect(whenText("2026-11-02T14:00", "Europe/Bucharest")).toBe("Monday 2 November, 14:00 (Romania time)");
  });

  it("tells the customer when, how, and by when to confirm, and links to their calls", () => {
    const mail = bookingEmail({ to: "customer", ...call, operatorName: "Ana M.", confirmBy: toInstant("2026-11-01T14:00", "Europe/Bucharest") });
    expect(mail.subject).toBe("Your call with Ana M. is booked");
    expect(mail.text).toContain("30-minute video call with Ana M., a Raiffeisen specialist, on Monday 2 November, 14:00 (Romania time)");
    expect(mail.text).toContain("Confirm it in Raiffy by Sunday 1 November at 14:00");
    expect(mail.text).toContain("Your calls: https://raiffy.example/chat/calls");
    expect(mail.text).toContain("Reference: BK-482913");
    expect(bookingEmail({ to: "customer", ...call, channel: "phone", operatorName: "Ana M.", confirmBy: null }).text).toMatch(/It’s confirmed\.\nThe specialist will phone you/);
  });

  it("tells the specialist who booked, without the topic, and links to the console", () => {
    const mail = bookingEmail({ to: "operator", ...call, customerName: "Maria P.", customerRef: "C-7F3A" });
    expect(mail.subject).toBe("New call booked: Monday 2 November, 14:00 (Romania time)");
    expect(mail.text).toContain("Maria P. (C-7F3A) booked a 30-minute video call with you");
    expect(mail.text).toContain("Your calendar: https://raiffy.example/console");
  });

  it("escapes names in the HTML and refuses a malformed reference", () => {
    expect(bookingEmail({ to: "operator", ...call, customerName: "<b>x</b>", customerRef: "C-1" }).html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(() => bookingEmail({ to: "customer", ...call, reference: "BK-1", operatorName: "Ana M.", confirmBy: null })).toThrow();
  });
});
