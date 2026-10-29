# Raiffy

Raiffeisen Bank Romania's AI financial assistant for individuals: ask about a money goal in plain words and get every route compared, every commission shown, and a bank that says so when a competitor is cheaper.

| Part | What it is |
| --- | --- |
| `web/` | Next.js 16 app: landing page, sign-in (Clerk) and the live chat |
| `convex/` | Convex functions: authenticated chat pipeline, Jev routing, hybrid RAG search, memory, adviser requests |
| `lib/` | Pure TypeScript with Vitest tests: routing, calculators, number guards, answer composer |
| `agents/`, `evals/` | Generated agent setup and labeled evaluation cases |
| `raiffy-spec/` | The product specification; `CLAUDE.md` and `DESIGN.md` hold the build and design rules |

Convex (database, vector search and agent functions) runs in a Convex cloud deployment. Everything else runs locally or in Docker.

## Run with Docker

You need Docker with Compose v2.24 or later, and `web/.env.local` filled in from `web/.env.example`.

```bash
docker compose --env-file web/.env.local up --build web    # the app on http://localhost:3000
docker compose run --rm checks                              # every backend test and type check
```

To give the demo its own deployment (so nobody else's push can change it), create one in the Convex dashboard, set its server keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TYPESAFE_API_KEY`, `RAIFFY_JEV_ENABLED`, `CLERK_JWT_ISSUER_DOMAIN`; see `.env.example`) with `pnpm exec convex env set`, then push the functions with its deploy key:

```bash
CONVEX_DEPLOY_KEY=... docker compose --profile deploy run --rm convex-deploy
```

Then import and embed the documents into it as described in `progress.md` → How to run.

## Run without Docker

```bash
pnpm install && pnpm test && pnpm typecheck     # backend
cd web && pnpm install && pnpm dev              # app on http://localhost:3000
```

`progress.md` records what is built, the decisions and how to run each part.
