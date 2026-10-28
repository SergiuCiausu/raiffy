# Raiffy spec bundle

Build specification for Raiffy, Raiffeisen Bank Romania's AI financial assistant, split into Markdown files for Claude Code.

## How to use

1. Copy `CLAUDE.md` and the `docs/` folder into the root of your app repository.
2. Add the BMW X5 answer-screen mockup (exported HTML plus a screenshot) to `docs/ui/`.
3. Start Claude Code in the repo. `CLAUDE.md` tells it to read `docs/00-overview.md` first and then only the files each task needs.
4. A good first prompt: "Read docs/00-overview.md and docs/shared/answer-schema.md, then scaffold the Answer envelope, the 12 block types with Zod validators, and the block renderer registry."

## What's inside

Content comes from four planning docs: "Solutions by Category" (individuals), "Solutions by Category — Business", "Business Track Plan" and "Individuals vs Businesses", plus the product decisions agreed in the planning conversation (`docs/decisions/product-decisions.md`). The app name was changed from the working title to Raiffy. See `docs/00-overview.md` for the file map.

Facts taken from websites (Raiffeisen product terms, tax values, regulation status) are as of October 2026 and must be confirmed by Raiffeisen's legal, compliance and tax teams before production. The spec defines requirements, not live data.
