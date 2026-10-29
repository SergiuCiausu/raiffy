import { describe, expect, it } from "vitest";
import { traceFields } from "./trace";

const base = { inquiry: "purchase_goal", handler: "answer", status: "answered" as const, attempts: 1, tools: [] };

describe("traceFields", () => {
  it("maps inquiries to intents, and anything else to other", () => {
    expect(traceFields(base).intent).toBe("newLoan");
    expect(traceFields({ ...base, inquiry: "debt_refinancing" }).intent).toBe("refinancing");
    expect(traceFields({ ...base, inquiry: "listing" }).intent).toBe("other");
    expect(traceFields({ ...base, inquiry: null }).intent).toBe("other");
  });

  it("records the account data the tools read, once each", () => {
    const t = traceFields({ ...base, tools: [{ name: "get_holdings", kinds: ["loans", "cards"] }, { name: "get_expense_summary" }, { name: "get_holdings", kinds: ["loans"] }] });
    expect(t.dataUsed).toEqual(["limits", "loans", "transactions"]);
  });

  it("reads every holding kind when get_holdings asked for none", () => {
    expect(traceFields({ ...base, tools: [{ name: "get_holdings" }] }).dataUsed)
      .toEqual(["ageResidency", "deposits", "idStatus", "limits", "loans", "preApproved", "productsHeld"]);
  });

  it("ignores tools that read no account data", () => {
    expect(traceFields({ ...base, tools: [{ name: "query_catalog" }, { name: "calculate_scenario" }] }).dataUsed).toEqual([]);
  });

  it("counts retries, fallbacks and escalations", () => {
    expect(traceFields({ ...base, attempts: 2 }).evaluatorLoops).toBe(1);
    expect(traceFields({ ...base, status: "failed_checks" }).fallback).toBe(true);
    expect(traceFields({ ...base, handler: "unavailable", status: "answered" }).fallback).toBe(true);
    expect(traceFields({ ...base, handler: "clarify", status: "answered" }).fallback).toBe(false);
    expect(traceFields({ ...base, handler: "human_contact" }).escalated).toBe(true);
  });
});
