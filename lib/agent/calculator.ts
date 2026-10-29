import { checkAffordability, type AffordabilityLimits } from "../calc/affordability";
import type { CalculatorResult } from "../rag/agent";
import { allowedValues, numericValues } from "../rag/numbers";
import type { CalculateScenarioInput } from "./prompt";

/** What the indicative check can't see, named in every result so the answer can say so. */
const NOT_CHECKED = ["credit history at the Biroul de Credit", "the bank's minimum income", "time with the current employer",
  "the product's actual rate and fees", "other loans the customer didn't mention"];

/**
 * The check_affordability handler: it runs only on figures the customer wrote (in this message or an earlier one),
 * so the model can't feed the calculator an assumed income or amount. The result echoes the inputs and the
 * limit's source, rounded the way the answer may quote them: whole lei and one decimal for percentages.
 */
export function runCalculator(input: CalculateScenarioInput, customerTexts: readonly string[], limits: AffordabilityLimits | null): CalculatorResult {
  if (!limits) return { status: "unavailable", reason: "the debt-service limits are not loaded, so no indicative check can run" };
  const allowed = allowedValues(customerTexts);
  const stated = (value: number) => numericValues(String(value)).some((v) => allowed.has(v));
  const { netMonthlyIncome, loanAmount, termMonths, existingMonthlyInstalments, currency, age } = input;
  const required = { netMonthlyIncome, loanAmount, ...(existingMonthlyInstalments ? { existingMonthlyInstalments } : {}), ...(age ? { age } : {}) };
  const unstated = Object.entries(required).filter(([, value]) => !stated(value)).map(([key, value]) => `${key} ${value}`);
  // A term may be stated in months or in whole years.
  if (!stated(termMonths) && !(termMonths % 12 === 0 && stated(termMonths / 12))) unstated.push(`termMonths ${termMonths}`);
  if (unstated.length) {
    return { status: "unavailable", reason: `the customer didn't state ${unstated.join(", ")}. Ask them for the missing figures instead of assuming them` };
  }

  const r = checkAffordability({ netMonthlyIncome, loanAmount, termMonths, existingMonthlyInstalments, currency, age }, limits);
  const lei = (n: number) => Math.round(n);
  const percent = (share: number) => Math.round(share * 1000) / 10;
  return { status: "ok", content: JSON.stringify({
    calculation: "loan_affordability", indicativeOnly: true, notACreditDecision: true,
    inputs: { netMonthlyIncome, loanAmount, termMonths, existingMonthlyInstalments: existingMonthlyInstalments ?? 0, currency: currency ?? "RON", ...(age ? { age } : {}) },
    limit: { maxDebtSharePercent: percent(r.maxDebtShare), maxConsumerTermMonths: limits.maxConsumerTermMonths,
      source: limits.source.label, validFrom: limits.source.validFrom, reviewStatus: limits.source.status },
    results: {
      maxNewMonthlyInstalment: lei(r.maxNewInstalment),
      instalmentWithNoInterest: lei(r.zeroRateInstalment),
      fitsEvenWithNoInterest: r.fitsAtZeroRate,
      fitsAtAnyAnnualRateUpToPercent: r.maxFittingAnnualRate === null ? null : percent(r.maxFittingAnnualRate),
      termWithinConsumerLimit: r.termWithinConsumerLimit,
      ...(r.ageAtEnd !== null ? { ageAtEndOfLoan: r.ageAtEnd } : {}),
    },
    notChecked: NOT_CHECKED,
  }) };
}
