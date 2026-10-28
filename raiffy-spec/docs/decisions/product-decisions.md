# Product decisions (from the planning conversation)

These decisions were agreed while planning Raiffy but aren't fully covered by the spec files. Treat them as requirements unless a spec file says otherwise.

## Name and positioning

- The app is called **Raiffy**: Raiffeisen Bank Romania's AI financial assistant, openly favoring Raiffeisen while staying honest about competitors.
- Two tracks: **individuals** and **businesses** (PFA, freelancers, micro and small companies), on one shared core.

## Tech stack (Next.js, Convex and Clerk are locked for the POC; see `../../../CLAUDE.md`)

- Frontend: React (Next.js), Vercel AI SDK for streaming text and generative UI, Framer Motion, Recharts or Visx.
- Backend: Convex for data, reactive queries, scheduled jobs and vector search (RAG). It is the only database and vector store for the POC.
- Auth: Clerk for sign-in, user management and roles (app roles in user metadata, Clerk Organizations for business accounts).
- Schemas: TypeScript plus Zod, shared between backend and frontend.
- Evals and red teaming: promptfoo in CI.
- Hosting: EU region for the LLM endpoint, database and logs.

## No fine-tuning

- Don't fine-tune the LLM. Behavior comes from the system prompt, per-pattern prompts, tools, RAG, guardrails and evals, all of which can change in minutes.
- The spec files are the source of truth for **requirements**. They are never the source of truth for **facts**: rates, fees, product terms, competitor data, tax values and law text live in the product database, the RAG store and dated config, each with its own date and source.

## Knowledge and RAG

- **Three layers:** a structured product catalog (the source of truth for numbers), a document store for explanations (T&C, FAQs, product sheets) searched with vector plus keyword search, and a comparison engine that computes advantages and disadvantages from the catalog.
- **Regulations are translated, not retrieved.** Laws become rules in code, prompts and evals; raw legal text is not put into the customer-facing RAG.
- **Competitor data** comes from official standardized documents (SECCI, Fee Information Documents, ESIS, PRIIPs KIDs), with `last_verified_at` and a freshness limit (e.g., 30 days); stale data is excluded from comparisons.
- **FAQs:** one record per question and answer; embed the question plus 3–5 paraphrases (Romanian with and without diacritics, informal, English) pointing to the same FAQ; rich metadata (language, category, productIds, version, validFrom, lastReviewedAt, approvedBy, isActive); numbers never written into FAQ answers, they come from the catalog; very high similarity returns the approved answer almost verbatim; no match means "I don't know" plus a human; log unanswered questions.
- Graphify or similar code-graph tools may help developers explore source documents, but are not part of the production retrieval layer.

## Login, consent and marketing

- **Login is required** to use Raiffy. Sign-in options in this order: Raiffeisen SSO (verified customers, real data), Google or Apple, email magic link. In the POC the Raiffeisen SSO button is a placeholder that does nothing yet; Google, Apple and the magic link go through Clerk.
- **Marketing consent is separate from login** and never a condition of access: one unticked checkbox ("I'd like to receive personalised offers from Raiffeisen" in the English POC; "Vreau să primesc oferte personalizate de la Raiffeisen" in Romanian) with a link to details. Required by GDPR Art. 7(4) and Law 506/2004.
- Ask again for consent at high-intent moments (after a comparison where a competitor wins: "Vrei să te anunțăm când avem o ofertă mai bună pentru tine?").
- Service messages the customer requested (plan summaries, reminders, saved plans) don't need marketing consent. Every marketing email has an easy opt-out.
- Optional teaser: visitors can ask one question and see the thinking panel and a blurred result, then log in to see the full answer.

## Landing page

1. Hero: for now, the Nocturne CSS isometric hero from `raiffy.html` (`DESIGN.md` palette: near-black with yellow and amber light). It will be replaced by the background video described below, headline, primary CTA "Intră în Raiffy", secondary "Vezi cum funcționează".
2. Live previews: short looping demos (purchase goal, multi-goal plan, honest comparison, language switching).
3. How it works: ask → it compares every financing route → you decide, with no hidden commissions.
4. Trust and safety: "Date păstrate în UE", "Reglementat de BNR", "Asistent AI, poți vorbi oricând cu un om".
5. Final CTA with the sign-in options.

Hero video rules: loop seamlessly, keep text readable with a dark gradient overlay, 8–15 seconds, under 3–5 MB, MP4 (H.264) and WebM, `autoplay muted loop playsinline`, a poster image, a static image under `prefers-reduced-motion`, lighter or static on mobile, and an "AI-generated" credit (AI Act Art. 50).

## Human verification

Three truthful levels; never show "confirmed" unless a human actually confirmed it.

1. **Verified sources (instant, every answer):** badge "Bazat pe informații verificate de specialiștii Raiffeisen · actualizat <date>", true because the sources were reviewed.
2. **On demand:** button "Cere verificarea unui specialist" on each answer, and "Verifică planul meu" once the customer reaches a decision. An operator confirms ("Confirmat de Ana M., specialist credite · 21:30") or edits; an edited answer is shown as a new signed version with changes highlighted. Realistic wait times, callback outside working hours, daily caps.
3. **Automatic escalation** for high stakes (large loans, investments, hardship, multi-goal plans, low evaluator confidence): "În curs de verificare de un specialist".

Rules:

- Per response by default; per plan (a `PlanSummary`) when the customer is close to deciding. A plan check supersedes answer checks in that chat.
- A confirmation expires when the numbers change (slider moved): badge becomes "Modificat după verificare".
- One open request per chat; new requests merge into it.
- Confirmed answers are still labeled AI-generated.
- Operators confirm information only, not personal investment advice or credit approval.
- Every operator edit becomes an eval case and, where relevant, an FAQ or rule fix.
- Honest trust statistic on the landing page from QA sampling (e.g., "96% confirmate fără modificări luna trecută"), never a per-answer operator count.
- Business answers route to SME specialists or the relationship manager.

Schema:

```ts
type Verification = {
  level: "verified_sources" | "pending_review" | "confirmed" | "edited";
  reviewer?: { name: string; role: string };
  reviewedAt?: string;
  diff?: string;                 // for "edited"
  validForInputsHash?: string;   // confirmation no longer matches when inputs change
};
```

**Operator access to chats (GDPR):** access only with a trigger (customer request, escalation, complaint, QA sample), never browsing. Legal basis: the customer's request (Art. 6(1)(b)), legitimate interest for escalation and QA, legal obligation for complaints; consent isn't the right basis. Tell the customer at request time ("Specialistul va vedea această conversație"), with a "Vezi ce se trimite" preview. Mask card numbers, CNP, IBAN and special-category data (health, addiction) by default; unmasking needs a logged reason. Role-based access until the review ends; log every access; QA uses pseudonymized chats; update the privacy notice and DPIA; outsourced operators need a DPA and BNR outsourcing compliance.

## Purchases and listings

- Raiffy never returns seller listings (e.g., BMW X5 offers) by default; it answers with financing routes, affordability, total cost of ownership and safety tips. A "Browse listings" link is allowed only with a disclosed formal partnership, never ranked by commercial interest.

## Education feed

- A finite daily feed of a few cards (insights, tips, at most one relevant product) that ends with "You're all caught up"; every card leads into a conversation with Raiffy, never a direct financial action, and no swipe-to-accept for anything financial.
- 150 purely educational "Did you know" posts exist as a separate file; they promote no products, and posts tagged "RO" need a compliance check before publishing.

## Hackathon delivery

- Demo story: the BMW X5 flow from `docs/shared/answer-schema.md`, then a multi-goal request, then "Verifică planul meu" signed live in a simple operator console.
- Seed demo data so numbers are predictable; record a backup video; mock Raiffeisen SSO.
