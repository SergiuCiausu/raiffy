# Raiffy agent setup

Raiffy uses Jev to classify a customer message, code to select the workflow and data, and Claude to explain verified results. The first setup keeps the existing Convex backend and Anthropic Messages API. A console-style Managed Agents definition is included for reviewing the same prompt and tool contracts; creating that agent alone does not connect Convex or implement those tools.

The source files are `lib/agent/`. Run `pnpm agent:build-setup` to regenerate the files in `agents/`, and `pnpm agent:check-setup` to check that they match. No command in this setup creates remote resources or sends customer data.

## How one turn works

```text
Authenticated app session + customer message
    → backend PII screening and bounded recent context
    → one Jev request: inquiry, scope, complexity, audience, memory operation, risks
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

The request asks separate Choice questions for the inquiry, answer scope, complexity, personal versus business audience, and explicit memory operation. Independent Noul questions check multiple goals and each risk. A negotiation can coexist with hardship or fraud, so these cannot be mutually exclusive categories. Only the redacted current message and bounded recent context belong in this request; the customer profile, entire transcript and document corpus do not.

Choice results include the selected label, all option probabilities and a confidence statistic derived from that distribution. Noul returns one yes probability with no separate confidence field. Classification confidence does not measure the truth of the eventual answer. The parser checks valid labels, complete distributions and consistency of reported confidence. [Choice contract](https://docs.typesafe.ai/primitives/choice), [confidence](https://docs.typesafe.ai/confidence).

The initial routing confidence floor is `0.8`, risk review probability is `0.3`, and the multiple-goal threshold is `0.7`. These are provisional engineering defaults, not measured accuracy guarantees. Low routing confidence asks one clarifying question; a risk signal enters the approved support path before retrieval or generation. Use the labeled EN/RO cases in `evals/agent-routing.json` as the start of an evaluation set. They are test inputs, not recorded Jev outputs.

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
| `user_memory` | User-stated goals, preferences and constraints | Authenticated user and authorized organization only | Contract and selection guard only |
| Structured product catalog | Exact rates, fees, conditions and comparison inputs | Server tools with dated records | Raw scrape exists; no normalized catalog tool |
| Account data | Income, expenses, debt and budget aggregates | Authenticated read-only bank connection | Not connected |
| Approved offers | Existing customer-specific authorized pricing | Authenticated user with offer validity checks | Not connected |

A user asking “Where did my money go?” needs an expense aggregate, not semantic search over raw transactions. A user asking “What does this fee mean?” needs the account item, the structured fee and its explanation. A user asking “Can you beat this offer?” needs verified comparable terms and an actual approved offer; otherwise the answer offers an adviser review. The model never invents the improvement.

The adapter supplies `availableTools` and `availableCollections` from deployment configuration. The planner records unavailable resources rather than silently searching something else. Passing every declared contract as available would misrepresent the current backend. Product and competitor financial values remain catalog facts; memory and a customer's claimed competitor rate cannot establish them.

## User memory

The initial policy is explicit requests only. “Remember that I am saving for a car” can create a proposal; merely discussing a car purchase does not create persistent memory. `agents/memory-policy.json` keeps persistence disabled until the storage adapter, authentication, PII screening, consent and deletion path are wired together. This flag describes the setup; a future adapter must enforce it in code.

Claude can propose a goal, preference or constraint with the exact redacted customer quote and source message ID. The host verifies the quote against its own message record, checks the request and privacy rules, and obtains the application's required confirmation. The model cannot supply an owner ID or mark its own proposal approved. “Proposed,” “saved” and “unavailable” are distinct tool outcomes.

Persist approved memories in a separate `userMemories` table, with `ownerKey`, `track`, authorized `organizationKey` where applicable, kind, text, source message ID, consent event ID, update time, expiry and active status. Never put these records in the public `ragChunks` index. Filter by owner and authorized organization before similarity search, then recheck ownership, active state and expiry when loading results. `selectUserMemories` supplies that second check and strips owner metadata from the model context; it is not a database query or an authentication implementation.

If an embedding index is added, use the same approved local embedding approach already under evaluation. Do not add a new external embedding provider. Memory embeddings carry the same access and deletion requirements as their source text. Retrieval should return only relevant records, not every fact ever saved about the person.

Credentials, CNP, card numbers, IBANs, sensitive merchant details, inferred traits and other people's information are excluded. Account balances and spending totals stay in structured account data with source timestamps. An old customer-stated financial fact must never override a current bank record. Retention duration must be set before enabling writes; expired memories are excluded immediately and removed by a scheduled deletion job. Corrections supersede the old record and embedding; deletion removes the record, embedding and affected user caches.

## Console template and backend integration

`agents/raiffy.agent.yaml` follows the console-style definition supplied with this task: model, system prompt, custom tool declarations, empty MCP server list and metadata. It declares only specific banking and memory tools. There is no general-purpose shell, arbitrary file access or uncontrolled web search.

Anthropic Managed Agents executes its own session lifecycle. A custom tool declaration still requires application code to receive a tool call, authorize it, execute the operation and return the result. There is no existing Raiffy MCP URL to enter in the console. Jev classification belongs before the Claude turn in either runtime, not in an invented `jev:` field in Anthropic's configuration. [Managed Agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart), [custom tools](https://platform.claude.com/docs/en/managed-agents/tools).

For the existing Messages API route, import the system prompt and translate the custom tool contracts to Messages API tool definitions by omitting `type: custom`. Feed a validated route plan and tool evidence into the turn, execute tool requests in a bounded server loop, and give the generator only the composed answer blocks. The current `convex/ragAnswer.ts` remains a separate public-product Q&A action; this foundation does not wire a new loop into it or replace its output shape.

Use the existing `Answer` envelope and block recipes rather than asking the model to invent a new response schema. Unknown data becomes `partial` or `unavailable`; hardship suppresses offers; `compare`, `solution` and `detail` keep their existing meaning. The app's English-only override wins over older multilingual passages in the specification.

## Next implementation steps

1. Wire auth and PII screening before either provider sees a message. Implement and evaluate the Jev transport adapter, timeouts and safe fallback. The code here builds and validates requests but makes no live provider calls.
2. Connect the current public RAG action behind `search_knowledge`; retain source relevance and freshness checks. Repair the current number guard: numerical token membership does not bind a figure to its meaning or cited source.
3. Normalize the product catalog and ingest dated competitor documents. Implement the deterministic calculators and comparison engine.
4. Implement expense aggregates with synthetic profiles for the demo, clearly marked synthetic. Connect real read-only account data only through the authenticated adapter.
5. Implement the separate memory table, user confirmation, owner-filtered retrieval, retention/export/delete and cache invalidation together. Then enable memory in the deployment capability registry.
6. Connect the composer and evaluator, run the classification and retrieval evals, and measure answer accuracy, safety overrides, latency and actual token cost. Only then evaluate whether Haiku or Opus improves a particular route.

Runtime choice and automatic-memory consent can be changed after the team's preference is confirmed. The current foundation assumes Convex plus Messages API and explicit memory requests; it does not select an EU hosting arrangement, configure Clerk, deploy a managed agent or enable private persistence.
