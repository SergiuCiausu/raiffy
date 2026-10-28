# Raiffy web app

The four HTML prototypes in the repo root, as one Next.js 16 app.

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

Not wired yet (per `CLAUDE.md`): Clerk, Convex, the Anthropic SDK and streaming.
