# Setting up Raiffy

How to install and run Raiffy on a new machine, from a fresh clone to a signed-in chat that answers from Raiffeisen's public pages. For what each part does, see `README.md`. For what's built and the decisions behind it, see `progress.md`.

Once it runs, try the prompts in [inputs.md](inputs.md). They cover the main use cases and edge cases of the chat pipeline.

## What you need

**On your machine**

| Tool | Version | Why |
|---|---|---|
| Git | any recent | clone the repo |
| Node.js | 22 (the Docker image uses `node:22`) | everything |
| pnpm | 11.25.0, through Corepack | the only package manager. Never use npm, yarn or bun. |
| Chrome | any recent | optional: the paid cloud acceptance test |
| Python | 3.11 or later | optional: local voice only |

Turn on the pinned pnpm with Corepack:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm -v   # 11.25.0
```

**Accounts and keys**

| Service | What for | Required |
|---|---|---|
| [Convex](https://convex.dev) | database, vector search and every backend function. Ask a team member for access to the team's EU dev deployment, or create your own project. | yes |
| [Clerk](https://clerk.com) | sign-in and roles | yes |
| Anthropic | Claude writes the answers | yes |
| OpenAI | `text-embedding-3-small` embeddings for search | yes |
| Typesafe (`TYPESAFE_API_KEY`) | Jev, the classifier that routes each message | yes |
| [Resend](https://resend.com) | e-mails for answer checks, plan checks and bookings | no |

Keys never go in the repo. Server keys live in the Convex environment. App keys live in `web/.env.local`, which git ignores. Only `NEXT_PUBLIC_*` values reach the browser.

## 1. Clone and install

The repo has two separate pnpm projects: the backend at the root, and the web app in `web/`, which has its own lockfile and workspace. Install both.

```sh
git clone https://github.com/SergiuCiausu/raiffy.git
cd raiffy
pnpm install            # backend: convex/, lib/, scripts/
cd web && pnpm install  # the Next.js app
cd ..
```

If the venue network is slow, the web install can take minutes (Next's SWC binary is about 32 MB). `web/pnpm-workspace.yaml` already raises the fetch timeout.

## 2. Connect Convex

Development runs on a **cloud** Convex deployment, in the EU. Don't start a local or anonymous backend.

```sh
pnpm exec convex login
pnpm exec convex dev --once
```

The first `convex dev` asks you to pick a team and project.
- **To join the team's deployment:** choose project `raiffy` on team `andrei-cazacu`. Its dev deployment is `diligent-rhinoceros-830` (`https://diligent-rhinoceros-830.eu-west-1.convex.cloud`).
- **To work alone:** create a new project, in the EU region.

The command writes `CONVEX_DEPLOYMENT`, `CONVEX_URL` and `CONVEX_SITE_URL` to the root `.env.local`, pushes the schema and functions, and generates `convex/_generated/`.

> **The shared deployment is shared.** `convex dev --once` pushes your whole `convex/` folder, and that replaces what everyone else on the deployment is running. Pull first, and push only code whose tests pass.

## 3. Set up Clerk

1. Create a Clerk application, or get access to the team's.
2. Turn on the sign-in methods: Google, Apple and the email magic link. The Raiffeisen SSO button is a placeholder and isn't wired.
3. Under **Configure → JWT templates**, create a template named **`convex`**, with these claims:
   ```json
   {
     "aud": "convex",
     "email": "{{user.primary_email_address}}",
     "role": "{{user.public_metadata.role}}"
   }
   ```
   - `aud` must be `convex`.
   - `role` controls access to the staff console.
   - `email` is needed for every e-mail feature. Without it, nothing is e-mailed.
4. Copy the template's **Issuer** URL. It's your Clerk Frontend API URL, `https://<name>.clerk.accounts.dev`.
5. To make someone staff: in Clerk, open that user and set **Public metadata** to `{"role": "operator"}` or `{"role": "admin"}`. Customers need no role. When editing metadata in code, spread the existing keys: `updateUser` replaces the whole object.

## 4. Set the Convex environment

These are server keys. Set them on the deployment, never in a file:

```sh
pnpm exec convex env set ANTHROPIC_API_KEY <key>
pnpm exec convex env set OPENAI_API_KEY <key>
pnpm exec convex env set TYPESAFE_API_KEY <key>
pnpm exec convex env set RAIFFY_JEV_ENABLED true
pnpm exec convex env set CLERK_JWT_ISSUER_DOMAIN https://<name>.clerk.accounts.dev
pnpm exec convex dev --once   # push again so convex/auth.config.ts reads the issuer
```

`pnpm exec convex env list` shows what's already set. On the team deployment these keys exist already, so skip this step there.

## 5. Configure the web app

Create `web/.env.local`. `web/.env.example` lists the key names:

```sh
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.eu-west-1.convex.cloud   # CONVEX_URL from the root .env.local
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Use the same Clerk application whose issuer you gave Convex in step 4. If they don't match, every chat call is refused.

## 6. Load the data

Skip this step on the team deployment: its corpus and catalog are loaded already. A new deployment starts empty, and the chat can't find any sources until this is done. Run from the repo root:

```sh
# Public documents for search (RAG): build, import, then embed (OpenAI calls, paid)
pnpm rag:build-import
pnpm exec convex import --table ragChunks --append -y ragChunks.import.jsonl
pnpm exec convex run embeddings:embedPending

# The product catalog and its terms
pnpm catalog:build-products
pnpm exec convex import --table products --append -y products.import.jsonl
pnpm catalog:build-import
pnpm exec convex import --table productTerms --append -y productTerms.import.jsonl

# Limits for the affordability check
pnpm exec convex import --table regulatoryLimits --append -y catalog/regulatory-limits.jsonl
```

Use `--append` on an empty table. `--replace` deletes every row in that table first; it also clears catalog reviews.

Optional, for plans built from the reviewed catalog: an admin signs values off with `catalog:markReviewed`, and each product's template is set with `plans:setTemplate` (see `web/README.md`).

## 7. Run it

```sh
cd web
pnpm dev        # http://localhost:3000
```

Sign up at `/sign-up`, then open `/chat`. Staff pages need a role (step 3):
- `/console/reviews`: operator or admin
- `/admin`: admin

`/chat/demo` is the scripted design demo. It uses no backend.

## 8. Check the install

```sh
# Backend, from the repo root
pnpm test                 # Vitest: lib/ and convex/ (convex-test, no provider calls)
pnpm typecheck
pnpm convex:typecheck
pnpm agent:check-setup    # the generated agent setup matches agents/

# Web app
cd web
pnpm test && pnpm typecheck && pnpm lint
```

Then ask one question straight through the backend. This is a paid call to Jev and Claude:

```sh
pnpm exec convex run agent:ask '{"question": "What does the 3-month deposit pay?", "track": "personal"}'
```

**Optional:** the full cloud acceptance test. It uses a real Clerk session, signs in, asks four questions and checks the answers. It's paid and needs Chrome:

```sh
cd web
RAIFFY_LIVE_AGENT_TEST=1 node scripts/test-agent-cloud.mjs
```

## 9. Optional features

Each feature is off by default and pinned to one deployment URL, so turning it on for dev can't leak into another deployment. Set them with `pnpm exec convex env set <NAME> <value>`. `<url>` is the deployment URL, for example `https://diligent-rhinoceros-830.eu-west-1.convex.cloud`.

| Feature | Variables |
|---|---|
| Customer memory (remember, recall, forget) | `RAIFFY_MEMORY_WRITES_ENABLED=true`, `RAIFFY_MEMORY_WRITES_DEPLOYMENT_URL=<url>` |
| E-mails (answer checks, plan checks, bookings) | `RESEND_API_KEY`, `RAIFFY_EMAIL_FROM="Raiffy <…@verified-domain>"`, `RAIFFY_APP_URL=http://localhost:3000`, `RAIFFY_EMAIL_DEPLOYMENT_URL=<url>`, `RAIFFY_EMAIL_ENABLED=true` |
| Real inboxes instead of Resend's test inbox | `RAIFFY_EMAIL_LIVE=true`. Needs a domain verified in Resend. With `onboarding@resend.dev` as the sender, only the Resend account owner receives mail. |
| Plans from cited figures when the catalog can't back one | `RAIFFY_DEMO_PLANS=true`, `RAIFFY_DEMO_PLANS_DEPLOYMENT_URL=<url>` |
| Pipeline trace (dev only) | `RAIFFY_TRACE=true`, plus `RAIFFY_TRACE_TEXT=true` to include the screened question |

**Booking a call:** every operator and admin can be booked on default hours (Mon–Fri 09:00–17:00) once they've opened Raiffy at least once. Admins set hours in `/admin/specialists`.

**Local voice:** dictation and read-aloud. Run `pnpm voice:setup` from the root; see `tools/voice/README.md`. The web app downloads its voice model on first `pnpm dev`.

## Run with Docker instead

Use Docker with Compose v2.24 or later, after `web/.env.local` exists:

```sh
docker compose --env-file web/.env.local up --build web    # the app on http://localhost:3000
docker compose run --rm checks                              # every backend test and type check
CONVEX_DEPLOY_KEY=... docker compose --profile deploy run --rm convex-deploy   # push to that deployment
```

Convex still runs in the cloud, so steps 2–4 and 6 still apply.

## Troubleshooting

| Symptom | Cause |
|---|---|
| The chat shows a setup notice instead of the composer | `web/.env.local` is missing a key, or Convex's `CLERK_JWT_ISSUER_DOMAIN` is from a different Clerk application |
| Every answer says nothing was found | `ragChunks` is empty or not embedded (step 6) |
| The affordability check says it's unavailable | `regulatoryLimits` isn't imported (step 6) |
| `/console/reviews` says forbidden | the user has no `role` in Clerk public metadata, or the JWT template lacks the `role` claim |
| No e-mails, and the console says "no address on file" | the JWT template lacks the `email` claim |
| `pnpm` says the version doesn't match | run the Corepack commands under "What you need" |
| A Convex test times out once | the first `convex/agent.test.ts` test sometimes times out on a cold start; rerun it |
