import { describe, expect, it } from "vitest";
import cases from "../../evals/advice-answers.json";
import { checkAdviceAnswer } from "./check";
import { renovationComparison } from "./fixtures";

describe("renovation fixture", () => {
  it("recommends by timing: the chosen loan now, saving first after a year, a question when unknown", () => {
    expect(renovationComparison(0).recommendation.pick).toBe("loan_60");
    expect(renovationComparison(12).recommendation.pick).toBe("save_then_borrow");
    expect(renovationComparison(null).recommendation).toMatchObject({ status: "needs_input", needs: ["need_by"] });
    expect(renovationComparison(0).card).not.toBeNull();
  });
});

describe("checkAdviceAnswer", () => {
  const now = renovationComparison(0);
  it("flags an unconditional pick of another route, not the same route mentioned as a trade-off", () => {
    expect(checkAdviceAnswer("I'd go with the overdraft.", now.routes.routes, now.recommendation)).toEqual([]); // the overdraft isn't shown
    expect(checkAdviceAnswer("My pick is the 48-month loan.", now.routes.routes, now.recommendation)).toEqual(["other_route_recommended"]);
    expect(checkAdviceAnswer("If the payment fits, I'd go with 48 months.", now.routes.routes, now.recommendation)).toEqual([]);
  });
});

describe("evals/advice-answers.json", () => {
  for (const c of cases.answers) {
    it(`${c.id}: ${c.scenario}`, () => {
      const { routes, recommendation } = renovationComparison(c.needByMonths);
      expect(checkAdviceAnswer(c.text, routes.routes, recommendation)).toEqual(c.expect);
    });
  }
});
