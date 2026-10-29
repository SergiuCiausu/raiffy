## What changed

<!-- One or two sentences: the behaviour a reviewer or judge will see. -->

## How it was checked

- [ ] `pnpm test` and `pnpm typecheck` (root), `pnpm convex:typecheck`
- [ ] `cd web && pnpm test && pnpm typecheck` if the app changed
- [ ] `pnpm agent:check-setup` if `lib/agent/` changed

## Before opening

- [ ] Branch is scoped to one change; the commit messages say what changed (no "Initial commit", "wip" or "update")
- [ ] No archives, logs, `.env*` files, `.gstack/`, macOS `._*` files or design assets that aren't used by the app
- [ ] No functions pushed to the shared dev deployment without telling the team
