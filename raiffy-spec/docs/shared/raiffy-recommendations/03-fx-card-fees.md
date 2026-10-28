# 03 · Card payments in other currencies

| Field | Value |
| --- | --- |
| Kind | `fxCardFees` |
| Needs | `transactions`, `cards` |
| Trigger | At least 25 lei in currency conversion costs in a month |
| Card | "You paid about **31 lei** to convert currency on card payments in October, on 1,240 lei spent in euros." |
| Source | From your October transactions |
| Button | See what it cost |
| Opens Raiffy with | "How much do I pay to use my card in another currency?" |
| Answer | Scope `detail`: how the conversion is charged, the difference when a shop or ATM offers to charge in lei (dynamic currency conversion), and when a euro account would cost less. Ends with a question about upcoming trips or regular euro payments. |
| Can lead to | Open a euro account (official flow), card settings |
| Retires when | Under 10 lei of conversion costs for 2 months in a row |
| Demo figures | 1,240 lei in EUR payments · 6 payments · Vienna, 14–17 Oct |
