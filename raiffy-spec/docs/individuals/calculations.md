# Individuals: Calculations

**Layer:** deterministic, unit-tested functions and data rules. The agent calls them and explains the results; the LLM never does the math.

## Inputs and parsing

| Solution | Source |
| --- | --- |
| Deterministic amount parser ("10.000", "10k", "zece mii"), RON by default; calculate right away, and the result states the amount used ("For 10,000 RON over 5 years…") so a misread is visible and correctable | EC · Language |
| Resolve relative dates against the server date and state the absolute date | EC · Language |
| Conversation state object; recompute every figure when parameters change | EC · Ambiguity |

## Loans and credit

| Solution | Source |
| --- | --- |
| Indicative DTI check: 40% RON, 20% FX, +5 pp first home, labeled "indicative" | EC · Personalization; Auth · BNR Reg. 17/2012 |
| Joint loans include all borrowers' incomes in the DTI check | EC · Personalization |
| Variable-rate stress scenario (+2 pp) and FX depreciation impact next to every estimate | EC · Product data; Auth · BNR Reg. 17/2012 |
| Fixed and variable periods modeled separately for mortgages | EC · Product data; Auth · OUG 52/2016 |
| Calculator returns monthly payment, total payable, total interest and APR (DAE) | EC · Calculations; Auth · OUG 50/2010, CCD2 |
| Early repayment by date and amount, with the product's fee rules | EC · Calculations |
| Total cost for the customer's actual inputs, with the break-even point when rankings flip | EC · Personalization |
| Flag loans whose cost approaches legal caps | Auth · Law on total cost of credit |
| Decimal arithmetic only, matching the bank's calculator to the cent | EC · Product data |

## Products, fees and comparisons

| Solution | Source |
| --- | --- |
| Every quote stores catalog version and timestamp; re-check at application | EC · Product data |
| Promo and standard rates both returned, with conditions as structured fields | EC · Product data |
| Fee table keyed by product, package and channel | EC · Product data |
| Eligibility rules filtered by the authenticated profile | EC · Product data |
| EUR and RON shown together for FX products | EC · Product data |
| Fixed metric set for every product in a comparison | EC · Bias; Auth · Law 158/2008 |
| Comparability rules: category, term range, currency and insurance inclusion must match | EC · Competitor data |
| "From" rates stored as ranges with a `min_only` flag | EC · Competitor data |
| Source precedence: official standardized documents over websites | EC · Competitor data |
| Ranking by customer cost and fit, never by margin | EC · Bias |
| `last_verified_at` on every record, with a freshness limit per source | EC · Competitor data |
| Fee schema with an explicit value for every fee type (0 = confirmed none, empty = unknown); the comparison tool returns a commissions list per route plus a `has_no_commissions` flag that is true only when every fee is confirmed 0 and fresh | Commission transparency rule |

## Savings and deposits

| Solution | Source |
| --- | --- |
| Nominal and real return using the latest official inflation figure | EC · Calculations |
| Deposits summed per depositor against the €100,000 limit, joint balances split per holder | EC · Calculations; Auth · Law 311/2015 |
| Tax rates kept as config values with their legal source | EC · Calculations |

## Plan summary structure

| Solution | Source |
| --- | --- |
| Structure the plan summary like the official documents: main features, amount, total cost, DAE, number and frequency of instalments, all commissions, an indicative repayment schedule table (date, principal, interest, fees, remaining balance), and the operator's signature when verified | SECCI structure; Raiffeisen loan documents |
