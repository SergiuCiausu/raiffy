# 01 · Overdraft cost

| Field | Value |
| --- | --- |
| Kind | `overdraftCost` |
| Needs | `account` |
| Trigger | Overdraft interest of at least 30 lei in each of the last 2 months |
| Card | "Your overdraft cost **77 lei** in interest in October. You've used about 8,000 lei of it since August." |
| Source | From your October statement |
| Button | See cheaper ways |
| Opens Raiffy with | "My overdraft cost 77 lei last month. Is there a cheaper way?" |
| Answer | Scope `solution`: at least three routes, one recommended. Keep the overdraft and clear it on a plan; move it to a personal loan with a fixed payment; lower the limit once it's cleared so it costs less to hold. |
| Can lead to | Apply for a personal loan (`apply`), the overdraft screen |
| Checks | Affordability before showing a loan route |
| Retires when | The overdraft has been under 1,000 lei for a full month |
| Demo figures | 8,000 of 10,000 lei used · 11.5% variable · 76.67 lei in October |

The live prototype currently shows two of the three routes (keep the overdraft or take the loan). Add the repayment-plan route when the card set is built.
