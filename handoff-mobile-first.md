# Handoff: mobile-first UI pass

29 Oct 2026. The user asked for the whole UI to be mobile-first, page by page, with a clean layout at phone width. The rules are in `DESIGN.md` §12 (read it first). The work runs in four phases. **Phases 0 and 1 are done for the HTML prototypes. Phase 1 still has one React gap (below). Phases 2 and 3 are not started.**

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

### The React gap left in Phase 1 (do this first)
The generated staff CSS now stacks **React** staff tables as cards on phones too, but their cells have no `data-label`, so the labels are missing. These React components use `className="tbl"`: `components/staff/{ReviewsConsole,ProductsList,ProductDetail,RulesPage,AuditLog,AnalyticsDashboard,SentimentDashboard}.tsx`. `UsersAndRoles.tsx` already has its labels. Fix it in one of two ways:
- add a `data-label` per `<td>`, or
- port `labelCells()` (from the end of `console.html`) as a `useEffect` with a MutationObserver in `components/staff/StaffShell.tsx`.

Also check `web/styles/agent.css` and `web/styles/admin.css`. Those are hand-written and the sync doesn't cover them.

None of this has been checked in the running Next.js app yet. Run `pnpm dev` and `pnpm audit:mobile --app http://localhost:3000` for the public routes. The signed-in staff and chat routes need a Clerk session.

## Phase 2: per page (not started)
Rewrite each page's layout CSS mobile-first (base = phone, then `min-width` only), sync, fix the React-only styles, and check the audit plus the screenshots at 375 and 390px. In order of impact:

1. **Login** (`login.html`, `/sign-in`, `/sign-up`): the brand panel takes the first 393px, so the form is below the fold. Shrink it to a strip on phones.
2. **Console:** the review detail, the calendar agenda and the sidebar drawer. The queue cards from Phase 1 are done.
3. **Chat:** test with the keyboard open (`dvh`, composer above the keyboard), the drawer and the context panel, plus the React answer cards in `web/styles/agent.css`.
4. **Did you know** (`swipe.html`): the card and its Skip and Save buttons should fit on the first screen.
5. **Landing:** vignettes cut text mid-word ("Recommend…", "−186.4…"). Lay them out for the card width (§12 pattern 3).
6. **Admin:** forms in the product editor, and the analytics data tables (cards at the moment; they could stay tables).
7. **Plan, Smart Mobile:** small fixes. Smart Mobile's `#raiffy`, `#apply` and `#repay` reset to home on load, so check them by hand.

Also convert every remaining `max-width` layout query and the off-scale breakpoints (1199, 1439, 859, 759, 600, 560, 520, 479, 380) as each page is done.

## Phase 3 (not started)
Run the audit inside Playwright (`web/playwright.config.ts` already has a mobile project, but e2e is disabled with `testIgnore`) so regressions fail.

## Gotchas
- **Probe rounding:** the audit probes 1px inside the 44px edge, because hit testing rounds to whole pixels. Hit areas that exactly touch pass. A failure line names what overlapped it.
- **Specificity:** the core uses `:where()`, so any page rule wins. A control styled `position: absolute` keeps it. A plain `select` lost to `.select`, which is why the field rules use `:is(input:not(…), select, textarea)`.
- **Clipping:** a horizontal scroller (`overflow-x: auto`) clips vertically, so chip rows need `padding-block` for the hit areas. `.crumbs` stretches to the header's height for the same reason.
- **Mobile-first table cards:** cells in a `display: grid` row become blocks on their own, so `.hide-sm` keeps working. Don't set `display` on `td`.
- **Shared tree:** another session (`raiffy-0f`) works in the same tree and committed everything as `13cbd91` on `starter-vignette-motion`. Nothing has been pushed.
