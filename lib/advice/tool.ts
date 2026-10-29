import { z } from "zod";
import { productRefsSchema } from "../calc/scenario";

/*
 * compare_routes: what the model sends, and how the customer's figures are resolved from it. The model points at
 * catalog records and says what the customer said about timing; it never supplies a rate, a fee or a result. A
 * figure the model sends counts only when it is one the customer gave; a defaulted input never counts, because a
 * recommendation on someone else's income or timing would be a guess.
 */

export const compareRoutesRequestSchema = z.object({
  loan: productRefsSchema,
  overdraft: productRefsSchema.optional(),
  /** The customer's own figures, in lei, only when they gave them. */
  amountLei: z.number().positive().max(100_000_000).optional(),
  months: z.number().int().min(1).max(600).optional(),
  incomeLei: z.number().positive().max(10_000_000).optional(),
  obligationsLei: z.number().min(0).max(10_000_000).optional(),
  monthlySavingLei: z.number().min(0).max(10_000_000).optional(),
  /** now: they need the money now. can_wait: they said they can wait (waitMonths when they said how long). */
  timing: z.enum(["now", "can_wait", "unknown"]),
  waitMonths: z.number().int().min(1).max(120).optional(),
}).strict();
export type CompareRoutesRequest = z.infer<typeof compareRoutesRequestSchema>;

type Stated = { value: number; source: "customer" | "default" };
/** needBy is months until the customer needs the money (0 for now), from their own words or a tapped choice. */
export type AdviceStated = Partial<Record<"amount" | "months" | "income" | "obligations" | "monthlySaving" | "needBy", Stated>>;

export type ResolvedAdvice = {
  /** Bani and months; null where the customer hasn't given the figure. */
  amount: number | null; months: number | null; income: number | null; obligations: number | null; monthlySaving: number | null;
  needByMonths: number | null;
};

export function resolveAdviceInputs(request: CompareRoutesRequest, stated: AdviceStated, isCustomerFigure: (n: number) => boolean): ResolvedAdvice {
  const own = (asked: number | undefined, input: Stated | undefined, zeroOk = false): number | null => {
    if (input?.source === "customer") return input.value;
    // "No other loans" is a zero the customer means, not a figure they typed
    if (asked !== undefined && ((zeroOk && asked === 0) || isCustomerFigure(asked))) return asked;
    return null;
  };
  const bani = (lei: number | null) => lei === null ? null : Math.round(lei * 100);
  const months = own(request.months, stated.months);
  const wait = request.waitMonths !== undefined && isCustomerFigure(request.waitMonths) ? request.waitMonths : null;
  return {
    amount: bani(own(request.amountLei, stated.amount)),
    months: months === null ? null : Math.round(months),
    income: bani(own(request.incomeLei, stated.income)),
    obligations: bani(own(request.obligationsLei, stated.obligations, true)),
    monthlySaving: bani(own(request.monthlySavingLei, stated.monthlySaving)),
    // What the customer stated wins; the model's reading of the conversation is only the fallback.
    needByMonths: stated.needBy?.source === "customer" ? stated.needBy.value
      : request.timing === "now" ? 0 : request.timing === "can_wait" ? wait : null,
  };
}
