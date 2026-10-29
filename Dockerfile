# Backend toolchain: the pure TypeScript modules (lib/), the Convex functions and their tests.
#   docker compose run --rm checks          tests, type checks and the generated agent setup
#   docker compose --profile deploy run --rm convex-deploy   push the functions to the deployment of CONVEX_DEPLOY_KEY
FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
CMD ["sh", "-c", "pnpm test && pnpm typecheck && pnpm convex:typecheck && pnpm agent:check-setup"]
