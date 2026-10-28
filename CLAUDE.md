# Raiffy / Ghid

Concept work for **Ghid**, an AI financial assistant for Raiffeisen Bank Romania. The reference page is `ghid-raiffeisen.html`, a single self-contained HTML file. All rates and figures are illustrative.

## Design

**Read `DESIGN.md` before any UI or design work, and follow it for every design choice**: new pages, sections, components, vignettes, copy tone, colors, spacing and motion.

- Treat `DESIGN.md` as the source of truth. When it's silent, match what `ghid-raiffeisen.html` already does, reusing its tokens and classes before inventing new ones.
- The non-negotiables: headings capped at 36px, a single yellow/amber accent used as light (never text or gradient text), ink `#1A1A1A` for selection, hairline borders, built HTML/CSS product vignettes instead of icons, and motion gated behind `prefers-reduced-motion`.
- Keep the product voice honest: options get equal weight, every number shows its source, and Ghid explains but never decides.
- If a request conflicts with `DESIGN.md`, say so and ask before deviating.
- When a new pattern becomes part of the design language, update `DESIGN.md` to match.
- Before finishing UI work, run the checklist at the bottom of `DESIGN.md`.

## Product POC stack

The HTML files here are design prototypes. **The product POC is a Next.js app**, and these choices are locked. Don't propose alternatives unless asked, and don't scaffold anything until the user asks for the build.

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
- The embedding model isn't chosen yet, and Anthropic has no embeddings API. Ask before picking a provider, since the spec requires EU hosting.
- Product numbers come from the catalog tables, never from the vector store. See `raiffy-spec/CLAUDE.md`.
- Use the Convex MCP only, pointed at a dev deployment. The deploy key goes in `.env.local`, never in code or `NEXT_PUBLIC_*`.

### Clerk

- Wire it in with `ClerkProvider` and `ConvexProviderWithClerk`, plus `convex/auth.config.ts` pointing at the Clerk "convex" JWT template.
- **Default deny:** `clerkMiddleware` in `src/proxy.ts` (Next 16's name for middleware) protects every route except the public ones (landing, sign-in, sign-up).
- **Every Convex function and server action checks identity first** (`ctx.auth.getUserIdentity()` or `auth()`). Middleware protects pages, not function calls.
- Mirror users into a Convex `users` table keyed by the Clerk user ID, and upsert on first authenticated use. Don't rely on webhooks alone.
- **Roles** (proposed, confirm before building):
  - App roles go in Clerk `publicMetadata.role`: `customer`, `operator` (the specialist who verifies answers) and `admin`.
  - Expose the role as a claim in the JWT template, and check it server-side in both Next and Convex.
  - Business accounts use **Clerk Organizations**, one per company, with roles `administrator`, `empowered` and `viewer` (`raiffy-spec/docs/business/hard-limits.md`).
- **Metadata writes must spread the existing keys.** `updateUser` replaces the whole object.
- Sign-in methods follow `raiffy-spec/docs/decisions/product-decisions.md`: a Raiffeisen SSO stand-in, Google or Apple, and an email magic link.
- Restyle Clerk's UI to match `DESIGN.md` (the ink, the 10px button radius, Geist), or build custom forms from `login.html`.

### Working before Next.js exists

The team writes framework-free TypeScript first, and Next.js is wired in later. Write every module so it drops into the app unchanged.

```
lib/      pure TS: calculations, Zod schemas, composer, router, guards (+ tests)
convex/   schema, queries, mutations, RAG actions (runs with `pnpm dlx convex dev`, no Next needed)
evals/    promptfoo cases
app/      Next.js, added later. Don't create it until asked.
```

- **`lib/` is pure.** No database calls, no network requests, no global state. Data comes in as arguments and results go out as return values. Anything that reads or writes data belongs in `convex/`.
- **Every module has Zod-typed input and output**, exported so Next.js and Convex import the same types.
- **No Node-only APIs** (`fs`, `path`, `process.env`) in `lib/` or default Convex functions, because the Convex runtime isn't Node. Pass config in as arguments. Use `"use node"` only in Convex actions that truly need it.
- **No hardcoded facts.** Rates, fees and product terms are passed in from the catalog with their date and source, never written as constants.
- **Output is language-neutral:** return numbers and keys, not formatted strings. Formatting with `Intl` happens in the UI.
- **Every calculation and guard has a Vitest test.** When a spec behavior rule is implemented, add its eval case under `evals/`.
- pnpm, TypeScript strict, and one shared `tsconfig` with the `@/*` alias, so imports don't change when `app/` arrives.
- **Leave for the Next.js wiring step:** Clerk and roles, streaming, the Vercel AI SDK, and all UI.

### Secrets

Keep `.env.local` out of git, and commit `.env.example` with the key names only. Only `NEXT_PUBLIC_*` values reach the browser. Clerk secret keys, Convex deploy keys and LLM keys are server-only.
