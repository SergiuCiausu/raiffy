# 09 · Card subscriptions

| Field | Value |
| --- | --- |
| Kind | `subscriptions` |
| Needs | `transactions`, `cards` |
| Trigger | A recurring card payment went up in price, or a new one started, this month |
| Card | "You pay **6 subscriptions** with your card, **186 lei** a month. One went up this month, from 49 to 59 lei." |
| Source | From your card payments, May to October |
| Button | Review my subscriptions |
| Opens Raiffy with | "Which subscriptions am I paying for?" |
| Answer | Scope `detail`: the list with each amount, when it started and any change in price, plus the yearly total. Raiffy doesn't judge which ones are worth it. Ends with a question about one to look at closer. |
| Can lead to | Card controls (block a merchant), the merchant's own cancellation page |
| Retires when | No new subscription or price change for 3 months |
| Demo figures | 6 subscriptions · 186 lei/month · the streaming one up from 49 to 59 lei on 12 Oct |

Blocking a merchant in card controls doesn't cancel the contract with that merchant; the answer says so.
