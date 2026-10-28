# Individuals: Hard limits

**Layer:** code, permissions and infrastructure. These must hold even if the model is confused or manipulated; never rely on the prompt alone for anything in this file.

## Personal data and privacy

| Solution | Source |
| --- | --- |
| Mask card numbers (Luhn check), CNPs, IBANs, passwords and PINs before storage or model calls | EC · Privacy; Auth · Law 190/2018 |
| Never put CNPs in logs, prompts or embeddings | Auth · Law 190/2018 |
| EU-hosted model endpoint or EU processing terms, with a DPA | EC · Privacy |
| Scheduled jobs delete chats, summaries and embeddings past retention | EC · Privacy |
| Self-service export and delete of chat history | EC · Privacy |
| Short session timeouts, re-authentication, clear-history option on device | EC · Privacy |
| Exclude sensitive merchant categories from personalization | EC · Bias |
| Consent banner with reject-all; no marketing nudges without consent | Auth · Law 506/2004 |
| No access to Central Credit Register data | Auth · BNR CRC regulation |

## Access and actions

| Solution | Source |
| --- | --- |
| Every data tool scoped server-side to the authenticated user ID | EC · Out of scope, Prompt injection |
| In shared chats, data tools are scoped to the asker, or to the owner only when the owner chose "Members can use my data"; never to anyone else (`docs/shared/shared-chats.md`) | Shared chats · data scope |
| No tools for transfers, closures, approvals or admin actions | EC · Out of scope, Prompt injection |
| Payments only through the app's SCA and verification-of-payee flows; the agent never collects codes | EC · Agentic actions; Auth · OUG 209/2019 |
| Confirmation card with account, amount and recipient before any action | EC · Agentic actions |
| Idempotency key on every action | EC · Agentic actions |
| Single-step actions where possible; saga with compensation otherwise | EC · Agentic actions |
| Cancellation window where the payment rail allows it | EC · Agentic actions |
| Card freeze on a separate path that works when the LLM is down | EC · Fraud |
| Payee check against a scam watchlist | EC · Fraud |
| Age check from the authenticated profile; youth products only for under-18s | EC · Vulnerable customers |
| Onboarding and KYC stay in the bank's existing flow | Auth · BNR AML regulation |
| Never collect signatures, SMS codes or issue contract documents inside Raiffy | OUG 209/2019, qualified e-signature flow |

## Output and retrieval safeguards

| Solution | Source |
| --- | --- |
| Block answers containing numbers not returned by a tool in this turn | EC · Hallucination |
| Verifier checks cited chunks actually support the claim | EC · Hallucination |
| Retrieval filtered by `product_id`, active versions only | EC · Hallucination, RAG |
| Wrap retrieved and uploaded content as untrusted data; sanitize ingested pages | EC · Prompt injection |
| Output classifiers for fake documents, investment-advice phrasing and pressure language | EC · Prompt injection; Auth · MiFID II |
| Input classifiers for topic, distress, scams, complaints and AML evasion | EC · Out of scope, Vulnerable customers; Auth · Law 129/2019 |
| Similarity threshold: below it, no answer and the question is logged | EC · RAG |
| Re-embed on every catalog or FAQ change; nightly consistency check | EC · RAG |
| Stale competitor rows excluded automatically | EC · Competitor data |

## Resilience and operations

| Solution | Source |
| --- | --- |
| Retry once, fall back to a second model, then a static help message | EC · Model |
| Streaming, typing state and a hard timeout | EC · Model |
| Pinned model version with rollback | EC · Model |
| Caps on turns and tokens; prompt caching; cost alerts | EC · Model |
| Read-only mode when core banking is down | EC · Backend |
| Cache TTL per data type with busting on updates | EC · Backend |
| Live data before actions; version checks on balances | EC · Backend |
| Freshness monitoring and alerts per competitor source | EC · Backend |
| Message IDs for deduplication; persisted action state | EC · Client |
| Rolling conversation summary; system prompt and state always kept | EC · Conversation |
| Persistent "Talk to a human" button with handoff summary | EC · Conversation; Auth · Directive 2023/2673 |
| WCAG 2.1 AA, screen-reader support, reduced-motion and video fallbacks | EC · Client; Auth · Accessibility Act |
| Rate limiting, queueing and autoscaling | EC · Operations |
| Feature flags and kill switch per tool | EC · Operations |
| Append-only audit logs with model, prompt, chunks, tool calls and outputs | EC · Operations |
| C2PA or watermark metadata kept on AI-generated media | Auth · AI Act Art. 50(2) |
| Plan summaries generated from conversation state as a downloadable PDF | Answer schema · `PlanSummary` |
