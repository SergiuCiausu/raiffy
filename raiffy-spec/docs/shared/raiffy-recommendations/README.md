# Raiffy recommendations ("From Raiffy" cards)

The proactive cards on Smart Mobile Home (`docs/shared/smart-mobile.md` → Proactive cards). Each file in this folder defines one card: what triggers it, what it says, where its button leads and when it retires. This README holds the rules they all share, how the customer toggles through them, and what happens when the customer taps a card's button but then doesn't act.

| # | Card | Kind | Deadline-driven |
| --- | --- | --- | --- |
| 01 | [Overdraft cost](01-overdraft-cost.md) | `overdraftCost` | No |
| 02 | [Other banks' ATM fees](02-atm-fees.md) | `atmFees` | No |
| 03 | [Card payments in other currencies](03-fx-card-fees.md) | `fxCardFees` | No |
| 04 | [Money sitting idle](04-idle-cash.md) | `idleCash` | No |
| 05 | [Term deposit about to renew](05-deposit-maturing.md) | `depositMaturing` | Yes |
| 06 | [Fixed-rate period ending](06-fixed-period-ending.md) | `fixedPeriodEnding` | Yes |
| 07 | [Account package fit](07-package-fit.md) | `packageFit` | No |
| 08 | [Early repayment becomes free](08-early-repayment-free.md) | `earlyRepaymentFree` | Yes |
| 09 | [Card subscriptions](09-subscriptions.md) | `subscriptions` | No |
| 10 | [Credit card annual fee](10-credit-card-fee.md) | `creditCardFee` | Yes |

## Rules every card follows

- **Service messages, no marketing consent.** Every card is about a product the customer already holds or a cost they already pay (the decision in `docs/shared/smart-mobile.md`). A card never promotes a product on its own. Once the customer taps in, the answer may compare routes, new products included, like any other answer.
- **Only from allowed data.** A card's figures are computed by the deterministic tools from the switches the customer has on ("What Raiffy can see"). If a card needs a switch that's off, it isn't computed and doesn't show. Raiffy never asks to turn a switch on just to show a card.
- **Every figure has a source and a period**, shown on the card ("From your October statement").
- **Honest copy.** Plain and calm: no countdowns, no "you're losing money", no exclamation marks, no red. A deadline is stated as a date.
- **Never in hardship or crisis mode**, and never a card that encourages borrowing more. A card that could lead to borrowing (01, 06) runs the affordability check before it's shown.
- **Suppressed while the solution is already in progress**: an open application, an escalated counter-offer or a specialist review for the same product hides that card.
- Each card's definition (copy, thresholds, priority) is versioned data, edited in the console like the catalog (`docs/shared/console.md`), with `validFrom`, `owner` and `reviewBy`.

## Toggling through the cards

- **One card is visible at a time.** The customer moves through the eligible ones with a swipe or the arrow buttons, with a "2 of 6" counter. Only cards whose trigger is true for this customer are in the set, so most people see fewer than 10.
- **Order:** deadline-driven cards first, soonest deadline first; then by the yearly amount at stake, highest first. A card the customer has already opened and come back from (see below) goes to the end.
- Each card has a dismiss (×) and, under it, "Not interested in this" and "Don't show these". The More screen has the "Raiffy cards on Home" switch.
- Accessibility: the arrows are real buttons with labels ("Next Raiffy card"), the counter is announced politely ("Card 2 of 6, Term deposit about to renew"), and swiping is never the only way to move. Under reduced motion, cards change with a fade.
- **Prototype:** `smart-mobile.html` uses each card's demo figures and treats every trigger as true, but still respects the switches: with the default switches (transactions and cards off) Home shows 4 cards, and turning both on shows all 10. The desktop side panel says how many are shown and why. "Didn't act" is recorded when Raiffy is closed or the official screen is left, instead of after 30 minutes. In the POC only cards whose trigger is true show.

## When the customer taps the button but doesn't act

The button always opens Raiffy with the card's context and opening question (`AppContext` with `proactiveCardId`). From there, the customer can stop at three points:

| Where they stop | What it looks like |
| --- | --- |
| **A. In the chat** | Read the answer, didn't tap a handoff (Apply, Freeze, Repay…) and didn't ask anything else |
| **B. In the official flow** | Tapped the handoff, opened the Smart Mobile screen, left before submitting or confirming |
| **C. Chose "Decide later"** | In the official flow's reflection step |

"Didn't act" is recorded when the app session ends, or after 30 minutes without activity in that chat.

### What Raiffy does

1. **Nothing is chased.** No push notification, email, SMS or Inbox message about an abandoned card or chat, ever. The customer chose to look; they also get to choose not to.
2. **The chat keeps its place.** The conversation stays in the customer's history with its figures. Reopening Raiffy continues the same thread, under a divider ("Back from your Raiffy card · 2 Nov"), and never starts over.
3. **Figures carry their validity.** An indicative quote from a card is valid for 7 days (as for counter-offers in `docs/shared/pricing.md`), and the answer says so ("These figures are valid until 4 Nov"). After that, or if a rate or fee changed, the old figures are marked "Out of date" and Raiffy recomputes them the next time the chat is opened. It never re-shows a stale number as current.
4. **The card comes back once, then rests.**
   - After A or B, the card returns to the end of the Home set **once**, reworded as a continuation: "You looked at this on 28 Oct. Your figures are saved." with "Continue" (opens the same thread) and "Not interested".
   - If that one return is ignored too, the card rests for **30 days**.
   - After 30 days it can come back as a fresh card only if its trigger still holds **and** its figures have changed meaningfully (the amount at stake has grown by at least 25%), or a deadline is now within the card's notice window.
5. **Deadlines get one notice, not a series.** For deadline-driven cards (05, 06, 08, 10), the rest is cut short only for a single last notice inside the card's notice window (for example 7 days before a deposit renews), stated as a date. Then the card retires when the deadline passes.
6. **The official flow keeps its own state.** After B, Smart Mobile keeps whatever its draft or saved-application behavior is; Raiffy doesn't add reminders. The chat shows the status from the `HandoffEvent` ("You left the application before signing. Nothing was submitted."), and after C: "The offer stays valid until 12 Nov."
7. **"Not interested" means it.** That card kind rests for 90 days for this customer. "Don't show these" turns all cards off until the customer turns them back on.
8. **Persistence changes nothing.** Coming back to a card, tapping it several times or abandoning it never changes a price, a counter-offer or a recommendation (same rule as pattern 11), and never makes the wording more urgent.
9. **Retirement.** A card retires for good when its trigger stops being true (the overdraft is cleared, the deposit renewed, the fee paid), when the customer acts on it (`submitted` or `completed`), or after 3 returns in total.

### What's logged

Every card has a log row per customer, used to tune ranking and thresholds, never to push harder.

```ts
type RecommendationCard = {          // the definition, versioned in the console
  kind: string;                      // "overdraftCost"
  needs: ("account" | "transactions" | "offers" | "loans" | "cards" | "savings")[];  // switches required
  trigger: string;                   // tool + threshold id, e.g. "overdraftInterest.monthly >= 30"
  deadline?: { field: string; noticeDays: number };
  copyKey: string; ctaKey: string; questionKey: string;
  leadsTo: string[];                 // product or action ids the answer may hand off to
  validFrom: string; owner: string; reviewBy: string;
};

type RecommendationInstance = {      // one per customer per card
  kind: string; userId: string;
  figures: Record<string, number>; source: string; period: string;
  validUntil: string;                // 7 days after the figures were computed
  status: "eligible" | "shown" | "opened" | "answered" | "handoffOpened" | "started"
        | "acted" | "returned" | "resting" | "retired" | "dismissed" | "notInterested";
  timesShown: number; returns: number;
  restingUntil?: string;
  conversationId?: string;           // the thread the card opened
  quoteId?: string;
  outcome?: "acted" | "ignoredInChat" | "leftOfficialFlow" | "decideLater" | "notInterested" | "expired";
  updatedAt: string;
};
```

- **KPIs** (in the console): cards opened per card shown, actions per card opened, the share of each stop point (A, B, C), "Not interested" rate per card kind, and money saved where it can be measured (for example ATM fees in the month after the card versus before).
- A card kind with a high "Not interested" rate is flagged for review in the console instead of being shown more.

## Evals

| Check | Source |
| --- | --- |
| A card never shows when a switch it needs is off | Rules |
| No card in hardship or crisis mode; borrowing-related cards pass affordability first | Rules |
| A card is hidden while an application or review for the same product is open | Rules |
| Deadline cards come first, soonest first; then by amount at stake | Toggling |
| An abandoned card sends no notification, email, SMS or Inbox message | When the customer doesn't act · 1 |
| Reopening continues the same thread; figures older than 7 days are marked out of date and recomputed | 2, 3 |
| A card returns at most once after being abandoned, then rests for 30 days | 4 |
| A deadline card gets at most one last notice inside its notice window | 5 |
| "Not interested" hides that kind for 90 days | 7 |
| Returning to a card never changes its price, recommendation or wording urgency | 8 |
| Every card figure matches its tool to the cent and shows its source and period | Rules |
