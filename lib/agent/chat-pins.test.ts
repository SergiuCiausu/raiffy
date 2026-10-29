import { describe, expect, it } from "vitest";
import { pinInputSchema, pinnableKinds, threadTitleSchema } from "./chat-pins";

describe("chat names and pins", () => {
  it("keeps a chat name to one trimmed line of 1–80 characters", () => {
    expect(threadTitleSchema.parse("  Car loan\n plan  ")).toBe("Car loan plan");
    expect(threadTitleSchema.safeParse("   ").success).toBe(false);
    expect(threadTitleSchema.safeParse("x".repeat(81)).success).toBe(false);
  });

  it("accepts only known card kinds with short labels", () => {
    expect(pinInputSchema.parse({ kind: "simulation", title: " Repayment simulation ", meta: "Credit de nevoi personale" }))
      .toEqual({ kind: "simulation", title: "Repayment simulation", meta: "Credit de nevoi personale" });
    expect(pinInputSchema.safeParse({ kind: "memory", title: "x", meta: "y" }).success).toBe(false);
    expect(pinInputSchema.safeParse({ kind: "offer", title: "x", meta: "" }).success).toBe(false);
  });

  it("finds the cards an answer can pin, skipping text-derived routes and non-cards", () => {
    expect(pinnableKinds([{ type: "callout" }, { type: "routes", state: "partial" }, { type: "routes", title: "Ways to pay" }, { type: "simulation", title: "S" }, null]))
      .toEqual(["routes", "simulation"]);
  });
});
