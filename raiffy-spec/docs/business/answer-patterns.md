# Business: Answer patterns

**Core rule, unchanged: always compare financing routes.** Every business answer involving money compares at least three routes for the business's numbers, including routes that don't borrow, with every commission listed.

## Business financing routes catalog

| Route | Typical use | Notes |
| --- | --- | --- |
| Own cash or retained profit | Any need; always the baseline | Shows the effect on the cash buffer |
| Faster collection (earlier client payment, shorter terms) | Cash gaps | No cost, but depends on clients |
| Supplier credit (longer payment terms) | Cash gaps, inventory | Negotiated, not a bank product |
| Overdraft or credit line | Short cash gaps, seasonality | 12 months, renewable |
| Working-capital loan | Stock, larger seasonal needs | Up to 60 months |
| Investment loan | Equipment, premises, expansion | Own contribution required |
| Liberal-profession investment loan | Clinics, offices, equipment for PFAs and practices | Longer terms, lower contribution |
| EIF microfinance | Young or very small businesses without collateral | From about 6 months of activity |
| Leasing | Vehicles and equipment | Open to PFAs |
| Factoring | Unpaid invoices from creditworthy clients | Non-recourse |
| Business credit card | Small, short purchases | Grace period |
| State-guaranteed loan (FNGCIMM, BID) | When collateral is the obstacle | Guarantee fee and programme dates apply |
| EU or national grant with bank co-financing | Investment projects matching an open call | The managing authority decides; the bank pre-finances or co-finances |
| Postponing or phasing the investment | When cash flow can't carry it now | Shows the cost of waiting |

## Ten business patterns

| # | Pattern | Triggers | Steps | Blocks |
| --- | --- | --- | --- | --- |
| 1 | Investment or equipment purchase | "I need a new car for the firm", "buy a CNC machine", "open a second clinic" | Size the purchase, compare loan vs leasing vs own cash vs guaranteed loan, check debt-service coverage, show total cost, eligibility and next step | routes, inputs, affordability, costBreakdown, fundingPrograms |
| 2 | Cash-flow gap | "Salaries are due, my client pays in 60 days" | Forecast the gap, compare overdraft, factoring, earlier collection, supplier terms, delaying a cost | cashflow, invoices, routes |
| 3 | Product comparison | "Is your business loan better than BT's?" | Same as individuals pattern 2: Raiffeisen first, honest comparison, counter-offer | comparison, routes, keyFacts |
| 4 | Funding programmes | "Are there state-backed loans for me?", "EU funds for my workshop" | Match the profile to open programmes, show status, deadline, coverage and fees, then routes with and without the programme | fundingPrograms, routes, checklist |
| 5 | Starting a business | "I want to open a PFA", "start an SRL" | Explain the legal forms in general, accounts and packages, first-year financing that's realistic, accountant referral for the tax choice | keyFacts, checklist, routes |
| 6 | Unpaid invoices and receivables | "A client is 90 days late" | Show receivables, compare factoring, collection steps, credit line; legal referral for disputes | invoices, routes, checklist |
| 7 | Fees, packages and statements | "Which business package fits me?", "why was I charged this?" | Explain the fee, compare packages for the business's actual usage | keyFacts, costBreakdown, routes |
| 8 | Tax and reporting deadlines | "When is my VAT due?", "what's e-Factura?" | Explain the obligation and the date from config, set a reminder, accountant referral | taxCalendar, keyFacts, checklist |
| 9 | Growth and hiring | "Can I afford to hire two people?", "expand to a new city" | Model the new monthly costs in the cash-flow forecast, compare financing routes for the transition period | cashflow, routes, affordability |
| 10 | Problem, security or distress | Supplier fraud, blocked account, tax arrears, insolvency fears | Act first on safety, then the business hardship flow, ticket and specialist callback | callout, ticket, handoff |

Multi-goal business requests ("buy a van and cover the summer cash gap") always go to the orchestrator, which decides across goals on the shared cash flow.

The Blocks column is the block recipe for each pattern; new business blocks are defined in `docs/business/schema-and-pipeline.md`.
