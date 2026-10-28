# Business: Calculations

All business math runs in deterministic, tested tools; the LLM only explains the results. Values that change by law or by programme live in dated config with an owner and a review date. The individuals calculator, commission and comparison engine are reused.

## Business tools

| Tool | What it computes | Notes |
| --- | --- | --- |
| `cashflowForecast` | Monthly inflows, outflows and balance for 3–12 months, the first month a gap appears and its size | Uses account data and receivables when connected, otherwise the owner's estimates; seasonality per month, never a flat average |
| `workingCapitalNeed` | Gap between paying suppliers and salaries and collecting from clients | Inputs: days to collect, days to pay, monthly costs |
| `loanVsLeasing` | Monthly cost, total cost, down payment, fees and ownership timing for loan, leasing and own cash | Tax and VAT effects explained only in general, with an accountant referral |
| `guaranteeCost` | Extra cost of a state guarantee (fee, any subsidy) and the collateral it replaces | Programme fees and coverage from the programme record |
| `invoiceFinancingCost` | Cost of factoring an invoice vs waiting for payment vs a credit line | Raiffeisen factoring is non-recourse and advances up to 100% of the invoice value ([factoring](https://www.raiffeisen.ro/ro/imm/produse-si-servicii/finantare/factoring-pentru-imm.html)) |
| `debtServiceCoverage` | Whether operating cash flow covers all loan payments, before and after the new financing | Replaces the personal DTI check in the business `affordability` block |
| `indicativeLimit` | Rough maximum for products tied to turnover | For example overdraft and working-capital loans of up to 35% of last year's turnover ([overdraft](https://www.raiffeisen.ro/ro/imm/produse-si-servicii/finantare/linie-de-credit.html)) |
| `eligibilityCheck` | Which products the business can apply for | Uses legal form, months of activity, closed financial years and turnover from the business profile; runs before any comparison, and excluded products show the reason |

## Eligibility rules seen on Raiffeisen's product pages

Store in the catalog; verify with the bank before use.

| Product | Rules shown |
| --- | --- |
| Overdraft and working-capital loan | Minimum €7,000, up to 35% of turnover, at least one closed financial year, turnover up to 34.3M lei |
| Investment loan | Up to 120 months, 6-month grace period, at least 15% own contribution |
| Investment loan for liberal professions | From €2,000, up to 180 months, at least 10% own contribution ([page](https://www.raiffeisen.ro/ro/imm/produse-si-servicii/finantare/credit-de-investitii-profesii-liberale.html)) |
| EIF microfinance | Up to €50,000, fewer than 10 employees, at least 6 months of activity, 80% EIF guarantee and no other real collateral ([page](https://www.raiffeisen.ro/ro/imm/produse-si-servicii/finantare/programe-eif-microfinantare.html)) |
| Business credit card | Up to 100,000 lei and 10% of turnover, 45-day grace period |
| Leasing | Vehicles and equipment, open to PFA and liberal professions |

The product pages aren't fully consistent (turnover limits of 34.3M lei, €5M or 36.8M lei appear in different places), so the catalog needs a confirmed value from the bank.

## Dated tax and programme config

Examples of values that must never sit in prompts.

| Value | 2026 setting | Source |
| --- | --- | --- |
| Micro-enterprise turnover threshold | €100,000; single 1% rate; at least one employee | [Fiscalitatea](https://www.fiscalitatea.ro/ghid-practic-impozitarea-microintreprinderilor-incepand-cu-1-ianuarie-2026-24615/) |
| Dividend tax | 16% from 1 January 2026 | [ContApp](https://contapp.ro/blog/plafoane-fiscale-2026-pentru-pfa-ii-si-microintreprinderi/) |
| Standard VAT rate | 21% from 1 August 2025 | [ContApp](https://contapp.ro/blog/plafoane-fiscale-2026-pentru-pfa-ii-si-microintreprinderi/) |
| VAT exemption threshold | 395,000 lei from 1 September 2025 | [ContApp](https://contapp.ro/blog/plafoane-fiscale-2026-pentru-pfa-ii-si-microintreprinderi/) |
| PFA income norm limit | Gross income under €25,000, listed CAEN codes only | [Fiscalitatea](https://www.fiscalitatea.ro/plafonul-de-25000-euro-pentru-pfa-urile-cu-norma-de-venit-se-aplica-incepand-cu-veniturile-din-2023-22233/) |
| PFA health contribution (CASS) cap | 72 minimum wages | [Contzilla](https://www.contzilla.ro/pfa-2026-norma-sau-sistem-real-cas-cass-impozit/) |
| e-Factura deadline | 5 working days from 1 January 2026 | [ContApp](https://contapp.ro/blog/e-factura/) |
| BID guarantee window | Loans granted by 31 December 2027 | [Raiffeisen](https://www.raiffeisen.ro/ro/imm/produse-si-servicii/finantare/credite-imm-garantate-de-bid.html) |

These are secondary sources (accounting and tax sites); an accountant or Raiffeisen's tax team must confirm each value before it goes live.

Suggested config shape:

```ts
type DatedValue<T> = {
  key: string;            // "micro.turnoverThreshold"
  value: T;
  validFrom: string;      // ISO date
  validTo?: string;
  sourceUrl: string;
  owner: string;          // who reviews it
  reviewBy: string;       // past this date the value is "stale" and blocks the answer
};
```
