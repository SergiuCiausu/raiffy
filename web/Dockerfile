# The Raiffy web app (Next.js 16). Convex runs in the team's cloud deployment; this image only serves the app.
# Build and run from the repo root with: docker compose --env-file web/.env.local up --build web
FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Public values only: Next inlines NEXT_PUBLIC_* into the browser bundle at build time.
ARG NEXT_PUBLIC_CONVEX_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
RUN pnpm build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
# CLERK_SECRET_KEY arrives at runtime from the env file, never at build time.
CMD ["pnpm", "start", "-H", "0.0.0.0", "-p", "3000"]
