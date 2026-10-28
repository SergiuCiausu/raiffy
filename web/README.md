# Raiffy web app

The four HTML prototypes in the repo root, as one Next.js 16 app.

| Route | Prototype |
|---|---|
| `/` | `raiffy.html` (landing, simulator) |
| `/sign-in`, `/sign-up` | `login.html` |
| `/chat` | The live agent chat when `NEXT_PUBLIC_CONVEX_URL` is set, otherwise the scripted demo |
| `/chat/demo` | `chat.html`: the scripted demo, always (comparisons, simulations, advisor booking) |
| `/did-you-know` | `swipe.html` (cards read from `../swipe-cards/*.md`) |

`vanilla.html` is the generic swipe demo that `swipe.html` replaced, so it isn't ported.

```sh
pnpm install
pnpm dev                # http://localhost:3000
pnpm test               # Vitest: lib/
pnpm test:e2e           # Playwright, desktop and phone (uses the installed Google Chrome)
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

## The live chat

`components/agent/AgentChat.tsx` talks to the agent in `../convex/agent.ts`:

1. `agent:send` writes the question and an empty reply marked `streaming`, schedules the agent, and returns at once.
2. The agent calls Claude with the SDK's streaming API (`client.beta.messages.stream`). Text deltas are written to the reply row about every 100ms, and each search step is written as it starts and finishes.
3. The chat subscribes to `agent:listMessages`, so the reply appears as Claude writes it. `StreamingText` reveals each burst at a steady pace, a word at a time, writing the DOM directly so React doesn't re-render every frame.
4. When the turn ends, the row holds the validated answer with its citations, rendered as numbered markers and source chips that link to raiffeisen.ro.

**Stop** marks the reply stopped; the agent sees it on its next write and aborts the Anthropic request. A failed turn offers **Try again**. A conversation keeps its profile (**For me** or **My business**).

To run it, point the app at a Convex deployment (the backend's `npx convex dev` prints the URL):

```sh
echo "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210" > .env.local   # your deployment's URL
pnpm dev
```

`lib/agent-api.ts` holds typed references to the agent functions, because the web app can't import Convex's generated `api` (it's built on its own). Keep it in step with `convex/agent.ts`.

### Testing the live chat without spending tokens

`e2e/live/mock-anthropic.mjs` stands in for the Anthropic API and speaks its streaming protocol. It only accepts streaming requests, so the tests also prove the backend streams.

```sh
node e2e/live/mock-anthropic.mjs                                  # terminal 1
cd .. && npx convex dev                                           # terminal 2 (a local deployment)
npx convex env set ANTHROPIC_API_KEY mock
npx convex env set ANTHROPIC_BASE_URL http://127.0.0.1:4010
pnpm dev --port 3001                                              # terminal 3, with .env.local as above
pnpm test:live
```

Remove the two env vars (`npx convex env remove …`) before using real keys on that deployment.

Not wired yet (per `CLAUDE.md`): Clerk. Until it is, the agent functions have no identity checks, which is fine for local development only.
