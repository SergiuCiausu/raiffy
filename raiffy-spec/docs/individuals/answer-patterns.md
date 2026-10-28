# Individuals: Answer patterns

Eleven reusable answer structures that cover most customer questions in any domain: cars, homes, education, weddings, travel, health costs. The router (see `docs/shared/pipeline.md`) picks one pattern per goal; the tools listed in each pattern supply the numbers. Domain specifics (a car's age limit for leasing, a flat's notary fees) come from small per-domain packs of cost tables, eligibility rules and safety tips.

## Core rule: the answer scope follows the question

The router classifies every money question into one of three **answer scopes**, and the number of options shown follows it:

| Scope | When | What the answer shows |
| --- | --- | --- |
| `compare` | The customer names the options ("Overdraft or personal loan?") | Exactly the options they named, side by side, with one recommended and why |
| `solution` | The customer describes a goal or a problem ("I need 8,000 lei for a car repair") | **At least three routes** side by side, including not borrowing (using savings, or saving longer), with one recommended and why |
| `detail` | The customer asks about one specific product ("How does early repayment work on my loan?") | Details of that product only. The answer **ends with one question** that invites the customer to go deeper into this product or to explore a related Raiffeisen solution, whichever fits what was just said |

For each route shown, the answer gives the monthly cost, total cost, time to reach the goal, eligibility and the main risk, then says which route fits best given their stated priorities and why, and where a competitor's route would be cheaper. Outside the `detail` scope, no answer ends with a single product.

Every answer also carries 2 or 3 **pre-generated follow-up replies** (in `actions[]`) that the customer can send with Tab and Enter; see `DESIGN.md` → Follow-up suggestions. In the `detail` scope, one goes deeper into the same product and one opens a related Raiffeisen solution.

Each route in the comparison also lists **every commission and hidden cost** (origination, administration, early repayment, mandatory insurance, required packages, FX spreads), or states explicitly that there are none. Monthly and total costs always include them.

## Financing routes the comparison tool knows

| Route | Typical use |
| --- | --- |
| Own savings or saving longer | Any goal; always the baseline |
| Down payment plus a smaller loan | Large purchases |
| Personal loan (nevoi personale) | Flexible purpose, unsecured |
| Purpose loan (car loan, mortgage, home improvement) | Specific assets, usually cheaper |
| Leasing | Vehicles and equipment, subject to asset rules |
| Credit card instalments or BNPL | Small purchases, short terms |
| Overdraft | Short cash gaps only |
| Refinancing or consolidation | Existing debt |
| Term deposits, savings accounts, state bonds, investment funds | Saving toward a goal (funds informational only) |

## 1. Purchase goal

Triggers: "I want to buy a 2016 BMW X5", "a flat in Cluj", "a new laptop", "I'm planning a wedding".

1. **Size the goal**: use the price they give; otherwise offer a dated market range labeled as an estimate.
2. **Compare financing routes** for that amount, including savings and a down-payment mix; check asset rules (e.g., vehicle age for leasing or car loans).
3. **Check affordability**: indicative DTI against BNR caps, monthly payment, total cost, rate-stress scenario.
4. **Show total cost of ownership**: running costs from the domain pack (insurance, taxes, maintenance; for homes, notary, valuation, utilities).
5. **Safety tips and next step**: domain-specific scam warnings, documents needed, link to apply or talk to an adviser. No seller listings.

Tools: price-range lookup, comparison, calculator, DTI check, TCO calculator.

## 2. Product comparison

Triggers: "Is your loan better than BT's?", "card A or card B?", "which savings account?"

Raiffy is openly Raiffeisen's assistant: it favors Raiffeisen through ordering, personalization and counter-offers, never by hiding or skewing the comparison.

1. **Be upfront**: "I'm Raiffeisen's assistant, so I'll start with our options, and I'll be straight with you about how others compare."
2. Confirm the customer's amount, term and priority (lowest monthly, lowest total, flexibility).
3. **Lead with the best-fitting Raiffeisen option**, in full detail, with relationship pricing, package discounts and pre-approved offers applied for existing customers.
4. **Show the full comparison** with competitors below it: same fixed metric set, all commissions included, source and date per figure.
5. **Say plainly where each option wins.** If Raiffeisen wins or ties, highlight its real non-price strengths (no-commission products, app, branches, approval speed, no switching costs). If a competitor is cheaper, say so and offer to check what Raiffeisen can do ("Want me to see if we can do better?"), which continues as pattern 11.
6. Recommend the best fit for the customer's priority, with the reason; on a cost tie, Raiffeisen may be recommended with the tie-breaker stated.
7. For general questions ("which loan should I get?"), compare Raiffeisen's own routes first and bring in competitors when the customer asks or when it changes the answer.

Never: omit a cheaper competitor the customer asked about, drop metrics where a competitor wins, rank by margin, or use wording that belittles competitors.

Tools: comparison, calculator, relationship pricing and pre-approved offers from account data, adviser booking. Evals check that a cheaper competitor is always disclosed and that the offer to continue into pattern 11 follows it.

## 3. Affordability check

Triggers: "Can I afford a 300,000 lei mortgage?", "Is 2,000 lei a month too much?"

1. Gather income, existing obligations and the target payment or amount (from account data where available).
2. Run the indicative DTI check and a rate-stress scenario.
3. Show the monthly buffer left after essentials.
4. **Compare routes that change the answer**: bigger down payment, longer term (with its higher total cost), smaller amount, saving for N more months.
5. State clearly that it's an estimate and the bank's assessment decides.

Tools: DTI check, calculator, account data.

## 4. Debt management and refinancing

Triggers: "I have three loans and a maxed card", "Should I refinance?", "Can I pay off early?"

1. Map existing debts: balance, rate, monthly payment, remaining term.
2. **Compare routes**: keep as is, refinance, consolidate, prepay the most expensive first, renegotiate.
3. Show monthly and total savings for each, including fees for early repayment or refinancing.
4. If there are distress signals, switch to the hardship flow instead of offering new credit.
5. Next step: apply, book an adviser, or contact the restructuring team.

Tools: debt map from account data, calculator, comparison, distress classifier.

## 5. Saving and goal planning

Triggers: "I want 20,000 lei for a car in 2 years", "saving for my child's university", "emergency fund".

1. Define the goal amount and date.
2. Calculate the monthly saving needed.
3. **Compare saving routes**: savings account, term deposit, state bonds, investment funds (informational only), and borrowing later instead, with expected return, real return after inflation, liquidity and risk.
4. Mention the €100,000 deposit guarantee where relevant.
5. Offer to set up an automatic transfer or book an investment adviser.

Tools: savings calculator, inflation data, product catalog, FGDB source.

## 6. Explain a term or product

Triggers: "What is DAE?", "How does IRCC work?", "What's a term deposit?"

1. One-sentence plain definition.
2. A worked example with realistic numbers from the calculator.
3. What it means for this customer's products or plans, if known.
4. Where relevant, how it changes the comparison between financing routes (e.g., why APR matters more than the interest rate).
5. Link to the official source.

Tools: glossary in RAG, calculator.

## 7. Fees, charges and statements

Triggers: "Why was I charged 15 lei?", "What's this transaction?", "Why did my rate go up?"

1. Identify the item from account data.
2. Explain the rule behind it, citing the T&C or fee document.
3. **Compare routes to avoid or reduce it**: a different package, channel or product, with the cost difference.
4. If it looks wrong, open a complaint ticket with a reference number.
5. If it looks like fraud, switch to pattern 10.

Tools: account data, fee table, T&C retrieval, complaint ticketing.

## 8. Life event

Triggers: "We're having a baby", "I'm moving to Cluj", "I'm retiring", "I lost my job", "getting divorced".

1. Acknowledge the event with the right tone; job loss or divorce may trigger the hardship flow.
2. Checklist of financial impacts (income change, new costs, documents, deadlines).
3. **Compare financing routes for the main new costs** or income gaps, including savings and payment holidays where available.
4. Relevant protections (e.g., extra deposit cover after a home sale or retirement).
5. Refer out where needed (tax, legal, state benefits) and offer an adviser.

Tools: domain pack per event, calculator, comparison, FGDB source.

## 9. Cash shortfall or emergency

Triggers: "I need 3,000 lei urgently", "My car broke down", "Short until payday".

1. Check for distress signals first.
2. **Compare short-term routes**: emergency savings, overdraft, credit card, personal loan, deferring the expense, with cost for the actual days or months needed.
3. Recommend the cheapest safe route and show its total cost.
4. Warn about expensive or predatory lenders and scams promising instant loans.
5. Offer a plan to rebuild an emergency fund.

Tools: account data, calculator, comparison, distress classifier.

## 10. Problem, security or complaint

Triggers: "My card is blocked", "I don't recognize this payment", "Someone called from the bank", "I'm unhappy with…"

1. **Act first** where safety is at stake: card freeze, fraud line, stop instructions.
2. Explain what happened in plain language, as far as allowed (never mention AML reviews).
3. Open a ticket with reference number and expected response time.
4. Explain escalation options (CSALB, ANPC) after the bank's own process.
5. Offer a human immediately.

Tools: card freeze path, ticketing, scam scripts, human handoff.

## 11. Negotiation and counter-offer

Triggers, at any point in a conversation:
- **Mid-conversation**, after Raiffy has shown a price: "Can you do better?", "That's too expensive", "BT offers less", "Is this rate negotiable?"
- **As the first message**: "I've seen your personal loan, but BT's is cheaper. Can you tell me the differences and make me an offer?"

Full rules, data shapes and bands: `docs/shared/pricing.md`.

1. **Set the baseline.**
   - **Mid-conversation:** the quote already shown (product, amount, term, price version) becomes the baseline from conversation state, so nothing is asked again.
   - **First message:** the answer scope is `compare` (exactly the Raiffeisen product and the competitor named). Amount and term come from the competitor's SECCI if uploaded; otherwise ask one question for both.
2. **Be upfront:** "I'm Raiffeisen's assistant, so I'll be straight with you about how the offers compare, and I'll check what we can do on price."
3. **Ask for evidence.** Use competitor data from official documents in the store, or ask the client to upload the competitor's SECCI (ESIS for a mortgage). The client confirms the extracted figures. On a typed claim alone, compare against that bank's published standard rates, labelled as published, ask for the SECCI, and make no counter-offer yet.
4. **Compare total cost first:** DAE and total amount payable, with every fee, mandatory insurance and required package on both sides, same amount and term. Say plainly where each offer wins. If the competitor's offer costs more in total, say so and stop: no counter-offer is needed.
5. **Counter-offer or escalate.**
   - **Known clients inside the band:** clients the bank already has a risk view of (an existing pre-approval, or a risk band from account data) get an automatic counter-offer from the pricing tool, using only the levers in the pre-approved band for their product and segment (fee waivers first, then a small margin cut). It shows what changed, its conditions on the card ("with salary transfer"), its validity (7 days by default, or the band's own), and that it's indicative until the bank issues the offer.
   - **Above the band, or no risk view yet:** "A specialist can review this." With the client's agreement, send the case with the competitor offer attached to the right approval level. Show the review status. Clients without a risk view are shown the list price, labelled "indicative, subject to assessment".
6. **Close the loop:** log the counter-offer and its outcome. A specialist's decision returns to the chat as a personal offer with their name and expiry. Follow-ups: "Upload the BT SECCI", "What if I move my salary?", "Ask a specialist to review this".

Rules:
- **Asking again doesn't lower the price.** After a counter-offer, "lower?" gets the same offer and the option to escalate, never a second, deeper cut. Price never depends on persistence.
- **Affordability before any discount.** Run the affordability check first; a counter-offer never makes borrowing the client can't afford look attractive. In hardship or crisis mode, no counter-offers at all.
- Never promise a price, never say a specialist will match an offer, never reveal or hint at band limits, and never denigrate the competitor.

Tools: comparison, SECCI extraction, calculator, pricing (relationship pricing, bands), affordability check, counter-offer log, specialist escalation.

## Testing the patterns

For each pattern, add 5 to 10 eval cases across different domains, and check three things: the right pattern was picked, every step appears, and the **answer scope** was picked correctly with the matching number of options (the named options, at least three routes, or one product ending with a follow-up question). A wrong option count fails the eval.

Block recipes per pattern (which UI blocks each pattern renders) are in `docs/shared/answer-schema.md`.
