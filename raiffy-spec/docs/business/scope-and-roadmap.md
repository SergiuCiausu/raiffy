# Business: Scope and roadmap

Raiffy gets a second track for businesses: PFAs and freelancers, plus micro and small companies (SRLs). It runs on the same core as the individuals track (safety gate, router, orchestrator, evaluator, answer schema, thinking panel), with its own answer patterns, financing routes, tools, rules and UI blocks.

## Scope

| Segment | In scope | Typical needs |
| --- | --- | --- |
| PFA, PFI, II and liberal professions (freelancers, doctors, lawyers, architects) | Yes | Separating business and personal money, taxes and contributions, irregular income, equipment, a first credit line |
| Micro companies (SRL, roughly under 10 employees) | Yes | Cash flow, working capital, equipment and vehicles, unpaid invoices, state-guaranteed loans, EU funds |
| Small companies (roughly 10 to 49 employees) | Yes | Larger working capital and investment loans, leasing fleets, factoring, payroll timing, FX for imports and exports |
| Medium and large companies | No | Served by relationship managers; revisit after a pilot |

## How a session knows it's a business

- The login decides it: Raiffeisen business SSO opens the business track; a personal login opens the individuals track. Someone who has both sees a switch in the header ("Personal / Firma mea").
- Each business session carries a `businessProfile`: legal form, CUI, CAEN activity code, age of the business, VAT status, tax regime, turnover band, employees band, existing products. Logged-in customers get it from the bank's data; others answer a short questionnaire using ranges, never exact figures.
- The router can still detect business intent in the personal track ("I need a loan for my PFA") and offer to switch, since business and personal credit follow different rules.
- A PFA is a natural person, so personal-data rules and some credit rules can apply even in the business track; the spec flags each case.

## How business needs differ from individuals

The biggest difference is what drives the decision: for individuals it's personal income and the BNR debt-to-income cap; for businesses it's cash flow, turnover and the business's track record, and the consumer-credit protections mostly don't apply.

| Dimension | Individuals track | Business track |
| --- | --- | --- |
| Raiffeisen segment and channel | Retail; Smart Mobile app | "IMM și profesii liberale" (turnover under €5M, including PFA and PFI); Smart Business app and Raiffeisen Online IMM ([Raiffeisen IMM](https://www.raiffeisen.ro/ro/imm.html)) |
| Main question | Can I afford it, which route is cheapest? | Will my cash flow cover it, which route fits my cash cycle? |
| Affordability rule | BNR caps of 40% (lei) and 20% (FX) of net income | Those caps apply only to individuals' consumer and housing credit, not business loans; banks assess turnover, financial statements and cash flow instead ([Reg. 17/2012](https://www.avocatnet.ro/articol_31655/Regulamentul-BNR-nr-17-2012-unele-conditii-de-creditare.html)) |
| Consumer protections | OUG 50/2010: standard information form, 14-day withdrawal, early-repayment rules | Not applicable: a PFA borrowing for its business, or a company, isn't a "consumer" ([OUG 50/2010, art. 7](https://notari.pro/oug-50-2010-contractele-de-credit/art-7-obiect-domeniu-de-aplicare-si-definitii)) |
| Financing routes | Savings, personal loan, car loan, mortgage, leasing, cards | Overdraft, working-capital and investment loans, liberal-profession loans, EIF microfinance, leasing, factoring, business cards, guaranteed loans, EU-grant co-financing ([financing page](https://www.raiffeisen.ro/ro/imm/produse-si-servicii/finantare.html)) |
| Typical eligibility | Income, age, credit history | At least one closed financial year for most products; about 6 months of activity for EIF microfinance; turnover limits |
| State support | Rare | Guarantees from FNGCIMM (up to 80%) and the BID portfolio guarantee (70%, or 80% for women-led firms, start-ups and innovative companies, for loans granted by 31 Dec 2027) ([Raiffeisen, Dec 2025](https://www.raiffeisen.ro/ro/despre-noi/comunicate-de-presa/2025/raiffeisen-bank-romania-isi-extinde-capacitatea-de-finantare-a-imm-urilor-cu-1-miliard-de-lei.html)) |
| Data | Account data, stated income | Turnover, balance sheet, invoices, e-Factura, VAT status, CAEN code |
| Tax context | Income tax on salary, interest | Micro-enterprise or profit tax, PFA real or income-norm system, VAT, e-Factura, SAF-T; rules changed again for 2026 |
| How applying works today | Personal loans fully online in Smart Mobile | Accounts open online; loans start with an online lead form but are decided in a branch; leasing and factoring are applied for in a branch |
| Existing AI | None comparable | ERIC, an "AI Business Coach" in Smart Business, covering business plans, financial analysis and financing options ([ERIC](https://www.raiffeisen.ro/ro/imm/produse-si-servicii/servicii-electronice/eric-ai-business-coach.html)) |

Two findings shape the plan. Raiffeisen already runs **ERIC**, so Raiffy's business track should position itself as the step that turns ERIC-style guidance into compared financing routes, real numbers and a handoff to apply, or be designed together with the ERIC team. And since **no small-business loan is fully digital yet**, a guided route comparison that pre-fills the branch or online application is a clear gap Raiffy can fill.

## Shared core vs business-specific

Roughly two thirds of Raiffy is reused as is; the business track adds its own content and a few new blocks and tools.

| Component | Shared as is | Business-specific |
| --- | --- | --- |
| Safety gate | PII masking, crisis and fraud detection, injection checks | CEO and supplier fraud (fake invoice or changed IBAN), AML signals for business flows |
| Router | Same mechanism and schema | Its own pattern catalog (business patterns 1–11) |
| Orchestrator and subagents | Same mechanism | Business financing routes catalog; cross-goal decisions on cash flow instead of personal DTI |
| Evaluator | Same deterministic checks and loop | Business rubric: no tax or legal advice, guarantee-program accuracy, B2B comparison rules |
| Answer schema (envelope + blocks) | All 12 blocks | New blocks: `cashflow`, `invoices`, `fundingPrograms`, `taxCalendar` |
| Calculations | Calculator, commissions, comparison engine | Cash-flow forecast, working-capital need, leasing vs loan, guarantee-cost, business-debt service coverage |
| Data | Fee tables, source dates, freshness rules | Business product catalog, state-guarantee programs, funding calls, tax calendar, CAEN rules |
| UI | Palette, thinking panel, fade-in, sliders, source chips | Business dashboard view, invoice and cash-flow visuals, "Firma mea" switch |
| Commission transparency and financing-route rule | Yes, unchanged | Adds guarantee fees, factoring fees, leasing fees |
| Human verification | Yes | Routed to SME specialists or the relationship manager |
| Multilingual, accessibility, audit logs | Yes | — |

## Workstreams and build order

Build the shared core once, parameterized by track, then add business content on top. Everything below assumes the individuals track exists first.

1. **Track switch and business profile**: `track: "personal" | "business"` in conversation state, the `businessProfile` object, the "Personal / Firma mea" switch, and track-aware routing.
2. **Business data**: product catalog (credit lines, investment loans, leasing, factoring, cards, accounts) with all fees; state-guarantee and funding programs with eligibility and dates; competitor business offers; tax calendar. Each record dated and sourced, as in the individuals track.
3. **Business tools**: cash-flow forecast, working-capital need, loan vs leasing, guarantee cost, debt-service coverage, invoice financing cost.
4. **Business patterns and prompts**: the eleven business patterns, each with its own short prompt and block recipe.
5. **New UI blocks**: `cashflow`, `invoices`, `fundingPrograms`, `taxCalendar`, plus the business dashboard view.
6. **Rules and evaluator rubric**: business behavior rules, hard limits and the evaluator's business rubric.
7. **Evals**: business edge cases across PFA, micro and small companies, in several languages.
8. **Human verification routing** to SME specialists and relationship managers.

| | Hackathon | Production |
| --- | --- | --- |
| Segments | PFA and one micro-company persona | PFA, PFI, II, micro and small companies |
| Patterns | Working capital, equipment (loan vs leasing), cash-flow gap | All eleven |
| Data | Seeded demo catalog and one guarantee program | Live catalog, all programs, competitor data with freshness checks |
| Integrations | Mock business SSO | Business online banking, accounting and e-Factura data with consent |
| Demo moment | "My client pays in 60 days and I need to pay salaries": cash-flow gap, then factoring vs credit line vs overdraft | — |

## Risks and open questions

**Risks**

- **Tax advice creep.** Business owners will ask tax questions constantly (micro-enterprise thresholds, PFA regimes, VAT). Raiffy can explain how things work with dated sources, but advice belongs to an accountant; the evaluator must enforce this.
- **Fast-changing rules.** Tax thresholds and guarantee programs change often, sometimes yearly. Every such value lives in dated config with an owner, never in prompts.
- **Mixed personal and business money.** PFAs often blur the two; answers must say which rules apply (personal credit rules vs business credit) and why.
- **Data quality.** Small businesses' real numbers live in accounting software and e-Factura; without them, cash-flow answers rely on the owner's estimates and must say so.
- **Liability.** A wrong cash-flow forecast can hurt a business more than a wrong personal estimate; label forecasts as scenarios and keep a human-verification path.

**Open questions for Raiffeisen**

- Which business products and guarantee programs are in scope for a pilot?
- Can business online banking expose account and transaction data to Raiffy, and can customers connect accounting or e-Factura data?
- Who are the human reviewers for business answers: SME specialists, relationship managers, or both?
- Should the business track compare competitors at all, or only Raiffeisen's routes plus state programs?
- How should Raiffy's business track relate to ERIC, the AI Business Coach already in Smart Business: integrate, replace, or hand off between them?
