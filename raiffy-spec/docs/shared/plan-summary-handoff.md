# Shared: Plan summary and official handoff

Raiffy's plan summary is an **indicative simulation** that mirrors Raiffeisen's official loan documents and hands off to the bank's own application flow. The official standard information form (SECCI), contract and repayment schedule are issued only by the bank's systems, emailed to the customer, signed with a qualified electronic signature (Namirial, SMS code), and kept in Smart Mobile, where each loan's Dashboard shows its repayment schedule.

| Solution | Category | Source |
| --- | --- | --- |
| Label every plan summary "Simulare orientativă: nu reprezintă o ofertă fermă de creditare"; it must never look like an offer or a contract | Behavior rules | Auth · OUG 50/2010, Law 363/2007 |
| Structure the summary like the official documents: main features, amount, total cost, DAE, number and frequency of instalments, all commissions, an indicative repayment schedule table (date, principal, interest, fees, remaining balance), and the operator's signature when verified | Calculations | SECCI structure; Raiffeisen loan documents |
| Generate the summary from the conversation state (goals, chosen routes, figures, sources), as a downloadable PDF | Hard limits | Answer schema · `PlanSummary` |
| Deliver it in the Smart Mobile Inbox and by email as a service message, which needs no marketing consent because the customer requested it | Regulations | GDPR, Law 506/2004 |
| End with "Aplică în Smart Mobile", passing the chosen amount, term and product to the official flow, which issues the SECCI and contract, applies the 15-day reflection period and handles the qualified e-signature | Behavior rules | Raiffeisen Flexicredit and Smart Mobile T&C |
| Never collect signatures, SMS codes or issue contract documents inside Raiffy | Hard limits | OUG 209/2019, qualified e-signature flow |
| Eval: the summary carries the indicative label, matches the calculator to the cent, lists all commissions, and its handoff pre-fills the official flow correctly | Edge cases | Evals |

For business customers, the handoff goes to Smart Business or Raiffeisen Online IMM instead of Smart Mobile; business loans are currently decided in a branch, so the handoff pre-fills the online lead form or books a branch or specialist appointment.

How the handoff works inside the app (deep links, the pre-filled flow, status events back to Raiffy): `docs/shared/smart-mobile.md`.

## Schema

The Zod schema is `lib/plan/schemas.ts` (`planSummarySchema`), built by `buildPlan` in `lib/plan/build.ts`. Money is integer bani and rates are integer basis points. Text is keys the UI formats; the only free text is the customer's goal.

```ts
type PlanSummary = {
  id: string;                     // "PS-2318"
  version: number;                // a change is a new version, never an edit in place
  conversationId: string;
  track: "personal" | "business";
  label: "indicative";
  createdAt: string;
  goal: { summary: string; productId: string; product: string; amount: number; termMonths: number };
  terms: { annualRateBps: number; rateType: "fixed"; rateTermId: string; upfrontFee: number; monthlyFee: number; firstPaymentDate: string };
  figures: { monthly: number; instalment: number; interest: number; fees: number; total: number; dae: number; commissions: Commission[] };
  routes: { key: string; productId: string; termMonths: number; monthly: number | null; cost: number | null; fits: boolean; chosen: boolean; recommended: boolean }[];
  affordability: { income: number; obligations: number; debtShareBps: number; leftEachMonth: number } | null;
  repaymentSchedule: { n: number; date: string; principal: number; interest: number; fees: number; payment: number; balance: number }[];
  assumptions: { key: string; params?: Record<string, string | number> }[];
  missing: { key: string; params?: Record<string, string | number> }[];
  sources: { termId: string; url: string; collectedAt: string; reviewBy: string; reviewedAt: string }[];  // every catalog value used
  verification: Verification;     // see docs/decisions/product-decisions.md (human verification); a confirmation of an earlier version shows "changed"
  handoff: { target: "smart_mobile" | "business_lead"; productId: string; amount: number; termMonths: number };
};
type Commission = { key: "origination_fee" | "administration_fee" | "account_package" | "insurance" | "early_repayment_fee";
  termId?: string; amount: number | null; basis: "charged" | "none" | "if_used" | "missing"; frequency?: "once" | "monthly"; conditions: string[] };
```

**Building rules.** A per-product template names which catalog records fill the rate, each commission line and the limits. Only fresh, quoted and reviewed records are used. A plan is refused, with gaps instead, when the rate is a starting value, a ceiling, a range or variable; when a charge counted in the total isn't in the catalog; or when the amount or term is outside the product's limits. A conditional fee the catalog doesn't confirm is listed as `missing` ("Not confirmed"), never as zero. Cases: `evals/plan-build.json`.

Sources: [Flexicredit T&C](https://banking.raiffeisen.ro/wps/wcm/connect/87fd1204-8f5e-41d9-a073-6c1f6a349317/20201212-Termeni-si-conditii-Flexicredit.pdf?MOD=AJPERES&CONVERT_TO=url&CACHEID=ROOTWORKSPACE-87fd1204-8f5e-41d9-a073-6c1f6a349317-oITnyvu&type=pdf) (2020, check it still applies), [Smart Mobile T&C, April 2026](https://www.raiffeisen.ro/content/dam/rbi/retail/eu/ro/documents/smart-mobile-termeni/20260417-Smart-Mobile-termeni-si-conditii.pdf.coredownload.inline.pdf), [Smart Mobile guide](https://www.raiffeisen.ro/content/dam/rbi/retail/eu/ro/documents/smart-mobile-ghid/20251010-smart-mobile-ghid.pdf.coredownload.pdf), [Infocons: standard European form](https://infocons.ro/care-este-forma-standard-la-nivel-european-privind-creditul-de-consum/).
