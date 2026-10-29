import { withHoldings } from "../../lib/bank/persona";
import type { Persona } from "../../lib/expenses/schemas";

/*
 * SAMPLE DATA. Synthetic customers for the demo (raiffy-spec/docs/shared/pricing.md → Mock data, the demo figures
 * of the "From Raiffy" cards, and docs/shared/smart-mobile.md for the holdings). None of this is a real account, and
 * the UI labels it as sample data. Money in bani, rates in basis points, dates relative to today.
 *
 * Each customer's holdings are what Smart Mobile would show: real Raiffeisen products from the catalog, with this
 * customer's own (made-up) amounts and contract terms. Balances, the overdraft and Raiffeisen loan payments come
 * from the holdings (lib/bank/persona.ts), so the statements and get_holdings agree; `loans` below lists only debts
 * at other banks and card repayments. One customer per scenario: see the `summary` of each.
 */

const P = (slug: string) => `raiffeisen:persoane-fizice__produsele-noastre__${slug}`;
const PRODUCT = {
  asist: P("conturi-si-pachete-de-cont-curent__pachetul-de-cont-curent-asist"),
  zero: P("conturi-si-pachete-de-cont-curent__pachetul-de-cont-curent-zero-simplu"),
  savings: P("economii__cont-de-economii"),
  deposit: P("economii__depozite-la-termen"),
  overdraft: P("credite__overdraft"),
  casaTa: P("credite__credit-imobiliar-casa-ta"),
  personal: P("credite__credit-de-nevoi-personale-fara-ipoteca"),
  ccStandard: P("carduri__cardul-de-cumparaturi-standard"),
  ccPlatinum: P("carduri__cardul-de-cumparaturi-platinum"),
};
const account = (ref: string, mask: string, balance: number, zero = false) =>
  ({ ref, productId: zero ? PRODUCT.zero : PRODUCT.asist, name: zero ? "Zero Simplu current account" : "Asist current account", ibanMask: `••${mask}`, balance });
const debit = (ref: string, mask: string, usesLastYear: number, zero = false) =>
  ({ ref, productId: zero ? PRODUCT.zero : PRODUCT.asist, name: "Visa debit card", type: "debit" as const, mask: `•••• ${mask}`, usesLastYear });
const savingsAccount = (ref: string, balance: number) => ({ ref, productId: PRODUCT.savings, name: "Savings account", balance, rateBps: 150 });
const none = { savingsAccounts: [], deposits: [], loans: [], offers: [] };

const subscriptions: Persona["recurring"] = [
  { key: "streaming", label: "Streaming service", category: "subscriptions", amount: 5_900, day: 12, kind: "card_payment", priceChange: { monthsAgo: 1, from: 4_900 } },
  { key: "music", label: "Music app", category: "subscriptions", amount: 2_500, day: 3, kind: "card_payment" },
  { key: "cloud", label: "Cloud storage", category: "subscriptions", amount: 1_000, day: 7, kind: "card_payment" },
  { key: "gym", label: "Gym membership", category: "subscriptions", amount: 6_900, day: 1, kind: "card_payment" },
  { key: "news", label: "News site", category: "subscriptions", amount: 1_900, day: 20, kind: "card_payment" },
  { key: "phone-app", label: "App subscription", category: "subscriptions", amount: 1_400, day: 25, kind: "card_payment", startedMonthsAgo: 1 },
];

export const DEMO_PERSONAS: readonly Persona[] = [
  withHoldings({
    id: "long-time-client", label: "Long-time client", summary: "Salary at Raiffeisen, savings, a credit card hardly used whose annual fee is due soon, spends some time abroad",
    monthlyIncome: 950_000,
    loans: [],
    recurring: [{ key: "rent", label: "Rent", category: "housing", amount: 250_000, day: 2, kind: "standing_order" },
      { key: "utilities", label: "Utilities", category: "utilities", amount: 42_000, day: 18, kind: "standing_order" }, ...subscriptions],
    monthlySpending: { groceries: 160_000, dining: 60_000, transport: 45_000, shopping: 70_000, health: 15_000, entertainment: 25_000 },
    atm: { ownPerMonth: 1, otherPerMonth: 3, amount: 20_000, otherFee: 500 },
    foreignSpending: [{ monthsAgo: 1, amount: 124_000, fxFeeBps: 250, payments: 6 }],
    relationship: { salaryDomiciled: true, riskBand: "A", products: ["card", "account-package"] },
    request: { productId: "raiffy-personal-loan", amount: 800_000, months: 12 },
  }, {
    ...none,
    currentAccounts: [account("acc_ltc1", "4821", 1_850_000)],
    savingsAccounts: [savingsAccount("sav_ltc1", 2_000_000)],
    cards: [debit("card_ltc1", "4821", 210),
      { ref: "card_ltc2", productId: PRODUCT.ccPlatinum, name: "Platinum credit card", type: "credit", mask: "•••• 7310", limit: 1_500_000, used: 0, annualFee: 15_000, annualFeeDueInDays: 18, usesLastYear: 2 }],
    profile: { age: 41, residency: "RO", idVerified: true },
  }),
  withHoldings({
    id: "new-client", label: "New client", summary: "Salary at another bank, no savings, has used most of the overdraft for months",
    monthlyIncome: 620_000,
    loans: [],
    recurring: [{ key: "rent", label: "Rent", category: "housing", amount: 220_000, day: 2, kind: "standing_order" },
      { key: "utilities", label: "Utilities", category: "utilities", amount: 35_000, day: 18, kind: "standing_order" }],
    monthlySpending: { groceries: 140_000, dining: 40_000, transport: 50_000, shopping: 45_000 },
    atm: { ownPerMonth: 0, otherPerMonth: 1, amount: 20_000, otherFee: 500 },
    foreignSpending: [],
    relationship: { salaryDomiciled: false, riskBand: "B", products: [] },
    request: { productId: "raiffy-personal-loan", amount: 800_000, months: 12 },
  }, {
    ...none,
    currentAccounts: [{ ...account("acc_new1", "1907", 40_000, true),
      overdraft: { limit: 1_000_000, used: 800_000, rateBps: 1_150, renewsInDays: 287 } }],
    cards: [debit("card_new1", "1907", 95, true)],
    profile: { age: 29, residency: "RO", idVerified: true },
  }),
  withHoldings({
    id: "competitor-secci", label: "Client with a competitor offer", summary: "Steady salary, a car loan at another bank, a pre-approved personal loan from Raiffeisen",
    monthlyIncome: 800_000,
    loans: [{ label: "Car loan (other bank)", monthly: 120_000 }],
    recurring: [{ key: "rent", label: "Rent", category: "housing", amount: 230_000, day: 2, kind: "standing_order" }],
    monthlySpending: { groceries: 150_000, dining: 50_000, transport: 60_000, shopping: 50_000 },
    atm: { ownPerMonth: 2, otherPerMonth: 0, amount: 20_000, otherFee: 500 },
    foreignSpending: [],
    relationship: { salaryDomiciled: true, riskBand: "A", products: ["card"] },
    request: { productId: "raiffy-personal-loan", amount: 800_000, months: 12 },
  }, {
    ...none,
    currentAccounts: [account("acc_cs1", "3388", 600_000)],
    savingsAccounts: [savingsAccount("sav_cs1", 500_000)],
    cards: [debit("card_cs1", "3388", 160)],
    offers: [{ ref: "offer_cs1", productId: PRODUCT.personal, name: "personal loan", maxAmount: 3_000_000, rateBps: 790, fee: 24_900, minMonths: 6, maxMonths: 60, validForDays: 32 }],
    profile: { age: 35, residency: "RO", idVerified: true },
  }),
  withHoldings({
    id: "cheaper-competitor", label: "Client with a cheaper competitor", summary: "Good salary, no debts, a term deposit maturing within a week, money left at the end of most months",
    monthlyIncome: 1_100_000,
    loans: [],
    recurring: [{ key: "mortgage-rent", label: "Rent", category: "housing", amount: 300_000, day: 2, kind: "standing_order" }],
    monthlySpending: { groceries: 180_000, dining: 90_000, transport: 50_000, shopping: 100_000, travel: 60_000 },
    atm: { ownPerMonth: 2, otherPerMonth: 0, amount: 30_000, otherFee: 500 },
    foreignSpending: [],
    relationship: { salaryDomiciled: true, riskBand: "A", products: ["card"] },
    request: { productId: "raiffy-personal-loan", amount: 800_000, months: 12 },
  }, {
    ...none,
    currentAccounts: [account("acc_cc1", "5520", 2_400_000)],
    savingsAccounts: [savingsAccount("sav_cc1", 300_000)],
    deposits: [{ ref: "dep_cc1", productId: PRODUCT.deposit, name: "6-month term deposit", amount: 1_000_000, currency: "RON", rateBps: 500, termMonths: 6, maturesInDays: 6, renewal: "none" }],
    cards: [debit("card_cc1", "5520", 240)],
    profile: { age: 38, residency: "RO", idVerified: true },
  }),
  withHoldings({
    id: "mortgage-refinance", label: "Refinancing a mortgage", summary: "Mortgage at another bank, salary at Raiffeisen, family budget",
    monthlyIncome: 1_400_000,
    loans: [{ label: "Mortgage (other bank)", monthly: 380_000, replacedBy: "raiffy-mortgage" }],
    recurring: [{ key: "utilities", label: "Utilities", category: "utilities", amount: 65_000, day: 18, kind: "standing_order" }],
    monthlySpending: { groceries: 280_000, dining: 50_000, transport: 90_000, shopping: 90_000, health: 30_000 },
    atm: { ownPerMonth: 2, otherPerMonth: 0, amount: 30_000, otherFee: 500 },
    foreignSpending: [],
    relationship: { salaryDomiciled: true, riskBand: "A", products: ["card"] },
    request: { productId: "raiffy-mortgage", amount: 40_000_000, months: 240 },
  }, {
    ...none,
    currentAccounts: [account("acc_mr1", "6104", 700_000)],
    savingsAccounts: [savingsAccount("sav_mr1", 1_500_000)],
    cards: [debit("card_mr1", "6104", 300)],
    profile: { age: 44, residency: "RO", idVerified: true },
  }),
  withHoldings({
    id: "small-loan", label: "Small loan", summary: "Modest income, tight months, most of a credit card's limit in use",
    monthlyIncome: 420_000,
    loans: [{ label: "Credit card repayment", monthly: 40_000 }],
    recurring: [{ key: "rent", label: "Rent", category: "housing", amount: 180_000, day: 2, kind: "standing_order" }],
    monthlySpending: { groceries: 110_000, transport: 30_000, shopping: 20_000 },
    atm: { ownPerMonth: 0, otherPerMonth: 2, amount: 10_000, otherFee: 500 },
    foreignSpending: [],
    relationship: { salaryDomiciled: false, riskBand: "C", products: ["card"] },
    request: { productId: "raiffy-personal-loan", amount: 300_000, months: 12 },
  }, {
    ...none,
    currentAccounts: [account("acc_sl1", "2275", 15_000, true)],
    cards: [debit("card_sl1", "2275", 120, true),
      { ref: "card_sl2", productId: PRODUCT.ccStandard, name: "Standard credit card", type: "credit", mask: "•••• 9042", limit: 300_000, used: 260_000, annualFee: 0, usesLastYear: 64 }],
    profile: { age: 26, residency: "RO", idVerified: true },
  }),
  withHoldings({
    id: "fixed-rate-ending", label: "Fixed rate ending soon", summary: "A Casa Ta mortgage whose fixed rate ends in three months, salary at Raiffeisen",
    monthlyIncome: 1_200_000,
    loans: [],
    recurring: [{ key: "utilities", label: "Utilities", category: "utilities", amount: 58_000, day: 18, kind: "standing_order" }],
    monthlySpending: { groceries: 220_000, dining: 40_000, transport: 70_000, shopping: 60_000, health: 20_000 },
    atm: { ownPerMonth: 1, otherPerMonth: 0, amount: 30_000, otherFee: 500 },
    foreignSpending: [],
    relationship: { salaryDomiciled: true, riskBand: "A", products: ["card", "mortgage"] },
  }, {
    ...none,
    currentAccounts: [account("acc_fr1", "7731", 900_000)],
    savingsAccounts: [savingsAccount("sav_fr1", 800_000)],
    loans: [{ ref: "loan_fr1", productId: PRODUCT.casaTa, name: "Casa Ta mortgage", kind: "mortgage", principal: 40_000_000, outstanding: 31_000_000, monthly: 245_000,
      rate: { type: "fixed_then_variable", rateBps: 549, fixedMonthsLeft: 3, afterFixed: "IRCC plus a 2.49-point margin, reviewed every quarter" },
      startedMonthsAgo: 33, termMonths: 300, paymentDay: 15, earlyRepaymentFeeBps: 100 }],
    cards: [debit("card_fr1", "7731", 280)],
    profile: { age: 39, residency: "RO", idVerified: true },
  }),
  withHoldings({
    id: "early-repayment", label: "Repaying a loan early", summary: "A personal loan half paid off and savings that could clear it",
    monthlyIncome: 850_000,
    loans: [],
    recurring: [{ key: "rent", label: "Rent", category: "housing", amount: 210_000, day: 2, kind: "standing_order" },
      { key: "utilities", label: "Utilities", category: "utilities", amount: 30_000, day: 18, kind: "standing_order" }],
    monthlySpending: { groceries: 140_000, dining: 50_000, transport: 40_000, shopping: 40_000 },
    atm: { ownPerMonth: 1, otherPerMonth: 1, amount: 20_000, otherFee: 500 },
    foreignSpending: [],
    relationship: { salaryDomiciled: true, riskBand: "A", products: ["card", "personal-loan"] },
  }, {
    ...none,
    currentAccounts: [account("acc_er1", "8816", 500_000)],
    savingsAccounts: [savingsAccount("sav_er1", 2_500_000)],
    loans: [{ ref: "loan_er1", productId: PRODUCT.personal, name: "personal loan", kind: "personal_loan", principal: 4_000_000, outstanding: 1_850_000, monthly: 92_000,
      rate: { type: "fixed", rateBps: 890 }, startedMonthsAgo: 26, termMonths: 48, paymentDay: 5, earlyRepaymentFeeBps: 100 }],
    cards: [debit("card_er1", "8816", 190)],
    profile: { age: 33, residency: "RO", idVerified: true },
  }),
  withHoldings({
    id: "near-age-limit", label: "Close to the age limit", summary: "63, comfortable savings and a deposit, asking about a long mortgage",
    monthlyIncome: 700_000,
    loans: [],
    recurring: [{ key: "utilities", label: "Utilities", category: "utilities", amount: 45_000, day: 18, kind: "standing_order" }],
    monthlySpending: { groceries: 150_000, health: 60_000, transport: 30_000, shopping: 30_000 },
    atm: { ownPerMonth: 2, otherPerMonth: 0, amount: 30_000, otherFee: 500 },
    foreignSpending: [],
    relationship: { salaryDomiciled: true, riskBand: "A", products: ["card", "deposit"] },
    request: { productId: "raiffy-mortgage", amount: 30_000_000, months: 300 },
  }, {
    ...none,
    currentAccounts: [account("acc_na1", "4410", 1_200_000)],
    deposits: [{ ref: "dep_na1", productId: PRODUCT.deposit, name: "12-month term deposit", amount: 5_000_000, currency: "RON", rateBps: 450, termMonths: 12, maturesInDays: 140, renewal: "automatic" }],
    cards: [debit("card_na1", "4410", 150)],
    profile: { age: 63, residency: "RO", idVerified: true },
  }),
  withHoldings({
    id: "not-verified", label: "Not verified for digital signing", summary: "Moved from Italy last year, salary at Raiffeisen, identity not yet verified for signing in the app",
    monthlyIncome: 650_000,
    loans: [],
    recurring: [{ key: "rent", label: "Rent", category: "housing", amount: 240_000, day: 2, kind: "standing_order" }],
    monthlySpending: { groceries: 130_000, dining: 60_000, transport: 35_000, shopping: 40_000 },
    atm: { ownPerMonth: 1, otherPerMonth: 1, amount: 20_000, otherFee: 500 },
    foreignSpending: [{ monthsAgo: 2, amount: 90_000, fxFeeBps: 250, payments: 4 }],
    relationship: { salaryDomiciled: true, riskBand: "B", products: [] },
    request: { productId: "raiffy-personal-loan", amount: 1_500_000, months: 36 },
  }, {
    ...none,
    currentAccounts: [account("acc_nv1", "6052", 300_000, true)],
    cards: [debit("card_nv1", "6052", 70, true)],
    profile: { age: 31, residency: "EU", idVerified: false },
  }),
];

export const personaById = (id: string | null | undefined) => DEMO_PERSONAS.find((p) => p.id === id) ?? null;
