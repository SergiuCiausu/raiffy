# Raiffy web app

The four HTML prototypes in the repo root, as one Next.js 16 app.

## Live banking chat

`/chat` uses Clerk → cloud Convex → Jev classification → route-limited retrieval → Claude → citation/number checks → persisted Answer/UI envelope. Word reveal starts only after validation; unchecked drafts never reach the browser. `/chat/demo` is the separate scripted design demo.

Set `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in ignored `web/.env.local` (see `.env.example`). Convex needs the existing three model keys, `RAIFFY_JEV_ENABLED=true`, and `CLERK_JWT_ISSUER_DOMAIN`. The Clerk application needs a JWT template named `convex` with `aud: "convex"`. The issuer must match that application. Unconfigured chat/sign-in screens explicitly show setup status.

A claimable development Clerk application was provisioned for the synthetic acceptance run; its keys and claim breadcrumb stay in this checkout's ignored `.env.local` and `.clerk/`. The owner can claim it from this directory with `pnpm dlx clerk@latest auth login`, or configure the team's existing Clerk app and update the Convex issuer. No credentials are committed.

```sh
pnpm dev --port 3004
# Explicit paid test: real Clerk session, cloud Jev/Claude/embeddings, no provider mocks.
RAIFFY_LIVE_AGENT_TEST=1 node scripts/test-agent-cloud.mjs
```

The cloud test uses a synthetic Clerk account, checks a sourced answer, follow-up, two-bank comparison, fraud override, history reload, anonymous denial, and mobile layout. Private artifacts are written under root `.convex/acceptance/`; no tokens or keys are printed. It requires installed Chrome and the configured cloud corpus.

The current capability registry exposes public document search and one indicative calculator: `calculate_scenario` with `loan_affordability`, a debt-service check on figures the customer stated, using the limits in Convex `regulatoryLimits` (imported from `catalog/regulatory-limits.jsonl`, still pending review). It needs no product rate and is never a credit decision. Customer memory works only where the deployment owner turned it on (`RAIFFY_MEMORY_WRITES_ENABLED` plus `RAIFFY_MEMORY_WRITES_DEPLOYMENT_URL` pinned to that deployment, currently only the local backend): Claude proposes the customer's own words, the customer confirms each one under the answer, saved memories reach later chats and the calculator, and the Context panel lists and deletes them. Account summaries, reviewed catalog tools, other calculators and approved pricing are explicitly unavailable; the agent cannot approve a counter-offer or invent their output. The privacy screen uses patterns and still needs broader acceptance before real sensitive customer data.

| Route | Prototype |
|---|---|
| `/` | `raiffy.html` (landing, simulator) |
| `/sign-in`, `/sign-up` | `login.html` |
| `/chat` | `chat.html` |
| `/did-you-know` | `swipe.html` (cards read from `../swipe-cards/*.md`) |

`vanilla.html` is the generic swipe demo that `swipe.html` replaced, so it isn't ported.

```sh
pnpm install
pnpm dev                # http://localhost:3000
pnpm test               # Vitest: lib/
pnpm sync:prototypes    # after the UI team changes an HTML prototype
```

This is a self-contained package with its own `pnpm-workspace.yaml`, so it never touches the backend's root `package.json`, lockfile or `lib/`.

## How the port works

The prototypes stay the design source of truth. `scripts/sync-prototypes.mjs` copies what is static:

- **CSS** → `styles/generated/<page>.css`. Every rule is scoped under the page's wrapper (`.pg-landing`, `.pg-auth`, `.pg-chat`, `.pg-swipe`) and keyframes are prefixed, so pages never collide after client-side navigation.
- **Static markup** → `components/generated/*.tsx` (landing body, auth brand panel, chat starters, swipe nav). Lucide icons become `lucide-react` components, and links between prototypes become Next `<Link>`s.

Generated files are overwritten on every sync, so don't edit them. Interactive parts are hand-written React and plugged in as slots:

- `components/landing/`: `Simulator` (live loan vs overdraft), `LandingShell` (nav glass, reveal on scroll, bloom drift, `iso-tilt` hero orbit)
- `components/auth/AuthScreen`: tabs, validation, simulated SSO, Google, Apple and magic link, resend cooldown. Clerk replaces the simulated round trips later.
- `components/chat/`: the scripted demo engine (think → stream → card), cards, pins, sources, permissions, drawers, Tab-to-suggest
- `components/swipe/`: the swipe deck and per-topic vignettes

The maths lives in `lib/finance.ts`: pure functions with Zod types, rates passed in from `lib/demo-terms.ts`, and Vitest tests. The recommendation rule is deterministic and runs in code, never in the LLM.

The prototype descriptions above apply to the scripted demo and visual sources. Live chat wiring is described at the top of this file.
