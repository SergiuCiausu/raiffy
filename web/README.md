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

**Playwright e2e is disabled** (2026-10-28). `pnpm test:e2e` only prints a notice, and `playwright.config.ts` sets `testIgnore: "**/*"`, so the specs in `e2e/` never run and no dev server is started. To turn them back on, remove `testIgnore` and set `test:e2e` back to `playwright test`. The cloud test above still uses Playwright's Chrome driver but only runs with `RAIFFY_LIVE_AGENT_TEST=1`.

Operator booking exists only as HTML prototypes (`console.html#calendar` and the booking card in `chat.html`, linked through `raiffy.demo.*` localStorage keys). `/chat` has no booking yet.

The current capability registry exposes public document search and one indicative calculator, `check_affordability` (`loan_affordability`): a debt-service check on figures the customer stated, using the limits in Convex `regulatoryLimits` (imported from `catalog/regulatory-limits.jsonl`, still pending review). It needs no product rate and is never a credit decision. Customer memory works only where the deployment owner turned it on (`RAIFFY_MEMORY_WRITES_ENABLED` plus `RAIFFY_MEMORY_WRITES_DEPLOYMENT_URL` pinned to that deployment; since 2026-10-29 the cloud dev deployment, for signed-in testers): Claude proposes the customer's own words, the customer confirms each one under the answer, saved memories reach later chats and the calculator, and the Context panel lists and deletes them. Account summaries, reviewed catalog tools, other calculators and approved pricing are explicitly unavailable; the agent cannot approve a counter-offer or invent their output. The privacy screen uses patterns and still needs broader acceptance before real sensitive customer data.

| Route | Prototype |
|---|---|
| `/` | `raiffy.html` (landing, simulator) |
| `/sign-in`, `/sign-up` | `login.html` |
| `/chat` | `chat.html` |
| `/did-you-know` | `swipe.html` (cards read from `../swipe-cards/*.md`) |

`plan.html` (the full financial plan) is a prototype only; it becomes `/plan/[id]` in phase 5 of the plan build. `/chat` has no plan card yet.

Plans are stored by `convex/plans.ts` and built only from reviewed catalog values. To make the catalog usable on the dev deployment: deploy (`pnpm exec convex dev --once`), build and import it (`pnpm catalog:build-import`, then `pnpm exec convex import --table productTerms --replace -y productTerms.import.jsonl`), have an admin sign values off with `catalog:markReviewed`, and set each product's template with `plans:setTemplate`. Replacing the import clears earlier reviews.

Solution answers ("I want to renovate the kitchen, 40,000 lei") call `compare_routes` once the customer has given an amount and term. The routes card and its recommendation come from `lib/advice`, never from the model. It shows only when the product has a template and reviewed terms. Set `debtShareCeilingTermId` on the template to a reviewed eligibility term for the "under the bank's limit" reason.

`vanilla.html` is the generic swipe demo that `swipe.html` replaced, so it isn't ported.

```sh
pnpm install
pnpm dev                # http://localhost:3000
pnpm test               # Vitest: lib/
pnpm sync:prototypes    # after the UI team changes an HTML prototype
```

This is a self-contained package with its own `pnpm-workspace.yaml`, so it never touches the backend's root `package.json`, lockfile or `lib/`.

## Answer checks: Ask a specialist

"Ask a specialist" under a finished answer sends that answer to `/console/reviews` for a person to check (`components/agent/AnswerCheck.tsx`, `convex/answerChecks.ts`, rules in `lib/review/answerCheck.ts`). The specialist checks information, never a credit decision. What they see is a masked snapshot taken when the customer sent it. No response time is promised in the preview.

Acceptance on the dev deployment:

1. As a signed-in tester, ask a question in `/chat`, press **Ask a specialist** under the answer, add a note and send. The line under the answer reads "Waiting for a specialist" with an `AC-…` reference, and the button is gone.
2. As an operator or admin (`publicMetadata.role`), open `/console/reviews`. The check is in the queue as an "Answer check", with the masked question as its title.
3. Open it. Card numbers, CNP, IBAN, e-mail and phone numbers in the questions and note show as `[REDACTED]`.
4. Choose Confirm, Correct with a note, or Send back with a reason. Back in `/chat`, the line under the answer updates without a reload. A second decision on the same check is refused.
5. A sixth check in 24 hours is refused in the panel. A user without a role gets `forbidden` from `answerChecks:list`.

"Your specialist checks" (`/chat/checks`, the sidebar link) lists the customer's checks; "Open conversation" goes to `/chat?thread=<id>`.

**E-mails** (`convex/answerCheckEmails.ts`, the `@convex-dev/resend` component): a confirmation when the check is sent and a note when a specialist decides, for every check (customers can't opt out). They carry only the reference and the status. Sending is off until set in the Convex environment of one deployment:

```sh
pnpm exec convex env set RESEND_API_KEY <key>
pnpm exec convex env set RAIFFY_EMAIL_FROM "Raiffy <raiffy@your-verified-domain>"
pnpm exec convex env set RAIFFY_APP_URL https://<app host>
pnpm exec convex env set RAIFFY_EMAIL_DEPLOYMENT_URL https://diligent-rhinoceros-830.eu-west-1.convex.cloud
pnpm exec convex env set RAIFFY_EMAIL_ENABLED true
```

Until `RAIFFY_EMAIL_LIVE=true`, Resend runs in test mode: every e-mail goes to `delivered@resend.dev`, never to the customer, and the panel says so. The console case shows what happened to the last e-mail.

## Booking a call with a specialist (demo)

"Talk to a specialist" in the chat header opens the booking card (`components/booking/BookingCard.tsx`), and so does any answer Jev routes to `human_contact`. Slots are computed in `convex/bookings.ts` from an operator's weekly hours (`lib/booking/rules.ts`). Only the customer's click books. The video link is a public Jitsi room and nobody phones the customer; both are labelled as a demo.

Nothing is bookable until an operator has hours. Set them as the admin, for the operator's Clerk user ID:

```sh
pnpm dlx convex run bookings:setAvailability --identity '{"subject":"<admin clerk id>","role":"admin"}'   '{"operatorId":"<operator clerk id>","name":"Ana M.","title":"Credit specialist","active":true,"availability":{"timeZone":"Europe/Bucharest","weekly":{"1":["09:00","17:00"],"2":["09:00","17:00"],"3":["09:00","17:00"],"4":["09:00","17:00"],"5":["09:00","13:00"]},"breaks":[["12:30","13:30"]],"slotMinutes":30,"bufferMinutes":0,"dailyCap":5,"minLeadHours":2,"horizonDays":14,"daysOff":[]}}'
```

Rules: one open call per customer. A call is released if it isn't confirmed 24 hours ahead (a cron runs every 15 minutes). Booking within those 24 hours counts as confirming. Booking pauses for 30 days after two missed calls. The video link works from 10 minutes before the call until it ends. A shared plan is readable by the operator from 15 minutes before until a day after. The operator functions are `bookings:agenda`, `bookings:operatorCancel` and `bookings:recordOutcome`. There's no operator page in `web/` yet.

## How the port works

The prototypes stay the design source of truth. `scripts/sync-prototypes.mjs` copies what is static:

- **CSS** → `styles/generated/<page>.css`. Every rule is scoped under the page's wrapper (`.pg-landing`, `.pg-auth`, `.pg-chat`, `.pg-swipe`) and keyframes are prefixed, so pages never collide after client-side navigation.
- **Static markup** → `components/generated/*.tsx` (landing body, auth brand panel, chat starters, swipe nav). Lucide icons become `lucide-react` components, and links between prototypes become Next `<Link>`s.

Generated files are overwritten on every sync, so don't edit them. Interactive parts are hand-written React and plugged in as slots:

- `components/landing/`: `Simulator` (live loan vs overdraft), `LandingShell` (nav glass, reveal on scroll, bloom drift, `iso-tilt` hero orbit)
- `components/auth/AuthScreen`: the `login.html` sign-in / create-account screen on Clerk's custom flows (Google, Apple, email link; Raiffeisen SSO is a placeholder), used by `/sign-in` and `/sign-up`. Callbacks: `/sso-callback`, `/verify-email`. Sign-up consents go to `publicMetadata.consents` via `app/sign-up/actions.ts`.
- `components/chat/`: the scripted demo engine (think → stream → card), cards, pins, sources, permissions, drawers, Tab-to-suggest
- `components/swipe/`: the swipe deck and per-topic vignettes

The maths lives in `lib/finance.ts`: pure functions with Zod types, rates passed in from `lib/demo-terms.ts`, and Vitest tests. The recommendation rule is deterministic and runs in code, never in the LLM.

The prototype descriptions above apply to the scripted demo and visual sources. Live chat wiring is described at the top of this file.


## Local voice on the current live chat

The microphone in `/chat` adds English dictation to a reviewable draft, or starts a hands-free conversation when the composer is empty. Dictated submissions use the same authenticated Convex send/run path as typed text. A voice reply plays only after the server has published its checked final answer; historical messages, failed drafts and stopped replies never trigger automatic narration. Stop, Escape and switching chats cancel speech. Typed answers have a separate Read answer aloud action.

Read-aloud runs on-device through the pinned Phonon 31m English model and the public Preston voice. First use downloads model assets. Transcription requires the existing local VibeVoice environment in `.local/voice/`, so the Python endpoint rejects production, non-loopback and cross-origin requests. The voice layer does not alter Convex functions or enable another provider. Setup and previous model acceptance limits: `../tools/voice/README.md`.
