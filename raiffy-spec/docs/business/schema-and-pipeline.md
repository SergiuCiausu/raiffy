# Business: Answer schema additions and pipeline differences

Extends `docs/shared/answer-schema.md` and `docs/shared/pipeline.md`.

## Envelope additions

```ts
type Answer = /* shared envelope */ & {
  track: "personal" | "business";
  business?: {
    companyId: string;              // internal ID, never the CUI typed in chat
    legalForm: "PFA" | "PFI" | "II" | "SRL" | "other";
    caen: string;
    ageMonths: number;
    vatPayer: boolean;
    taxRegime: string;              // from dated config labels
    turnoverBand: string;
    employeesBand: string;
    userRole: "administrator" | "empowered" | "viewer";
  };
};
```

## New blocks

| Block | Key fields | Used for | Signature component |
| --- | --- | --- | --- |
| `cashflow` | months[]: inflow, outflow, balance, isForecast; gap?: month, amount; assumptions[] | Cash-flow gaps, seasonality | Monthly bars with the gap highlighted in orange and assumptions listed below |
| `invoices` | receivables[]: client, amount, dueDate, daysOverdue; payables[] | Factoring, collection, payment timing | Two-column timeline: money coming in vs going out |
| `fundingPrograms` | programs[]: name, type (guarantee, grant, subsidy), status, deadline, eligibility[], fees, sourceId | State-guaranteed loans, EU and national funding | Cards with an open/closed status pill and the deadline |
| `taxCalendar` | items[]: obligation, dueDate, sourceId | Upcoming tax and reporting deadlines | Compact dated list with the next deadline first |

The twelve existing blocks are reused; `routes` gains business route types (credit line, investment loan, leasing, factoring, guaranteed loan) and `affordability` gains a business mode showing debt-service coverage instead of personal DTI.

## Pipeline differences

| Step | Business track |
| --- | --- |
| 1. Safety gate | Adds supplier and CEO fraud patterns, business distress signals, role check |
| 2. Router | Uses the business pattern catalog; detects personal-vs-business ambiguity for PFAs |
| 3. Orchestrator | Decides across goals on cash flow and debt-service coverage; sequences goals around the cash cycle (e.g., factoring first, then the investment) |
| 4. Composer and generator | Business recipes and new blocks; generator adds the accountant referral where tax appears |
| 5. Evaluator | Business rubric: no tax or legal recommendations, programme accuracy and status, personal-vs-business rules stated, B2B comparison wording |
| 6. Thinking panel | Business status lines ("Checking your cash flow for the next 6 months", "Checking state-guaranteed programmes") |

**Human verification** routes to SME specialists, and to the relationship manager when the company has one.
