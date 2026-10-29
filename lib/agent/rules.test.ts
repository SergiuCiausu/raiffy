import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HARD_LIMITS, POLICY_PARAMETERS } from "./rules";

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap(ids)
  : value && typeof value === "object" ? [...("id" in value && typeof value.id === "string" ? [value.id] : []), ...Object.values(value).flatMap(ids)]
  : [];

describe("hard limits", () => {
  it("point at files that exist", () => {
    for (const h of HARD_LIMITS) for (const f of h.enforcedIn) expect(existsSync(f), `${h.id}: ${f}`).toBe(true);
  });

  it("cite only eval cases that exist", () => {
    for (const h of HARD_LIMITS) for (const ref of h.evals) {
      expect(existsSync(ref.file), `${h.id}: ${ref.file}`).toBe(true);
      const known = new Set(ids(JSON.parse(readFileSync(ref.file, "utf8"))));
      for (const id of ref.ids) expect(known.has(id), `${h.id}: ${id} in ${ref.file}`).toBe(true);
    }
  });

  it("have unique ids", () => {
    expect(new Set(HARD_LIMITS.map((h) => h.id)).size).toBe(HARD_LIMITS.length);
  });
});

describe("policy parameters", () => {
  it("point at the files that define them, with unique ids", () => {
    for (const p of POLICY_PARAMETERS) expect(existsSync(p.definedIn), `${p.id}: ${p.definedIn}`).toBe(true);
    expect(new Set(POLICY_PARAMETERS.map((p) => p.id)).size).toBe(POLICY_PARAMETERS.length);
  });
});
