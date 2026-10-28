# 10 · Credit card annual fee

| Field | Value |
| --- | --- |
| Kind | `creditCardFee` |
| Needs | `cards`, `transactions` |
| Trigger | A credit card's annual fee is due within 30 days and the card was used fewer than 5 times in the last 12 months |
| Deadline | The fee date · last notice 7 days before |
| Card | "Your credit card's **150 lei** annual fee is due on **1 Dec**. You've used it twice this year." |
| Source | From your card and card payments |
| Button | Keep it or close it? |
| Opens Raiffy with | "Is my credit card worth its 150 lei fee?" |
| Answer | Scope `compare`: keeping it (the fee, the grace period, its benefits) or closing it (no fee, and what changes, such as losing a backup line of credit). If the card has a balance, that comes first: how to clear it and what it costs. |
| Can lead to | Close the card (official flow or branch), card settings |
| Retires when | The fee is charged or the card is closed |
| Demo figures | Annual fee 150 lei on 1 Dec · 2 payments this year · no balance |
