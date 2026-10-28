# Shared: Raiffy inside Smart Mobile

Most Raiffeisen customers already live in Smart Mobile. Raiffy opens inside the app with the customer already signed in, explains and compares, then **sends the customer to the app's own screens to act**. Raiffy explains, compares and pre-fills. Smart Mobile does everything regulated: applying, signing, paying and card actions.

This follows the hard limits (no payments, signatures or SMS codes inside Raiffy) and the handoff rules in `docs/shared/plan-summary-handoff.md`. Business customers get the same pattern in Smart Business later.

## Assumptions (POC)

- The customer **already has a Smart Mobile account and is signed in**. The mock has no onboarding, sign-in or account-opening screens.
- Opening Raiffy from the app never asks for a second sign-in: the app session is exchanged for a Raiffy session. This is what the Raiffeisen SSO button in `login.html` stands for. The exchange is simulated in the prototype; the real mechanism (an OIDC provider in Clerk, or a token exchange with the bank) is open.
- One design system: the mock app uses `DESIGN.md` tokens, type and components, not Raiffeisen's real app styling or logo. A text wordmark stands in for the logo, and the page is labelled as a prototype.

## The bridge

| Direction | How | Rule |
| --- | --- | --- |
| **Smart Mobile → Raiffy (launch)** | Opened with an `AppContext`: the screen and a reference to one object, for example `loanDashboard / loan_123` | The app passes a **reference, never data**. Raiffy reads the object through its own scoped tools, under the customer's "What Raiffy can see" switches. |
| **Raiffy → Smart Mobile (act)** | A `DeepLink` to an official screen: apply (pre-filled), card freeze, early repayment, an Inbox item | It only **opens** the screen. The customer reviews and confirms there. Raiffy never carries out an action. |
| **Smart Mobile → Raiffy (afterwards)** | `HandoffEvent`s: application started, submitted, approved, declined, offer expired | They update the plan summary's status and `CounterOfferLog.outcome` (`docs/shared/pricing.md`), and Raiffy shows the status in the chat. |
| **Continuity** | One conversation history per user in Convex | A chat started on the web continues in the app, and the other way round. |

**Opened from data that's switched off.** If Raiffy is launched from a screen whose data the customer hasn't allowed (a transaction while "transactions" is off), Raiffy asks "Let Raiffy see this transaction?" with *Allow once* and *Not now*. It never reads the object just because the customer was looking at it. *Allow once* covers that one object for that conversation and is logged.

## Where Raiffy appears

- **Home:** an "Ask Raiffy" bar above the tab bar, and the proactive cards below.
- **Contextual links:** "Ask Raiffy about this" on a transaction, a loan dashboard, the overdraft and a pre-approved offer. Each opens Raiffy with that context and a pre-generated first question ("Why was I charged this fee?", "Can I repay early?").
- **More:** a Raiffy entry, plus "What Raiffy can see".
- No floating bubble over content, and no tab of its own.
- Raiffy opens as a **full-height sheet** with a context chip ("From: Overdraft · 8,000 lei") and closes back to the screen it was opened from.

## Proactive cards

Short Raiffy cards on Home, shown **without marketing consent**. **Decision:** they count as service messages, because they're about the customer's own products and the costs they already pay. The full set of 10 cards, how the customer toggles through them, and what happens when they tap a card but don't act: `docs/shared/raiffy-recommendations/`. Examples:

- "Your overdraft cost 77 lei in interest in October. See cheaper ways to cover it?"
- "Your loan's fixed period ends in March. See what your payment could become?"
- "You paid 3 foreign card fees this month, 27 lei. See how to avoid them?"

Rules:

- **Only about products the customer already holds**, or a cost they're already paying, computed by the deterministic tools from data the switches allow. Never a promotion of a product they don't hold on its own; an answer may then compare routes, including new products, once the customer taps in, as any answer would.
- One card visible at a time; the customer swipes or uses arrows to move through the eligible ones ("2 of 6"). Each is dismissable, with "Not interested in this" and "Don't show these" (stored, and respected everywhere).
- Every figure shows its source and period, like any Raiffy number.
- No proactive cards in hardship or crisis mode, and none that encourage more borrowing.
- Tapping a card opens Raiffy with the card's context and question; nothing is shown about the customer to anyone else.

## The official flow (in the app, not in Raiffy)

Raiffy's "Apply in Smart Mobile" opens the official Flexicredit flow pre-filled with amount, term, product and the quote ID. Because the customer is already signed in, it goes straight to:

1. **Review:** the pre-filled figures, editable, with the figures matching Raiffy's quote to the cent.
2. **SECCI:** issued by the bank's systems, to read and download.
3. **15-day reflection period:** stated plainly before signing.
4. **Qualified e-signature:** an SMS code step (mocked).
5. **Submitted:** the status screen, which sends a `HandoffEvent` back.

Raiffy is absent from these screens and they use plainer styling, so the customer can see they've left the assistant. Card freeze and early repayment work the same way: the official screen, a confirmation by the customer, then an event back.

## Mobile layout of Raiffy answers

Same `Answer` blocks as `chat.html` (`docs/shared/answer-schema.md`), laid out for a 390px screen:

- Compare tables become **columns you swipe through**, one option per column, with the recommended one first and its badge.
- The thinking panel stays, folded by default once the answer is done.
- Follow-up suggestions are **tap chips** above the composer (Tab still works with a keyboard).
- The context panel ("What Raiffy can see") is a bottom sheet.
- Sliders and the simulator keep 44px touch targets.
- Shared chats (`docs/shared/shared-chats.md`) are shared through the native share sheet; members' data scope is unchanged.

## Data model

```ts
type AppContext = {
  screen: "home" | "transaction" | "loanDashboard" | "overdraft" | "offer" | "card" | "inbox";
  objectRef?: string;              // e.g. "loan_123"; a reference, never data
  suggestedQuestion?: string;      // pre-generated first question
  proactiveCardId?: string;        // set when launched from a Home card
};

type DeepLink =
  | { kind: "apply"; productId: string; amount: number; termMonths: number; quoteId: string }
  | { kind: "cardFreeze"; cardRef: string }
  | { kind: "earlyRepayment"; loanRef: string; amount?: number }
  | { kind: "inbox"; messageId: string };

type HandoffEvent = {
  quoteId?: string; deepLink: DeepLink["kind"];
  status: "opened" | "started" | "submitted" | "approved" | "declined" | "expired" | "abandoned"
        | "completed";             // a one-step action, like a card freeze or an early repayment
  at: string;
};

type ProactiveCard = {
  id: string; kind: string;        // one of the 10 kinds in docs/shared/raiffy-recommendations/
  figures: Record<string, number>; source: string; period: string;
  dismissedAt?: string;
};

type OneTimeAllow = { conversationId: string; objectRef: string; grantedAt: string };
```

## HTML prototype: `smart-mobile.html` (repo root)

- **Frame:** mobile-first. Full screen on a phone; a centred 390×844 device frame on desktop. Tab bar: Home, Accounts, Payments, Products, More.
- **Hash routes:**
  - `#home`: balance card, quick actions, recent transactions, a proactive card, the Raiffy bar.
  - `#transaction/:id`: detail with "Ask Raiffy about this".
  - `#loans`: loan dashboard with the repayment schedule and "Can I repay early?".
  - `#overdraft` and `#offers`: the overdraft, and a pre-approved offer card.
  - `#raiffy`: the Raiffy sheet, the mobile version of `chat.html`, with the context chip and the one-time allow prompt.
  - `#apply`: the official flow above, pre-filled.
  - `#card`: card controls, the target of the freeze deep link.
  - `#inbox`: the plan summary, delivered as a service message.
- **Demo path:** the overdraft card on Home → Raiffy compares the overdraft with a loan and recommends one → Apply in Smart Mobile → pre-filled review, SECCI, reflection notice, SMS code → submitted → the status shows in Raiffy and the summary in the Inbox.
- Mock data inline in the shapes above; amounts and the 249 lei fee match `chat.html`. Reuse `chat.html` classes (`.rec-badge`, `.think`, `.chip`) so the components are shared at conversion.
- Converts to the Next.js POC as a mobile layout of the chat route plus the mock app routes; the real app integration replaces the mock app.

## Evals

| Check | Source |
| --- | --- |
| A deep link's amount, term and product match the quote to the cent | The bridge |
| No action (apply, freeze, repayment) happens without the customer's confirmation in the app | The bridge; hard limits |
| A context launch reads only the referenced object, and only if its switch is on or allowed once | The bridge |
| Launched from switched-off data, Raiffy asks for a one-time allow and reads nothing before it | The bridge |
| Status events update the plan summary and the counter-offer log | The bridge; `docs/shared/pricing.md` |
| Proactive cards only cover held products or costs already paid, respect "Don't show these", and never appear in hardship or crisis mode | Proactive cards |
| Raiffy is never shown inside the official flow screens | The official flow |
| A shared chat opened in the app keeps its members' data scope | `docs/shared/shared-chats.md` |

## Check with compliance

- Confirm the decision that proactive cards are service messages under Law 506/2004 and GDPR, including when a card leads to an answer that compares new products.
- The legal basis for computing cost insights from transaction data without a request from the customer.
- What the app-to-Raiffy session exchange must log, and how long.
