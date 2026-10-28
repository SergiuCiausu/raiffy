# 06 · Fixed-rate period ending

| Field | Value |
| --- | --- |
| Kind | `fixedPeriodEnding` |
| Needs | `loans` |
| Trigger | A loan's fixed-rate period ends within 6 months |
| Deadline | The end of the fixed period · last notice 30 days before |
| Card | "Your mortgage's fixed rate ends in **March 2027**. At today's rates, your payment would go from 1,957 lei to about **2,340 lei**." |
| Source | From your mortgage and IRCC as of 28 Oct |
| Button | See what your payment could become |
| Opens Raiffy with | "My fixed rate ends in March. What happens to my payment?" |
| Answer | Scope `solution`: move to the variable rate, fix again for a new period, or make a partial early repayment to lower the payment, with the payment for each shown as a range, not a promise. A competing offer goes through pattern 11 (`docs/shared/pricing.md`). |
| Can lead to | Refix request (official flow), early repayment (`earlyRepayment`), specialist review |
| Checks | Affordability: the new payment against income and obligations, stated plainly if it's tight |
| Retires when | The fixed period ends or a new fixed rate is agreed |
| Demo figures | 270,000 lei left · 18 years left · 5.4% fixed until 15 Mar 2027 (1,957 lei) · IRCC 5.66% + 2.2% margin (2,340 lei) · refix 6.6% for 5 years (2,139 lei) · repay 20,000 lei then variable (2,166 lei) |
