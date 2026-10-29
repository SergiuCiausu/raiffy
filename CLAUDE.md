# Raiffy

**Raiffy** is an AI financial assistant for Raiffeisen Bank Romania. The application is in `web/`, the backend in `convex/`, and pure logic in `lib/`. Root HTML pages remain the visual references; their demo figures are illustrative.

## Current runtime

`/chat` uses real Clerk authentication and cloud Convex: screened message → Jev → trusted route → allowed public collections → Claude with citations → checked answer and UI envelope. The scripted UI is explicitly at `/chat/demo`. Read the latest entry in `progress.md` and `web/README.md` for configuration and acceptance. Account data, catalog-backed calculations, approved offers and real-user memory writes are not connected; never present them as available. The privacy screen is pattern-based, not a complete semantic privacy classifier.

## Design

**Read `DESIGN.md` before any UI or design work, and follow it for every design choice**: new pages, sections, components, vignettes, copy tone, colors, spacing and motion.

- Treat `DESIGN.md` as the source of truth, including for the Next.js POC, where it overrides any palette or font in `raiffy-spec`. When it's silent, match what `raiffy.html` already does, reusing its tokens and classes before inventing new ones.
- The non-negotiables: headings capped at 36px, a single yellow/amber accent used as light (never text or gradient text), ink `#1A1A1A` for selection, hairline borders, built HTML/CSS product vignettes instead of icons, and motion gated behind `prefers-reduced-motion`.
- **English only for now**, in the interface and in every answer. Don't add a language switch.
- **Answer scope:** the number of options follows the question.
  - **Compare:** the user names options, so show exactly those.
  - **Solution:** the user describes a goal, so show at least three routes, one recommended.
  - **Detail:** the user asks about one product, so explain it and end with a question that leads deeper into it or into a related Raiffeisen solution.
  - Every answer comes with pre-generated follow-up replies. See `raiffy-spec/docs/individuals/answer-patterns.md`.
- Keep the product voice honest: options appear side by side, Raiffy recommends one financing option and always explains why (and when another fits better), every number shows its source, and the customer makes the final choice.
- If a request conflicts with `DESIGN.md`, say so and ask before deviating.
- When a new pattern becomes part of the design language, update `DESIGN.md` to match.
- Before finishing UI work, run the checklist at the bottom of `DESIGN.md`.

## Product POC stack

**HTML first.** Most of the app UI is built as self-contained HTML pages in the repo root first (`raiffy.html`, `login.html`, `chat.html`, `swipe.html`, `smart-mobile.html`, then `console.html` and the rest), then converted to the Next.js POC page by page. The Next.js stack below is locked. Don't propose alternatives unless asked, and don't scaffold the Next.js app until the user asks for the conversion.

| Concern | Choice |
|---|---|
| Framework | Next.js 16, App Router only (no `pages/`), TypeScript strict |
| Package manager | **pnpm only**, never npm, yarn or bun |
| Database | **Convex**, the only data store |
| Vector database | **Convex vector search**, the same deployment. No pgvector, Pinecone or Supabase. |
| Auth, user management, roles | **Clerk** |
| Styling | Tailwind v4 with `@theme` tokens that mirror `DESIGN.md`. Icons: `lucide-react` only. |
| LLM | Anthropic SDK (with the Vercel AI SDK for streaming and generative UI, per `raiffy-spec`), server-side only |

Use `/setup-app` for bootstrap details. Where it defaults to Supabase, **Convex replaces it**: skip every Supabase step, client, SQL file and MCP.

### Convex

- Schema lives in `convex/schema.ts`, and types flow from it. Queries and mutations handle data. Actions handle anything external (LLM calls, embeddings, fetches).
- **RAG:** store chunks with `.vectorIndex()` (fixed `dimensions`, plus `filterFields` such as language, productId and isActive) and use `.searchIndex()` for the keyword half of hybrid search. `ctx.vectorSearch` runs only inside actions.
- Embeddings: **OpenAI `text-embedding-3-small`** (1536 dimensions), called only from Convex actions with `OPENAI_API_KEY` from the Convex environment. Anthropic has no embeddings API. Claude does the reasoning, tool calls and answers. OpenAI's EU data residency needs approval, so EU hosting for embeddings is still open for production.
- Product numbers: the reviewed catalog tables are the long-term source. **For the demo**, Raiffy may quote rates, fees and amounts from cited search results, as fetched, labelled as dated public figures; every figure must still appear in a cited passage from that turn (the number check in `lib/rag/agent.ts`). See `raiffy-spec/CLAUDE.md`.
- Prefer Convex MCP on the configured dev deployment. If the connector is unavailable, use the project's Convex CLI and saved login against that same cloud dev target. Secrets stay in ignored environment files, never in code or `NEXT_PUBLIC_*`.
- Development runs on the team's **EU cloud Convex deployment**, selected in `.env.local`. Do not initialize or start an anonymous/local backend. Before MCP mutations, verify that its dev URL matches the configured `CONVEX_URL`. Use the saved Convex login; never copy account tokens into repository files.

### Clerk

- Wire it in with `ClerkProvider` and `ConvexProviderWithClerk`, plus `convex/auth.config.ts` pointing at the Clerk "convex" JWT template.
- **Default deny:** `clerkMiddleware` in `src/proxy.ts` (Next 16's name for middleware) protects every route except the public ones (landing, sign-in, sign-up).
- **Every public Convex function and server action checks identity first** (`ctx.auth.getUserIdentity()` or `auth()`). Protect server resources directly; middleware initializes Clerk, and is not the authorization boundary. Internal admin-only evals and retention jobs have separate trusted entry points.
- Mirror users into a Convex `users` table keyed by the Clerk user ID, and upsert on first authenticated use. Don't rely on webhooks alone.
- **Roles** (proposed, confirm before building):
  - App roles go in Clerk `publicMetadata.role`: `customer`, `operator` (the specialist who verifies answers) and `admin`.
  - Expose the role as a claim in the JWT template, and check it server-side in both Next and Convex.
  - Business accounts use **Clerk Organizations**, one per company, with roles `administrator`, `empowered` and `viewer` (`raiffy-spec/docs/business/hard-limits.md`).
- **Metadata writes must spread the existing keys.** `updateUser` replaces the whole object.
- **Sign-in methods, in this order:** Raiffeisen SSO, then Google or Apple, then an email magic link (as in `login.html`).
  - The Raiffeisen SSO button is a **placeholder that does nothing**. Render it, but don't wire it.
  - Google, Apple and the magic link go through Clerk.
- **Sign-up consents:** accepting the terms and privacy notice is required. Marketing consent is a **separate, unticked, optional** checkbox ("I'd like to receive personalised offers from Raiffeisen") and is never a condition of access. Store it in Clerk `publicMetadata` with a timestamp.
- Restyle Clerk's UI to match `DESIGN.md` (the ink, the 10px button radius, Geist), or build custom forms from `login.html`.

### Code boundaries and prototype workflow

HTML pages define the visual reference; `web/` is the running Next.js app. Backend logic stays framework-free and is shared through validated contracts.

```
*.html    UI prototypes in the repo root, one self-contained file per page (DESIGN.md applies)
lib/      pure TS: calculations, Zod schemas, composer, router, guards (+ tests)
convex/   schema, queries, mutations, RAG actions (runs with `pnpm dlx convex dev`, no Next needed)
evals/    promptfoo cases
web/      Next.js app, real Clerk/Convex chat and explicit scripted demo
```

**HTML pages, built for conversion:**

- **One page per route**, with hash routes for sub-views (`console.html#products/personal-loan`). Each page later becomes a route or a route group.
- **Mock data in the real shapes:** keep it inline in one clearly marked block, typed in comments to match the Zod schemas and Convex tables in the spec. Conversion then means swapping the mock block for Convex queries.
- **Components as repeated, named markup:** reuse the same class names across pages (`.gcard`, `.opt`, `.rec-badge`, `.chip`), so each becomes one React component. Keep render functions small and single-purpose (`cardHTML`, `renderSidebar`).
- **Tokens stay on `:root`** exactly as `DESIGN.md` defines them, so they map one to one to Tailwind `@theme` tokens.
- **The scripted logic stays out of the page where it would be real logic:** calculations a page needs (like `simCalc` and `recommend`) should match the deterministic tools in `lib/`, and move there at conversion.
- **No real auth, data or network calls.** Sign-in, roles and saving are simulated and labelled as such on the page.

- **`lib/` is pure.** No database calls, no network requests, no global state. Data comes in as arguments and results go out as return values. Anything that reads or writes data belongs in `convex/`.
- **Every module has Zod-typed input and output**, exported so Next.js and Convex import the same types.
- **No Node-only APIs** (`fs`, `path`, `process.env`) in `lib/` or default Convex functions, because the Convex runtime isn't Node. Pass config in as arguments. Use `"use node"` only in Convex actions that truly need it.
- **No hardcoded facts.** Rates, fees and product terms are passed in from the catalog with their date and source, never written as constants.
- **Output is language-neutral:** return numbers and keys, not formatted strings. Formatting with `Intl` happens in the UI.
- **Every calculation and guard has a Vitest test.** When a spec behavior rule is implemented, add its eval case under `evals/`.
- pnpm, TypeScript strict, and one shared `tsconfig` with the `@/*` alias, so imports don't change when `app/` arrives.
- `/chat` has Clerk/Convex wiring and reveals only verified final text word by word. Further HTML conversions, organization roles and financial-data connections remain scoped work.

### Secrets

Keep `.env.local` out of git, and commit `.env.example` with the key names only. Only `NEXT_PUBLIC_*` values reach the browser. Clerk secret keys, Convex deploy keys and LLM keys are server-only.
