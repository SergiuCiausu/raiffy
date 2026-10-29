# Handoff: mobile-first UI pass

29 Oct 2026. The user asked for the whole UI to be mobile-first, page by page, with a clean layout at phone width. The rules are in `DESIGN.md` §12 (read it first). The work runs in four phases. **Phases 0, 1 and 2 are done and synced into the app. Phase 3 is not started.**

## Git state (read this first)

- The branch `starter-vignette-motion` is pushed, and **PR #9** (https://github.com/SergiuCiausu/raiffy/pull/9) is open into `main`.
- `origin/main` is **merged into the branch** (29 Oct). All 18 conflicted files are resolved: the branch's agent pipeline is the base, and main's PR #8 features are ported in. What was kept, ported or left out is in the top entry of `progress.md`.
- `convex/_generated/` is now committed, following main, and was regenerated for the merged code with `convex codegen`.
- Checks after the merge: root 694 tests, `pnpm typecheck`, `pnpm convex:typecheck`; `web/` 60 tests, `tsc` and lint. All pass.
- **Left out on purpose:** `.gstack/*.log`/`.jsonl` (browse tool logs) and the root `cancel-ask.png` and `chat-cancelled.png`. Main's PR #8 removed tracked clutter like this.
- The mobile-first work itself doesn't touch the conflicted agent files, except that `web/styles/agent.css` still needs its Phase 2 pass. Do that pass after the merge.

## Decisions the user made

- **44px touch targets on every page**, staff pages (console, admin) included.
- English only, and `DESIGN.md` stays the source of truth (see `CLAUDE.md`).

## Where it stands

`cd web && pnpm audit:mobile` → **48/48 views pass** at 375 and 390px (no sideways scroll, hit areas ≥44px, text ≥11px, fields ≥16px). About 150 warnings remain for sentences under 13px. Those belong to Phase 2.

### Phase 0 (done)
- `DESIGN.md` §12 "Mobile first": `min-width` breakpoints only (480/640/760/860/960/1100, plus 1440 for the review workspace), 44px hit areas, an 11px text floor, the first screen does the job, three patterns (tables become cards, chip rows scroll, vignettes fit) and drawers. The checklist has a mobile item.
- `web/scripts/audit-mobile.mjs` (`pnpm audit:mobile`, with `--only <prefix,…>`, `--app http://localhost:3000` and `--no-shots`). It writes `web/.mobile-audit/report.md`, `report.json` and full-page screenshots. That folder is git-ignored, and other sessions overwrite it when they run `--only`.

### Phase 1: shared components (done in the prototypes)
- **Touch core:** the same CSS sits in all 8 prototypes between `/* §12-touch:start */` and `/* §12-touch:end */`, at the end of each page's first `<style>`. Under `(pointer: coarse)` it gives every control a `::before` hit area (`inset: min(0px, calc((100% - 44px) / 2))`), 16px and 44px fields, and 44px-tall sliders. The page's own part follows inside the markers: drawn sizes and gaps (36px icon buttons with 8px gaps, so neighbouring hit areas just touch).
- **Text:** every 10, 10.5 and 9px declaration became 11px, at all widths. The 8.5px labels on the 3D hero slabs in `raiffy.html` are exempt.
- **Tables become cards:** `console.html` (`.tbl:not(.sched)`) and `admin.html` (`.tbl:not(.usr-tbl)`) are cards as the base and a table from 640px. The whole card opens the row (stretched first-cell link). A `labelCells()` script at the end of each page copies the `<th>` texts into `td[data-label]`. Admin #products, #rules and #users no longer scroll sideways.
- **Chip rows:** `swipe.html` `.chips` and `console.html` `.toolbar .chips` are one sideways-scrolling row on phones, bleeding to the screen edge, and wrap from 640px. A `chipEdges()` script fades the edge that has more chips.
- **Chat:** the composer placeholder is "Ask a follow-up" on coarse pointers.
- `pnpm sync:prototypes` has been run, so `web/styles/generated/*` match.

### The React gap left in Phase 1 (done)
- `components/staff/StaffShell.tsx` now ports `labelCells()` as an effect with a MutationObserver on `#content`. Every React staff table (`className="tbl"`) gets `data-label` on its cells, including rows that arrive later with live data; existing labels win, so `UsersAndRoles.tsx` keeps its own.
- The React rows already use the prototype classes (`tr.rowlink a.t-main`, `tr.click`, `td.go`), so the generated CSS makes the whole card tappable.
- Not seen in a browser yet: the staff routes need a signed-in Clerk session.
- `web/styles/admin.css` is dead code (nothing imports it, no page uses `.pg-admin`) and needs no pass. `web/styles/agent.css` is hand-written and still needs its Phase 2 pass.

None of this has been checked in the running Next.js app yet. Run `pnpm dev` and `pnpm audit:mobile --app http://localhost:3000` for the public routes. The signed-in staff and chat routes need a Clerk session.

## Phase 2: per page (done)
Rewrite each page's layout CSS mobile-first (base = phone, then `min-width` only), sync, fix the React-only styles, and check the audit plus the screenshots at 375 and 390px. In order of impact:

1. **Login** (done): `login.html`'s layout is mobile-first, with `min-width` queries only (the shared heading-token scale stays as it is).
   - Phones get a 161px brand strip (logo and tagline), so the sign-in options start on the first screen. The strip was 393px.
   - The illustration returns as a 200px band at 640px, and the sticky brand panel at 860px.
   - Field hints and consent sub-lines are 13px.
   - Synced into `/sign-in` and `/sign-up`. Checked with the audit (prototype and `--app`) at 375 and 390px, and with screenshots at 700 and 1280px.
2. **Console** (done): 14 queries converted.
   - **Review detail:** one column on phones, with the answer first and the conversation last. Answer plus facts come back at 960px, all three columns at 1440px. The section menu is hidden on phones.
   - **Calendar:** an agenda on phones, the week grid from 760px. Below 1100px "Next up" comes first (CSS `order` only, so focus order is unchanged).
   - **Sidebar:** the drawer is the base; the sidebar sits beside the page from 860px.
3. **Chat** (done): 10 queries converted in `chat.html` and 5 in `web/styles/agent.css`.
   - **Keyboard:** `interactive-widget=resizes-content` is in chat.html's viewport and in the `viewport` export of `/chat` and `/chat/demo`, so the composer stays above the Android keyboard.
   - **Drawers:** they fit at 375px. Their breakpoints (1200, 860) mirror the `matchMedia` max-width 1199/859 checks in chat.html, `AgentChat.tsx` and `ChatApp.tsx`, so change them together.
   - **Comparison tables:** the 3- and 4-option tables restack cleanly until 640px.
4. **Did you know** (done): 4 queries converted. Phones get tighter spacing and a 5:6 card, so Skip and Save end at 793px on 375×812. They were at 965px. Checked in the app too.
5. **Landing** (done): 8 queries converted. The chat-comparison, fee-statement and advisor-handoff vignettes fit their card at every width from 375 to 1280px (a check found no cut text).
6. **Admin** (done): 9 queries converted.
   - **Product editor:** one column with fields stacked until 640px; the side panel is sticky from 1100px.
   - **Analytics:** the data tables stay compact tables that scroll sideways (a 30-day series reads down its columns), bar-list labels sit above their bars on phones, and the KPI tiles are two per row.
7. **Plan, Smart Mobile** (done): 7 and 2 queries converted. On touch screens, Smart Mobile's composer placeholder now reads "Ask Raiffy" instead of mentioning Tab. `#raiffy`, `#apply` and `#repay` were checked by clicking through.

No layout `max-width` query is left in any prototype or in `agent.css`; only each page's shared heading-token block remains. Desktop at 1280px is pixel-identical on every page.
- **Checks:** prototype audit 48/48, app public routes 8/8, `web/` tsc, lint and 60 tests.
- **Left for later:**
  - About 150 sentences under 13px remain as warnings (meta and source lines).
  - The loan-vs-overdraft card inside a console review's answer scrolls sideways at 375px.
  - With the chat keyboard open, the disclaimer could hide to free about 40px.
  - The signed-in React pages (`/chat`, the staff routes) still need a pass in a browser with a Clerk session.

## Phase 3 (not started)
Run the audit inside Playwright (`web/playwright.config.ts` already has a mobile project, but e2e is disabled with `testIgnore`) so regressions fail.

## Gotchas
- **CRLF checkouts:** with `core.autocrlf` on, a merge or pull rewrites the prototypes with CRLF endings. `sync-prototypes.mjs` now normalizes them to LF before applying its patches. Before that fix, the `raiffy.html` footer patch failed with "patch target not found".
- **Shared `node_modules`:** running `pnpm exec` in `web/` after a lockfile change makes pnpm reconcile `node_modules`, and the other session's run left it without `next`. Only one session should run installs.
- **Probe rounding:** the audit probes 1px inside the 44px edge, because hit testing rounds to whole pixels. Hit areas that exactly touch pass. A failure line names what overlapped it.
- **Specificity:** the core uses `:where()`, so any page rule wins. A control styled `position: absolute` keeps it. A plain `select` lost to `.select`, which is why the field rules use `:is(input:not(…), select, textarea)`.
- **Clipping:** a horizontal scroller (`overflow-x: auto`) clips vertically, so chip rows need `padding-block` for the hit areas. `.crumbs` stretches to the header's height for the same reason.
- **Mobile-first table cards:** cells in a `display: grid` row become blocks on their own, so `.hide-sm` keeps working. Don't set `display` on `td`.
- **Shared tree:** another session (`raiffy-0f`) works in the same tree and committed everything as `13cbd91` on `starter-vignette-motion`. Nothing has been pushed.
