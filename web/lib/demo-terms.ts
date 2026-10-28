import type { LoanTerms, OverdraftTerms } from "./finance";

/*
 * Illustrative product terms used by the design prototypes, as of 28 Oct 2026.
 * Not real Raiffeisen offers. In the product these come from the Convex catalog tables, with their date and source.
 */

export const TERMS_AS_OF = "2026-10-28";

/** Landing-page simulator (raiffy.html). */
export const LANDING_LOAN: LoanTerms = { annualRate: 0.079, oneOffFee: 249 };
export const LANDING_OVERDRAFT: OverdraftTerms = { annualRate: 0.115, limit: 15000 };
export const EARLY_REPAYMENT_FEE_RATE = 0.005;

/** Chat answers (chat.html). The loan rate depends on whether Raiffy may read the pre-approved offer. */
export const OFFER_LOAN_RATE = 0.079;
export const PUBLIC_LOAN_RATE = 0.094;
export const CHAT_LOAN_FEE = 249;
export const CHAT_OVERDRAFT: OverdraftTerms = { annualRate: 0.115, limit: 15000, maxTermMonths: 12, flatFee: 9 };
