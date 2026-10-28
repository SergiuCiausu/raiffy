# 08 · Early repayment becomes free

| Field | Value |
| --- | --- |
| Kind | `earlyRepaymentFree` |
| Needs | `loans`, `savings` |
| Trigger | A personal loan enters its last 12 months within 30 days, so early repayment stops costing a fee, and the customer's savings cover the balance with at least 3 months of usual spending left over |
| Deadline | The date the fee stops · shown on that date, no earlier notice |
| Card | "From **15 Dec**, repaying your personal loan early has no fee. Repaying the **4,200 lei** left would save about **217 lei** in interest." |
| Source | From your loan and repayment schedule |
| Button | See what repaying early saves |
| Opens Raiffy with | "Should I repay my loan early from 15 Dec?" |
| Answer | Scope `solution`: repay in full, repay part, or keep paying as planned, with interest saved and what's left in savings for each. Recommends keeping the savings buffer intact. |
| Can lead to | Early repayment (`earlyRepayment`) |
| Checks | Never suggests using money below the 3-month buffer |
| Retires when | The loan is repaid, or 60 days after the fee stops |
| Demo figures | Balance 4,200 lei · 12 instalments of 368 lei left at 9.4% · repay in full saves 217 lei, half saves 108 lei · savings 21,000 lei |
