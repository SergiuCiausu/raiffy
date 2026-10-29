import { describe, expect, it } from "vitest";
import { availabilityError, DEFAULT_AVAILABILITY as AV, gridRange, localAt, outsideHours, weekday } from "./calendar";
import type { AgendaItem } from "./booking-api";
import { DEFAULT_HOURS } from "../../lib/booking/schemas";

const call = (start: string, minutes = 30) => ({ start, minutes }) as AgendaItem;

describe("calendar arithmetic", () => {
  it("starts from the same default hours the chat offers customers", () => {
    expect(AV).toEqual(DEFAULT_HOURS);
  });


  it("reads weekdays and wall-clock time in the operator's zone", () => {
    expect(weekday("2026-10-26")).toBe("1");
    // 08:00 in Bucharest is 06:00 UTC in late October (EET, UTC+2)
    expect(localAt(Date.UTC(2026, 9, 29, 6, 0), "Europe/Bucharest")).toBe("2026-10-29T08:00");
  });

  it("sizes the grid to the hours and to calls outside them, in whole hours", () => {
    const week = ["2026-10-26", "2026-10-27"];
    expect(gridRange(week, AV, [])).toEqual({ first: 540, last: 1020 });
    expect(gridRange(week, AV, [call("2026-10-27T17:30", 60)])).toEqual({ first: 540, last: 1140 });
    expect(gridRange(week, null, [])).toEqual({ first: 540, last: 1020 });
  });

  it("finds booked calls new hours no longer cover", () => {
    expect(outsideHours(AV, call("2026-10-26T10:00"))).toBe(false);
    expect(outsideHours(AV, call("2026-10-26T12:30"))).toBe(true); // the break
    expect(outsideHours(AV, call("2026-10-26T16:45"))).toBe(true); // runs past 17:00
    expect(outsideHours(AV, call("2026-10-31T10:00"))).toBe(true); // Saturday
    expect(outsideHours({ ...AV, daysOff: [{ date: "2026-10-26", reason: "Training" }] }, call("2026-10-26T10:00"))).toBe(true);
  });

  it("explains hours that can't be saved", () => {
    expect(availabilityError(AV)).toBeNull();
    expect(availabilityError({ ...AV, weekly: { ...AV.weekly, 2: ["17:00", "09:00"] } })).toBe("Tue: the end has to be after the start.");
    expect(availabilityError({ ...AV, breaks: [["13:00", "12:00"]] })).toBe("The break has to end after it starts.");
    expect(availabilityError({ ...AV, dailyCap: 0 })).toMatch(/between 1 and 16/);
  });
});
