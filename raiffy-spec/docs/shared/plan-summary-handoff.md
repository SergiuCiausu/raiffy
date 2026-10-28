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

```ts
type PlanSummary = {
  id: string;
  conversationId: string;
  track: "personal" | "business";
  goals: { summary: string; chosenRoute: string; amount: number; termMonths: number }[];
  figures: { monthly: number; total: number; dae?: number; commissions: Commission[] };
  repaymentSchedule: { date: string; principal: number; interest: number; fees: number; balance: number }[];
  sources: Source[];
  verification: Verification;     // see docs/decisions/product-decisions.md (human verification)
  createdAt: string;
  label: "indicative";
};
```

Sources: [Flexicredit T&C](https://banking.raiffeisen.ro/wps/wcm/connect/87fd1204-8f5e-41d9-a073-6c1f6a349317/20201212-Termeni-si-conditii-Flexicredit.pdf?MOD=AJPERES&CONVERT_TO=url&CACHEID=ROOTWORKSPACE-87fd1204-8f5e-41d9-a073-6c1f6a349317-oITnyvu&type=pdf) (2020, check it still applies), [Smart Mobile T&C, April 2026](https://www.raiffeisen.ro/content/dam/rbi/retail/eu/ro/documents/smart-mobile-termeni/20260417-Smart-Mobile-termeni-si-conditii.pdf.coredownload.inline.pdf), [Smart Mobile guide](https://www.raiffeisen.ro/content/dam/rbi/retail/eu/ro/documents/smart-mobile-ghid/20251010-smart-mobile-ghid.pdf.coredownload.pdf), [Infocons: standard European form](https://infocons.ro/care-este-forma-standard-la-nivel-european-privind-creditul-de-consum/).
