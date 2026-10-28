# Raiffy agent setup

Raiffy uses Jev to classify a customer message, code to select the workflow and data, and Claude to explain verified results. The first setup keeps the existing Convex backend and Anthropic Messages API. A console-style Managed Agents definition is included for reviewing the same prompt and tool contracts; creating that agent alone does not connect Convex or implement those tools.

The source files are `lib/agent/`. Run `pnpm agent:build-setup` to regenerate the files in `agents/`, and `pnpm agent:check-setup` to check that they match. Those commands only generate local files. Convex memory and Jev adapters are described below; neither real-customer persistence nor provider calls are enabled by default.

## How one turn works

```text
Authenticated app session + customer message
    → backend PII screening and bounded recent context
    → one Jev request: inquiry, scope, complexity, audience, memory operation, memory candidate, risks
    → deterministic route plan and capability checks
    → only the relevant scoped tools and retrieved evidence
    → deterministic calculations and Answer composer
    → Claude framing text
    → evidence, number and behavior checks
    → in-app answer
```

Jev does not write the response or query a database. Its labels let our code avoid a second Claude call just to decide where to search. The planner returns the selected model, collections, tool names, unavailable capabilities and context limits. This is a retrieval plan, not an access token: each actual tool must independently enforce authentication and ownership.

An illustrative negotiation plan, with all required adapters enabled, includes:

```json
{
  "inquiry": "negotiation",
  "confidence": 0.95,
  "scope": "compare",
  "handler": "orchestrator",
  "model": { "id": "claude-sonnet-5-5", "effort": "medium" },
  "collections": ["bank_product_docs", "competitor_docs", "user_memory"]
}
```

This is an example of the planner's shape, not a live model result or a declaration that those adapters exist. An explicit memory operation runs before an accompanying financial inquiry; the host can resume that inquiry after the memory operation completes.

### Jev classification

`agents/jev.request.example.json` is the request body for `POST https://api.typesafe.ai/v1/systemone`. The server sends its key in `Authorization: Bearer ...`; keys never go in the request JSON or the app client. The configured version is `jev-1.14.0`, pinned so thresholds can be evaluated against one version. [TypeSafe API](https://docs.typesafe.ai/api/system-one), [model versions](https://docs.typesafe.ai/models).

The request asks separate Choice questions for the inquiry, answer scope, complexity, personal versus business audience, explicit memory operation and memory candidate (what the customer states about themselves without asking us to save it). Independent Noul questions check multiple goals, each risk, whether a stated fact is durable and whether the message contains special-category or third-party details. A negotiation can coexist with hardship or fraud, so these cannot be mutually exclusive categories. Only the redacted current message and bounded recent context belong in this request; the customer profile, entire transcript and document corpus do not.

Choice results include the selected label, all option probabilities and a confidence statistic derived from that distribution. Noul returns one yes probability with no separate confidence field. Classification confidence does not measure the truth of the eventual answer. The parser checks valid labels, complete distributions and consistency of reported confidence. [Choice contract](https://docs.typesafe.ai/primitives/choice), [confidence](https://docs.typesafe.ai/confidence).

The initial routing confidence floor is `0.8`, risk review probability is `0.3`, the multiple-goal threshold is `0.7`, the memory candidate score is `0.6` and the special-category cut-off is `0.2`. These are provisional engineering defaults, not measured accuracy guarantees. Low routing confidence asks one clarifying question; a risk signal enters the approved support path before retrieval or generation. Use the labeled EN/RO cases in `evals/agent-routing.json` as the start of an evaluation set. They are test inputs, not recorded Jev outputs.

### Model selection

| Work | Initial model | Effort |
| --- | --- | --- |
| Classify all messages | Jev `jev-1.14.0` | Not applicable |
| Simple sourced explanation | Claude Sonnet 5.5 | Low |
| Comparison, negotiation or multiple goals | Claude Sonnet 5.5 | Medium |
| Optional escalation after evaluation | Claude Opus 5.5 | Medium |
| Clarification, unavailable capability or safety script | Deterministic application response | No generation call |

Opus escalation is disabled by default in `agents/model-policy.json`. This retains the backend's current Sonnet choice and makes the more expensive route opt-in. Model selection and effort are supported controls, but the best setting for these banking inquiries needs an app-specific latency and quality evaluation. [Sonnet model](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [Opus model](https://platform.claude.com/docs/en/models/opus-5-5/overview).

For cost control, cache the stable system prompt where supported, bound output tokens and tool rounds in the backend, and retrieve at most five public passages and three relevant memories. Do not send the entire corpus, repeat retrieval without new inputs, or use a shared cache for private answers. Track actual input, output and cache tokens; no latency, accuracy or cost savings have been measured for this setup.

## What the RAG buckets mean

The buckets are logical collections inside Convex. Separate databases are unnecessary for routing; clear table/index boundaries, metadata and server-side ownership are essential.

| Collection or source | Contents | Access | Current backend |
| --- | --- | --- | --- |
| `bank_product_docs` | Raiffeisen explanations, product pages and tariff PDFs | Public facts, filtered by track and product | `ragChunks` and hybrid search exist |
| `competitor_docs` | Approved official competitor terms and explanations | Public facts, version and freshness checked | Not ingested |
| `banking_help` | Approved glossary and FAQ answers | Public facts, version and freshness checked | No distinct collection yet |
| `user_memory` | User-stated goals, preferences, constraints and financial figures | Authenticated user and authorized organization only | Store and lifecycle built; cloud dev synthetic demo only, disabled by default |
| Structured product catalog | Exact rates, fees, conditions and comparison inputs | Server tools with dated records | Raw scrape exists; no normalized catalog tool |
| Account data | Income, expenses, debt and budget aggregates | Authenticated read-only bank connection | Not connected |
| Approved offers | Existing customer-specific authorized pricing | Authenticated user with offer validity checks | Not connected |

A user asking “Where did my money go?” needs an expense aggregate, not semantic search over raw transactions. A user asking “What does this fee mean?” needs the account item, the structured fee and its explanation. A user asking “Can you beat this offer?” needs verified comparable terms and an actual approved offer; otherwise the answer offers an adviser review. The model never invents the improvement.

The adapter supplies `availableTools` and `availableCollections` from deployment configuration. The planner records unavailable resources rather than silently searching something else. Passing every declared contract as available would misrepresent the current backend. Product and competitor financial values remain catalog facts; memory and a customer's claimed competitor rate cannot establish them.

## User memory

A memory proposal starts in one of two ways. The customer asks explicitly (“Remember that I am saving for a car”), which routes to the memory handler. Or Jev's memory candidate flags something the customer stated in passing (“I want to save for a car over the next two years”), and `scoreMemoryCandidate` accepts it. The score is the probability of the chosen kind times the probability that the fact is durable. Nothing is proposed when the message carries a risk signal, special-category or third-party details, or an explicit memory operation. An accepted candidate adds `propose_memory_change` to the normal answer's tools and sets `memoryCandidate` on the route plan; it never changes the handler or the model. Consent comes only from the customer: each proposal waits for confirmation, which the application should batch into one card at the end of a topic instead of interrupting the answer. `agents/memory-policy.json` keeps private persistence disabled. The adapter permits a separately gated cloud dev synthetic demo, approved by the owner on 2026-10-28, and rejects real-customer writes even when that demo is enabled.

Claude can propose a goal, preference, constraint or stated financial figure with the exact redacted customer quote and source message ID. It proposes only what the customer said, never an inference. The host verifies the quote against its own message record, checks the privacy rules, and obtains the customer's confirmation. The model cannot supply an owner ID or mark its own proposal approved. “Proposed,” “saved” and “unavailable” are distinct tool outcomes. A stated figure is the customer's dated claim: it can fill a calculator input labeled as customer-stated, but it never establishes a bank rate, an account balance or a credit decision.

Measure the candidate step like a recommender, but optimize it for the customer: the share of proposals accepted, the share of saved memories later corrected or deleted, and the repeated questions avoided. Use those aggregates, pseudonymized, to calibrate the thresholds. Do not optimize for engagement or conversion, build inferred profiles, or use memory for marketing without the separate marketing consent.

Persist approved memories in a separate `userMemories` table, with `ownerKey`, `track`, authorized `organizationKey` where applicable, kind, text, source message ID, consent event ID, update time, expiry and active status. Never put these records in the public `ragChunks` index. Filter by owner and authorized organization before similarity search, then recheck ownership, active state and expiry when loading results. `selectUserMemories` supplies that second check and strips owner metadata from the model context; it is not a database query or an authentication implementation.

If an embedding index is added, use the same approved local embedding approach already under evaluation. Do not add a new external embedding provider. Memory embeddings carry the same access and deletion requirements as their source text. Retrieval should return only relevant records, not every fact ever saved about the person.

Credentials, CNP, card numbers, IBANs, sensitive merchant details, special-category details, inferred traits and other people's information are excluded. Account balances and spending totals stay in structured account data with source timestamps. An old customer-stated financial fact must never override a current bank record. Retention duration must be set before enabling writes; expired memories are excluded immediately and removed by a scheduled deletion job. Corrections supersede the old record and embedding; deletion removes the record, embedding and affected user caches.

### Implemented cloud dev memory store

`convex/schema.ts` now separates `memoryProposals` and `userMemories` from `ragChunks`. Minimal `conversations` and `messages` tables supply private quote provenance; they do not implement the full conversation pipeline. `convex/conversations.ts:recordCustomerMessage` and `convex/memory.ts:propose` are internal functions. Public `confirm`, `reject`, `listMine`, `forgetOne` and `forgetAll` derive ownership from identity, and accept no owner or organization argument. Signed `org_id` determines business scope. The anonymous demo supports personal scope only.

Both `RAIFFY_DEMO_IDENTITY_ENABLED=true` and `RAIFFY_MEMORY_DEMO_PERSISTENCE_ENABLED=true` are required for synthetic writes. `RAIFFY_DEMO_DEPLOYMENT_URL` must pin the cloud dev deployment verified by MCP, matching the runtime `CONVEX_CLOUD_URL` exactly. Its HTTPS `CONVEX_SITE_URL` must name the same deployment. Copied demo flags cannot enable a different deployment; localhost is rejected. Set the pin only after verifying that MCP selected dev and that its URL matches `.env.local`. A real authenticated identity is never replaced by the demo identity, and real-customer writes remain disabled. Clerk and a reviewed privacy adapter are prerequisites for real private persistence.

The demo privacy screen is conservative pattern matching, not complete semantic PII or special-category detection. Detected excluded content becomes a redaction marker and is ineligible for memory. Proposed text must be an exact excerpt of the verified quote; paraphrased or inferred summaries are rejected. Confirmation rechecks source ownership, eligibility and expiry. A repeated confirmation returns the same ID; corrections atomically remove the old memory and consent, invalidating competing updates. Deletion removes memories and proposals and marks their retained source messages ineligible for replay. Transcript provenance has its own retention; memory deletion does not erase the conversation. No memory embeddings or private answer caches exist yet.

Demo retention: goals and preferences 365 days, constraints 180 days, stated financials 90 days, measured from the original statement. Pending proposals expire after 7 days, capped by source expiry. Provenance expires after 30 days. An hourly cron removes expired rows in bounded batches; reads exclude them immediately. Rejection and deletion work even after the persistence flag is disabled. `listMine` supplies the customer's inspection/export data, not relevance-ranked model retrieval.

Validation: `pnpm test`, `pnpm typecheck`, `pnpm convex:typecheck` and `pnpm agent:check-setup`. Configure the team's cloud dev deployment in `.env.local` and authenticate with `pnpm exec convex login`. `pnpm convex:dev` publishes to that cloud deployment; do not initialize a local backend. `pnpm memory:check-mcp` starts the installed Convex MCP using explicit dev selection, checks the URL against `.env.local`, verifies tables and a synthetic propose/confirm/delete cycle, and restores the original demo flags and deployment pin. It never deletes pre-existing demo memories or calls Jev. The MCP is registered in this machine's Codex configuration as `convex`, using the installed project CLI with `--deployment dev`.

### Implemented Jev transport

`convex/jev.ts:classify` is internal and takes a stored message ID and track, not raw client text, an owner or a provider key. It loads screened, unexpired, owned provenance and bounded recent context from the same conversation. `RAIFFY_JEV_ENABLED` defaults off; `TYPESAFE_API_KEY` is read only inside the action. `convex/jevTransport.ts` posts one request to the documented endpoint with `jev-1.14.0`, rejects redirects and responses above 64 KiB, and enforces a 2500 ms deadline across fetch and body reading. Missing config, invalid output, version changes, provider errors and timeouts return typed `unavailable` results without retries or another provider. The host must stop generation on that result; `planAgentRoute({}, context)` supplies the safe unavailable plan. The adapter has mocked tests and fault eval cases; no live provider call or threshold calibration has been run. The actual agent loop, privacy adapter and UI confirmation cards are still unwired. See [TypeSafe's endpoint contract](https://docs.typesafe.ai/api/system-one).

## Console template and backend integration

`agents/raiffy.agent.yaml` follows the console-style definition supplied with this task: model, system prompt, custom tool declarations, empty MCP server list and metadata. It declares only specific banking and memory tools. There is no general-purpose shell, arbitrary file access or uncontrolled web search.

Anthropic Managed Agents executes its own session lifecycle. A custom tool declaration still requires application code to receive a tool call, authorize it, execute the operation and return the result. There is no existing Raiffy MCP URL to enter in the console. Jev classification belongs before the Claude turn in either runtime, not in an invented `jev:` field in Anthropic's configuration. [Managed Agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart), [custom tools](https://platform.claude.com/docs/en/managed-agents/tools).

For the existing Messages API route, import the system prompt and translate the custom tool contracts to Messages API tool definitions by omitting `type: custom`. Feed a validated route plan and tool evidence into the turn, execute tool requests in a bounded server loop, and give the generator only the composed answer blocks. The current `convex/ragAnswer.ts` remains a separate public-product Q&A action; this foundation does not wire a new loop into it or replace its output shape.

Use the existing `Answer` envelope and block recipes rather than asking the model to invent a new response schema. Unknown data becomes `partial` or `unavailable`; hardship suppresses offers; `compare`, `solution` and `detail` keep their existing meaning. The app's English-only override wins over older multilingual passages in the specification.

## Next implementation steps

1. Wire real auth and PII screening before either provider sees customer data. The Jev transport and timeout fallback are implemented but disabled; evaluate the labeled routing set with an explicitly enabled provider configuration and calibrate thresholds.
2. Connect the current public RAG action behind `search_knowledge`; retain source relevance and freshness checks. Repair the current number guard: numerical token membership does not bind a figure to its meaning or cited source.
3. Normalize the product catalog and ingest dated competitor documents. Implement the deterministic calculators and comparison engine.
4. Implement expense aggregates with synthetic profiles for the demo, clearly marked synthetic. Connect real read-only account data only through the authenticated adapter.
5. Accept real auth/privacy integration and UI confirmation for the implemented memory lifecycle. Add relevance-ranked retrieval and coordinate future embeddings/caches with deletion before enabling private memory in the capability registry.
6. Connect the composer and evaluator, run the classification and retrieval evals, and measure answer accuracy, safety overrides, latency and actual token cost. Only then evaluate whether Haiku or Opus improves a particular route.

The runtime choice can be changed after the team's preference is confirmed. The current foundation assumes Convex plus Messages API, and memory proposals from explicit requests or Jev candidates, each confirmed by the customer; it does not select an EU hosting arrangement, configure Clerk, deploy a managed agent or enable private persistence.
