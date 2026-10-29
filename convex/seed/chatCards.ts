import type { Cite } from "./chatScripts";

/*
 * The answer cards of the seeded chats (chatScripts.ts), keyed "chat-id#turn". They have the show_cards shape Claude
 * fills (lib/agent/blocks.ts), with a citation in place of each source URL; chatBuild.ts resolves the citations and runs
 * the same checkCards as a live answer, so a figure must be in the passage or holding it cites, or the customer's own
 * words. Each card cites only what its answer cites. The kind follows the pattern's card contract
 * (lib/agent/cardContract.ts).
 *
 * TEXT_ONLY lists the answers that have no card, and why: a one-line follow-up, a pleasantry, or a question back.
 */

type Fact = { label: string; value: string; source?: Cite };
type Rec = { option: string; reasons: string[]; whenOther: string };
export type SeedCard =
  | { type: "keyFacts"; title: string; facts: Fact[] }
  | { type: "checklist"; title: string; items: { text: string; detail?: string; source?: Cite }[] }
  | { type: "comparison"; title: string; options: { name: string; provider?: string; isRaiffeisen: boolean; facts: Fact[] }[]; recommendation?: Rec }
  | { type: "routes"; title: string; routes: { name: string; summary: string; fit: string; facts: Fact[] }[]; recommendation: Rec }
  | { type: "simulation"; title: string; product: string; ratePercent: number; rateMaxPercent?: number; source: Cite; amount?: number; months?: number }
  | { type: "handoff"; title: string; reason: string };

const f = (label: string, value: string, source?: Cite): Fact => ({ label, value, ...(source ? { source } : {}) });
const facts = (title: string, ...list: Fact[]): SeedCard => ({ type: "keyFacts", title, facts: list });
const rz = (name: string, ...list: Fact[]) => ({ name, isRaiffeisen: true, facts: list });
const other = (name: string, provider: string, ...list: Fact[]) => ({ name, provider, isRaiffeisen: false, facts: list });

const repayRoutes: SeedCard = {
  type: "routes", title: "Repay early or keep paying",
  routes: [
    { name: "Repay all of it", summary: "Clear the loan from your savings.", fit: "Fits if your income is very steady.", facts: [f("Your savings", "25,000.00 lei", "@sav_er1")] },
    { name: "Repay part", summary: "Repay some of the loan and keep a cushion.", fit: "Lowers what you owe and keeps savings for emergencies.", facts: [f("Early repayment fee", "1.00% of the amount repaid", "@loan_er1")] },
    { name: "Keep paying", summary: "Leave the loan as it is.", fit: "Keeps all your savings available.", facts: [f("Monthly payment", "920.00 lei", "@loan_er1")] },
  ],
  recommendation: { option: "Repay part", reasons: ["You stop paying the loan's interest on the amount you repay", "You keep savings for emergencies"],
    whenOther: "Repaying everything fits better if your income is very steady." },
};

export const CHAT_CARDS: Record<string, SeedCard[]> = {
  "chat-01#0": [{ type: "comparison", title: "Mortgages with a fixed rate first",
    options: [
      rz("Casa Ta", f("Fixed rate", "from 5.05%", "casaTa#description-3"), f("After the fixed period", "IRCC + 2.30% margin", "casaTa#description-3")),
      other("Casa Mea", "BCR", f("Fixed rate", "4.99%, or 6.19% without conditions", "bcrMortgage#fees-13")),
      other("ING mortgage", "ING", f("Fixed rate", "4.79% to 6.59%", "ingMortgage#description-12")),
    ] }],
  "chat-01#1": [{ type: "comparison", title: "Longer fixed periods",
    options: [
      rz("Casa Ta", f("Longest fixed period", "5 years", "casaTa#description-3"), f("Rate, 5 years fixed", "from 5.65%", "casaTa#description-3")),
      other("Casa Mea", "BCR", f("Longest fixed period", "10 years", "bcrMortgage#fees-12")),
      other("ING mortgage", "ING", f("Longest fixed period", "5 years", "ingMortgage#description-12"), f("Rate, 5 years fixed", "5.29% to 7.09%", "ingMortgage#description-12")),
    ] }],
  "chat-01#2": [facts("Casa Ta Verde", f("Fixed rate, first 3 years", "from 4.85%", "casaTaVerde#description-2"),
    f("After the fixed period", "IRCC + 2.10% margin", "casaTaVerde#fees-4"))],
  "chat-01#3": [facts("Casa Ta Verde conditions", f("Down payment", "at least 15% of the value", "casaTaVerde#features-1"),
    f("Amount", "5.000 to 300.000 euros, paid in lei", "casaTaVerde#features-1"), f("Time at your current job", "at least 3 months", "casaTaVerde#features-1"))],
  "chat-01#4": [facts("The bank's example", f("Amount and term", "350.900 lei over 25 years", "casaTaVerde#fee_table-9"),
    f("Fixed rate", "4.85%", "casaTaVerde#fee_table-9"), f("Monthly payment, fixed period", "2.115,01 lei", "casaTaVerde#fee_table-9"),
    f("APR (DAE)", "7.79%", "casaTaVerde#fee_table-9"))],
  "chat-01#5": [{ type: "routes", title: "Ways to finance the flat",
    routes: [
      { name: "Casa Ta Verde", summary: "A mortgage for energy-efficient homes, at a lower rate.", fit: "The flat is A-class, so it qualifies.", facts: [f("Down payment", "at least 15%", "casaTaVerde#features-1")] },
      { name: "Casa Ta", summary: "The standard Raiffeisen mortgage.", fit: "The fallback if the energy certificate isn't ready.", facts: [f("Down payment", "at least 15%", "casaTa#features-1")] },
    ],
    recommendation: { option: "Casa Ta Verde", reasons: ["The flat is A-class", "Its rate is lower than standard Casa Ta"], whenOther: "Standard Casa Ta fits if the energy certificate isn't ready." } }],
  "chat-01#6": [facts("Casa Ta Verde", f("Payment pause", "3 months", "casaTaVerde#overview-0"))],

  "chat-02#0": [
    { type: "routes", title: "Ways to pay for the kitchen",
      routes: [
        { name: "Personal loan", summary: "The whole amount at once, repaid at a fixed rate.", fit: "Suits a sum this size, with a payment that doesn't change.",
          facts: [f("Fixed rate", "5.55% to 17.95% a year", "personal#description-10"), f("Term", "18 months to 5 years", "personal#features-1")] },
        { name: "Overdraft", summary: "Extra money on your current account, at a variable rate.", fit: "Suits a short gap.", facts: [f("Limit", "up to 6 net salaries", "overdraft#fee_table-8")] },
        { name: "Save first", summary: "Build the sum in a savings account, then pay.", fit: "Fits if the work can wait.", facts: [f("Interest", "from 2% a year", "savings#overview-0")] },
      ],
      recommendation: { option: "Personal loan", reasons: ["The payment is fixed", "It suits a sum this size"], whenOther: "Saving first fits if the renovation can wait; an overdraft fits a short gap." } },
    { type: "simulation", title: "Repayment simulation", product: "Personal loan", ratePercent: 5.55, rateMaxPercent: 17.95, source: "personal#description-10", amount: 30000 },
  ],
  "chat-02#1": [{ type: "comparison", title: "Personal loan or overdraft",
    options: [
      rz("Personal loan", f("How you get the money", "The whole amount at once", "personal#features-1"), f("How you repay", "Equal monthly payments", "personal#features-1"),
        f("Term or limit", "18 months to 5 years", "personal#features-1")),
      rz("Overdraft", f("How you get the money", "Extra money on your current account", "overdraft#fee_table-8"), f("How you repay", "Refill what you use", "overdraft#fee_table-8"),
        f("Term or limit", "up to 6 net salaries", "overdraft#fee_table-8")),
    ],
    recommendation: { option: "Personal loan", reasons: ["For a kitchen, a fixed monthly payment is easier to plan"], whenOther: "The overdraft fits a short gap you refill quickly." } }],
  "chat-02#3": [{ type: "comparison", title: "What the loan and the overdraft cost",
    options: [
      rz("Personal loan", f("Rate", "Fixed", "personal#description-10"), f("APR (DAE)", "7.90% to 39.4%", "personal#description-10"), f("Application fee", "200 Lei", "personal#description-10")),
      rz("Overdraft", f("Rate", "IRCC plus the bank's margin", "overdraft#fee_table-8"), f("IRCC", "5.57%", "overdraft#fee_table-8")),
    ],
    recommendation: { option: "Personal loan", reasons: ["Its rate is fixed", "It doesn't renew each year"], whenOther: "The overdraft fits a short gap, since you pay interest only on what you use." } }],
  "chat-02#4": [facts("Personal loan rate", f("Lowest rate", "5.55%", "personal#description-10"),
    f("Needs", "income of at least 2.000 RON into Raiffeisen", "personal#description-10"))],
  "chat-02#5": [facts("Personal loan over 5 years", f("Longest term", "5 years", "personal#features-1"),
    f("Payment pause", "3 months, from the seventh month", "personal#description-13"))],

  "chat-04#0": [facts("Your Casa Ta mortgage", f("Rate now", "5.49% a year", "@loan_fr1"), f("After the fixed period", "IRCC + 2.49-point margin", "@loan_fr1"),
    f("Monthly payment", "2,450.00 lei", "@loan_fr1"))],
  "chat-04#1": [facts("IRCC", f("Latest value quoted", "5.57%", "overdraft#fee_table-8"), f("Your margin", "2.49 points", "@loan_fr1"))],
  "chat-04#2": [facts("Your rate after the fixed period", f("Your rate now", "5.49%", "@loan_fr1"), f("IRCC today", "5.57%", "overdraft#fee_table-8"),
    f("Your margin", "2.49 points", "@loan_fr1"))],
  "chat-04#3": [{ type: "routes", title: "When the fixed rate ends",
    routes: [
      { name: "New fixed period", summary: "Fix the rate again with Casa Ta.", fit: "Keeps the payment predictable.",
        facts: [f("Fixed for 3 years", "from 5.05%", "casaTa#description-3"), f("Fixed for 5 years", "from 5.65%", "casaTa#description-3")] },
      { name: "Refinance", summary: "Move the balance to a Raiffeisen refinancing loan.", fit: "Fits if the new terms beat your contract.", facts: [] },
      { name: "Repay part early", summary: "Keep the variable rate and lower what you owe.", fit: "Fits if you have savings to spare.",
        facts: [f("Still owed", "310,000.00 lei", "@loan_fr1"), f("Early repayment fee", "1.00%", "@loan_fr1")] },
    ],
    recommendation: { option: "New fixed period", reasons: ["It keeps the payment predictable"], whenOther: "Repaying part early fits better if you have savings to spare." } }],
  "chat-04#4": [facts("Repaying part from savings", f("Your savings", "8,000.00 lei", "@sav_fr1"), f("Early repayment fee", "1.00% of the amount repaid", "@loan_fr1"))],

  "chat-05#0": [
    facts("Your maturing deposit", f("Amount", "10,000.00 lei", "@dep_cc1"), f("Rate", "5.00%", "@dep_cc1"), f("Interest before tax", "250.00 lei", "@dep_cc1")),
    { type: "routes", title: "Where to put the money next",
      routes: [
        { name: "Term deposit", summary: "A new deposit at Raiffeisen.", fit: "For money you won't need for a while.",
          facts: [f("12 months", "5.20% a year", "deposit#features-1"), f("3 months", "5%", "deposit#features-1")] },
        { name: "Fresh Money", summary: "A deposit for money new to Raiffeisen.", fit: "Only if you bring money from another bank.", facts: [f("4 months", "6.20% a year", "freshMoney#description-1")] },
        { name: "Savings account", summary: "Interest with access any time.", fit: "If you may need the money.", facts: [f("Interest", "from 2% a year", "savings#overview-0")] },
      ],
      recommendation: { option: "Term deposit", reasons: ["It pays more than the savings account on money already at Raiffeisen"], whenOther: "The savings account fits if you may need the money; Fresh Money fits money new to Raiffeisen." } },
  ],
  "chat-05#1": [{ type: "comparison", title: "Deposits for new money",
    options: [
      other("BCR deposit", "BCR", f("Rate", "up to 6% a year", "bcrDeposit#fees-3"), f("Term", "5 months", "bcrDeposit#fees-3"), f("For", "new money only", "bcrDeposit#fees-3")),
      rz("Fresh Money", f("Rate", "6.20% a year", "freshMoney#description-1"), f("Term", "4 months", "freshMoney#description-1"), f("For", "new money only", "freshMoney#description-1")),
    ] }],
  "chat-05#2": [{ type: "comparison", title: "Your money at Raiffeisen or at BCR",
    options: [
      rz("Term deposit, 12 months", f("Rate", "5.20%", "deposit#features-1"), f("For", "money already at Raiffeisen", "deposit#features-1")),
      other("BCR deposit", "BCR", f("Rate", "up to 6%", "bcrDeposit#fees-3"), f("For", "new money only, for 5 months", "bcrDeposit#fees-3")),
    ] }],
  "chat-05#3": [facts("Preferential deposit rate", f("Terms", "3, 6 and 12 months", "deposit#description-3"), f("Needs", "your salary paid into Raiffeisen", "deposit#description-3"))],

  "chat-06#0": [facts("Your Platinum credit card", f("Annual fee", "150.00 lei", "@card_ltc2"), f("Payments in 12 months", "2", "@card_ltc2"))],
  "chat-06#1": [facts("What you'd give up", f("Your limit", "15,000.00 lei", "@card_ltc2"),
    f("Interest-free, purchases from 500 lei", "6 instalments", "ccPlatinum#features-1"), f("Interest-free, purchases from 1000 lei", "9 instalments", "ccPlatinum#features-1"))],
  "chat-06#2": [{ type: "comparison", title: "Platinum or Standard credit card",
    options: [
      rz("Platinum", f("Interest, repaid over 12 months", "26%", "ccPlatinum#fees-10"), f("APR (DAE), bank's example", "37,88%", "ccPlatinum#fees-10")),
      rz("Standard", f("Interest, repaid over 12 months", "26%", "ccStandard#fees-10"), f("APR (DAE), bank's example", "32,40%", "ccStandard#fees-10"),
        f("Limit", "700 to 50.000 lei", "ccStandard#features-1")),
    ],
    recommendation: { option: "Standard", reasons: ["It costs less in the bank's example", "You rarely use the card for credit"], whenOther: "Platinum fits if you use its interest-free instalments; no credit card fits if you never borrow on it." } }],

  "chat-07#0": [facts("Repaying your personal loan early", f("Still owed", "18,500.00 lei", "@loan_er1"), f("Rate", "8.90% a year", "@loan_er1"),
    f("Early repayment fee", "1.00%", "@loan_er1"), f("Fee to repay it all today", "185.00 lei", "@loan_er1"))],
  "chat-07#1": [repayRoutes],
  "chat-07#2": [facts("Early repayment fees", f("Repay it all today", "185.00 lei", "@loan_er1"), f("Repay part", "1.00% of what you repay", "@loan_er1"))],
  "chat-07#3": [repayRoutes, facts("Loan and savings", f("Loan rate", "8.90% a year", "@loan_er1"), f("Your savings rate", "1.50% a year", "@sav_er1"))],
  "chat-07#4": [facts("What your money earns and costs", f("Your savings account", "1.50% a year", "@sav_er1"), f("Your loan", "8.90% a year", "@loan_er1"),
    f("Raiffeisen savings account today", "from 2%", "savings#overview-0"))],

  "chat-08#0": [
    { type: "comparison", title: "Casa Ta or ING's mortgage",
      options: [
        rz("Casa Ta", f("Fixed rate, first years", "from 5.05%", "casaTa#description-3")),
        other("ING mortgage", "ING", f("Fixed rate, first years", "4.79% to 6.59%", "ingMortgage#description-12"), f("Down payment", "at least 15%", "ingMortgage#description-12")),
      ] },
    facts("Emergency fund: savings account", f("Interest", "from 2% a year", "savings#overview-0"), f("Access", "withdraw any time", "savings#overview-0"),
      f("Management fee in lei", "zero", "savings#description-7")),
  ],
  "chat-08#1": [facts("Deposit or savings account", f("12-month deposit", "5.20% a year, money locked", "deposit#features-1"),
    f("Savings account", "withdraw the same day", "savings#features-1"))],
  "chat-08#2": [{ type: "comparison", title: "Which mortgage to pick",
    options: [
      rz("Casa Ta", f("With your salary at Raiffeisen", "1% lower rate, loan in lei", "casaTa#faq-12")),
      other("ING mortgage", "ING", f("Lowest rate depends on", "the options you take", "ingMortgage#description-12")),
    ],
    recommendation: { option: "Casa Ta", reasons: ["With your salary at Raiffeisen, its rate drops"], whenOther: "ING fits better if you already bank there." } }],
  "chat-08#3": [{ type: "checklist", title: "Mortgage and savings together", items: [
    { text: "Build the emergency fund first" },
    { text: "Then take the mortgage", detail: "A surprise won't strain the payment." },
    { text: "Set up FixPay", detail: "It moves money into the savings account each month, free of charge.", source: "savings#description-7" },
  ] }],
  "chat-08#5": [facts("Savings account fees", f("Management fee in lei", "zero", "savings#description-7"), f("Opening and closing", "0%", "savings#description-7"),
    f("FixPay transfers", "free", "savings#description-7"), f("Tax on interest", "10%", "savings#faq-12"))],

  "chat-09#0": [{ type: "routes", title: "Getting through the month",
    routes: [
      { name: "Clear the card first", summary: "Pay down the credit card before anything else.", fit: "Card debt is usually the most expensive.",
        facts: [f("Card used", "2,600.00 lei", "@card_sl2"), f("Card limit", "3,000.00 lei", "@card_sl2")] },
      { name: "Overdraft", summary: "Extra money on your current account.", fit: "For a short gap; costs nothing if unused.", facts: [f("Limit", "up to 6 net salaries", "overdraft#fee_table-8")] },
      { name: "Personal loan", summary: "A larger sum with a fixed payment.", fit: "For a bigger sum, repaid over time.", facts: [f("Term", "from 18 months", "personal#features-1")] },
    ],
    recommendation: { option: "Clear the card first", reasons: ["Card debt is usually the most expensive"], whenOther: "An overdraft fits the days before your salary; a personal loan fits a larger sum." } }],
  "chat-09#3": [facts("Your credit card", f("Minimum repayment", "5% of what you owe", "ccStandard#description-12"), f("Card used", "2,600.00 lei", "@card_sl2"))],

  "chat-10#0": [facts("Personal loan", f("Amount", "500 to 50.000 euros, paid in lei", "personal#features-1"), f("Fixed rate", "5.55% to 17.95%", "personal#description-10"),
    f("Term", "18 months to 5 years", "personal#features-1"), f("Application fee", "200 Lei", "personal#description-10"))],
  "chat-10#1": [facts("Savings products", f("Savings account", "from 2% a year, access any time", "savings#overview-0"),
    f("Term deposit", "5% for 3 months, 5.20% for 12", "deposit#features-1"), f("Fresh Money", "6.20% for 4 months, new money", "freshMoney#description-1"))],
  "chat-10#3": [{ type: "comparison", title: "Savings options side by side",
    options: [
      rz("Savings account", f("Rate", "from 2%", "savings#overview-0"), f("Access", "any time", "savings#overview-0")),
      rz("Term deposit, 12 months", f("Rate", "5.20%", "deposit#features-1"), f("Access", "locked for the term", "deposit#features-1")),
      rz("Fresh Money", f("Rate", "6.20%, for 4 months", "freshMoney#description-1"), f("Access", "new money only", "freshMoney#description-1")),
    ] }],
  "chat-10#4": [
    facts("Personal loan eligibility", f("Time at your current job", "at least 3 months", "personal#eligibility-3")),
    { type: "handoff", title: "Probation needs a person", reason: "Only the bank can assess a probation contract, so a specialist would check yours." },
  ],
  "chat-10#5": [facts("Personal loan eligibility", f("Time at your current job", "at least 3 months", "personal#eligibility-3"))],

  "chat-11#0": [facts("Savings products", f("Savings account", "from 2% a year", "savings#overview-0"), f("Term deposit, 12 months", "5.20%", "deposit#features-1"),
    f("Fresh Money, 4 months", "6.20%", "freshMoney#description-1"))],
  "chat-11#1": [facts("Fresh Money", f("Rate in lei", "6.20% a year", "freshMoney#description-1"), f("Rate in euros", "2.50%", "freshMoney#description-1"),
    f("Term", "4 months", "freshMoney#description-1"), f("Minimum", "500 Lei or 100 Euro", "freshMoney#description-3"))],
  "chat-11#2": [{ type: "comparison", title: "Fresh Money or a standard deposit",
    options: [
      rz("Fresh Money", f("Rate", "6.20%", "freshMoney#description-1"), f("Term", "4 months", "freshMoney#description-1"), f("For", "new money only", "freshMoney#description-1")),
      rz("Term deposit, 3 months", f("Rate", "4.70%, or 5.00% with the bonus", "deposit#interest_rates-10"), f("Term", "3 months", "deposit#interest_rates-10"),
        f("For", "any money", "deposit#interest_rates-10")),
    ] }],

  "chat-13#3": [{ type: "routes", title: "Where to keep your savings",
    routes: [
      { name: "Savings account", summary: "Interest with access any time.", fit: "For money you may need.", facts: [f("Interest", "from 2%", "savings#overview-0")] },
      { name: "Term deposit", summary: "A fixed rate for a year.", fit: "For money you won't need this year.", facts: [f("12 months", "5.20%", "deposit#features-1")] },
      { name: "Fresh Money", summary: "A deposit for money new to Raiffeisen.", fit: "Only for new money.", facts: [f("Rate, 4 months", "6.20%", "freshMoney#description-1")] },
    ],
    recommendation: { option: "Term deposit", reasons: ["It pays more than the savings account on money that stays put"], whenOther: "The savings account fits money you may need; Fresh Money fits money new to Raiffeisen." } }],

  "chat-14#2": [facts("Casa Ta Verde", f("Interest", "from 4,85%", "casaTaVerde#overview-0"), f("Payment pause", "3 months", "casaTaVerde#overview-0"))],
  "chat-14#3": [{ type: "checklist", title: "Casa Ta Verde conditions", items: [
    { text: "A down payment of at least 15%", source: "casaTaVerde#features-1" },
    { text: "Borrow 5.000 to 300.000 euros", detail: "Paid in lei.", source: "casaTaVerde#features-1" },
    { text: "At least 3 months at your current job", source: "casaTaVerde#features-1" },
    { text: "The loan ends by 63 for women or 65 for men", source: "casaTaVerde#features-1" },
  ] }],

  "chat-15#0": [facts("Your pre-approved personal loan", f("Amount", "up to 30,000.00 lei", "@offer_cs1"), f("Rate", "7.90% a year", "@offer_cs1"),
    f("Fee", "249.00 lei", "@offer_cs1"), f("Raiffeisen's published range", "5.55% to 17.95%", "personal#description-10"))],
  "chat-15#1": [facts("Compare on the APR", f("Your offer's fee", "249.00 lei", "@offer_cs1"), f("Raiffeisen's published APR", "7.90% to 39.4%", "personal#description-10"))],
  "chat-15#2": [facts("What can change the price", f("Optional loan insurance", "2% lower rate", "personal#description-13"), f("Your rate", "7.90%", "@offer_cs1"))],

  "chat-16#0": [{ type: "routes", title: "Saving for the wedding and the car",
    routes: [
      { name: "Savings account", summary: "Interest with access any time.", fit: "Wedding money needed within a year.", facts: [f("Interest", "from 2%", "savings#overview-0")] },
      { name: "Short term deposit", summary: "A short fixed rate, renewed as you go.", fit: "Wedding money you won't touch for a few months.", facts: [f("3 months", "5%", "deposit#features-1")] },
      { name: "Longer term deposits", summary: "Higher rates for money that stays put.", fit: "Car money, needed in three years.", facts: [f("12 months", "5.20%", "deposit#features-1")] },
    ],
    recommendation: { option: "Longer term deposits", reasons: ["The car money can stay put, so it earns more", "Keeping it apart means you never break it for the wedding"],
      whenOther: "For the wedding money, the savings account or a short term deposit fits better." } }],
  "chat-16#2": [{ type: "checklist", title: "Your saving plan", items: [
    { text: "Wedding: 40000 lei first", detail: "Its date is fixed." },
    { text: "Car: start the 60000 lei fund smaller" },
    { text: "Set up FixPay", detail: "It moves the money each month, free of charge.", source: "savings#description-7" },
  ] }],

  "chat-17#0": [{ type: "routes", title: "Working capital for the busy season",
    routes: [
      { name: "Credit line", summary: "A limit the company draws on and repays.", fit: "Covers the gap between payments in and out.",
        facts: [f("From", "7.000 euros or lei", "bizCreditLine#description-3"), f("Limit", "up to 35% of last year's turnover", "bizCreditLine#description-3")] },
      { name: "Business credit cards", summary: "Cards for smaller purchases.", fit: "For smaller, short-term spending.", facts: [f("Grace period", "up to 45 days", "bizCards#features-1")] },
      { name: "Break a deposit", summary: "Use the company's own savings.", fit: "If you'd rather not borrow.", facts: [f("Interest if broken early", "0%", "bizDeposit#description-4")] },
    ],
    recommendation: { option: "Credit line", reasons: ["It covers a seasonal gap between payments in and out"], whenOther: "Cards fit smaller purchases; breaking a deposit fits if you'd rather not borrow." } }],
  "chat-17#1": [{ type: "checklist", title: "Credit line approval", items: [
    { text: "Amount capped at 35% of turnover", detail: "From the last closed financial year.", source: "bizCreditLine#description-3" },
    { text: "Guarantees", detail: "Such as a pledge on current accounts or a personal guarantee.", source: "bizCreditLine#description-3" },
    { text: "Interest rate quoted by a business specialist", detail: "The page doesn't publish it." },
  ] }],
  "chat-17#2": [facts("Credit line limit", f("Based on", "the last closed financial year", "bizCreditLine#description-3"))],

  "chat-18#0": [
    { type: "comparison", title: "Business term deposits",
      options: [
        rz("Raiffeisen business deposit", f("Terms", "1, 3, 6 or 12 months", "bizDeposit#description-2"), f("Minimum", "5000 RON", "bizDeposit#description-2"),
          f("Euro rate, 12 months", "2%", "bizDeposit#description-4")),
        other("ING business deposit", "ING", f("Terms", "7 days to 12 months", "ingBizDeposit#description-3"), f("Minimum", "1000 RON", "ingBizDeposit#description-3"),
          f("Euro rate, 12 months", "Not published", "ingBizDeposit#description-3")),
      ] },
    facts("Business credit cards", f("Commission on shop payments", "0%", "bizCards#features-1")),
  ],
  "chat-18#1": [{ type: "comparison", title: "Business deposit rates",
    options: [
      rz("Raiffeisen business deposit", f("Euro rate, 3 months", "1,40%", "bizDeposit#description-2"), f("Euro rate, 6 months", "1,80%", "bizDeposit#description-2"),
        f("Euro rate, 12 months", "2%", "bizDeposit#description-2")),
      other("ING business deposit", "ING", f("Euro rate, 3 months", "Not published", "ingBizDeposit#description-3")),
    ] }],
  "chat-18#2": [{ type: "comparison", title: "What each deposit publishes",
    options: [
      rz("Raiffeisen business deposit", f("Minimum", "5000 RON", "bizDeposit#description-4"), f("Interest if broken early", "0%", "bizDeposit#description-4")),
      other("ING business deposit", "ING", f("Minimum", "1000 RON", "ingBizDeposit#description-3"), f("Shortest term", "7 days", "ingBizDeposit#description-3")),
    ] }],
  "chat-18#3": [facts("Business credit cards", f("Grace period", "up to 45 days", "bizCards#features-1"), f("Commission at shops", "0%", "bizCards#features-1"),
    f("Interest-free instalments", "3, on payments from 300 lei", "bizCards#features-1"), f("Limit, card obtained digitally", "up to 10.000 RON", "bizCards#features-1"))],
  "chat-18#4": [facts("Card limits for the company", f("Company total", "up to 100.000 lei", "bizCards#description-7"),
    f("Cap", "10% of last balance sheet's turnover", "bizCards#description-7"))],

  "chat-20#1": [facts("Business credit cards", f("Grace period", "up to 45 days", "bizCards#features-1"), f("Commission at shops", "0%", "bizCards#features-1"),
    f("Interest-free instalments", "3, on payments from 300 lei", "bizCards#features-1"))],
  "chat-20#2": [facts("Debit or credit card", f("Debit card", "spends money in the account"), f("Credit card", "spends from a limit the bank grants", "bizCards#description-7"),
    f("Minimum monthly repayment", "10% of the balance", "bizCards#description-7"))],
  "chat-20#3": [{ type: "routes", title: "Cards for the company",
    routes: [
      { name: "Debit cards", summary: "Cards on the company account.", fit: "Everyday spending, without borrowing.", facts: [] },
      { name: "Business credit cards", summary: "Cards with a limit the bank grants.", fit: "Travel and online purchases.", facts: [f("Grace period", "up to 45 days", "bizCards#features-1")] },
      { name: "Credit line", summary: "A limit for bigger gaps.", fit: "Bigger, seasonal gaps.", facts: [f("From", "7.000 euros or lei", "bizCreditLine#description-3")] },
    ],
    recommendation: { option: "Debit cards", reasons: ["They cover everyday spending without borrowing"], whenOther: "Credit cards fit staff who travel; a credit line fits bigger gaps." } }],
};

/** Answers without a card, and why. */
export const TEXT_ONLY: Record<string, string> = {
  "chat-02#6": "one-line follow-up", "chat-03#0": "no account data in this preview; asks which charge", "chat-03#1": "no account data in this preview",
  "chat-04#5": "pleasantry", "chat-06#3": "one-line follow-up", "chat-06#4": "one-line follow-up", "chat-06#5": "pleasantry", "chat-07#5": "one-line follow-up",
  "chat-07#6": "one-line follow-up", "chat-08#4": "pleasantry", "chat-09#4": "one-line follow-up", "chat-09#5": "pleasantry", "chat-10#6": "one-line follow-up",
  "chat-11#3": "one-line follow-up", "chat-11#4": "one-line follow-up", "chat-11#5": "pleasantry", "chat-13#4": "one-line follow-up", "chat-13#5": "pleasantry",
  "chat-14#4": "pleasantry", "chat-15#3": "one-line follow-up", "chat-16#1": "asks the customer for the amounts", "chat-16#3": "one-line follow-up",
  "chat-16#4": "one-line follow-up", "chat-16#5": "pleasantry", "chat-17#5": "one-line follow-up", "chat-18#5": "one-line follow-up",
  "chat-20#4": "one-line follow-up", "chat-20#5": "pleasantry",
};
