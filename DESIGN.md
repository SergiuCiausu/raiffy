# Raiffy · Design guidelines

A summary of the UI language used in `raiffy.html`, the concept landing page for **Raiffy**, an AI financial assistant for Raiffeisen Bank Romania. Any new page, section or component should follow it.

> The page feels premium because of **many small, correct details**, not big type. Headlines stay modest. The richness comes from cards with miniature product UI inside, light used as a material (soft glows), hairline borders and quiet secondary text.

## 1. Principles

1. **Show, don't tell.** Every feature gets a built UI fragment in HTML/CSS (chat with a comparison table, repayment slider, savings list, bank statement, document checklist). Never an icon with a paragraph.
2. **Light is a material.** Color shows up as diffused yellow/amber glow behind content. No flat gradient backgrounds, no gradient text.
3. **Quiet type, loud craft.** Small, tight, confident type. The craft lives in the visuals.
4. **Honest finance.** Options are shown side by side with the same amount, term and fields. **Raiffy recommends one financing option and always says why**: the reasons, plus when another option is the better pick. Every option stays visible and choosable, every number has a source pill, and the customer makes the final choice. All figures are illustrative and the copy is plausible and specific: real lei amounts, dates and Romanian places. No lorem ipsum, no emoji, no stock images.

## 2. Modes

The page is **Mixed** and switches mode exactly once: a **Nocturne** hero hands off to **Daylight** for everything else. Set the mode with `data-mode="nocturne" | "daylight"` on a section or the body.

| Token | Daylight | Nocturne |
|---|---|---|
| `--bg` | `#FAF9F7` | `#08080B` (hero base `#07070A`) |
| `--surface` | `#FFFFFF` | `#0E0E13` |
| `--surface-2` | `#F4F3F0` | `#15151C` |
| `--border` | `rgba(20,20,20,.07)` | `rgba(255,255,255,.06)` |
| `--border-strong` | `rgba(20,20,20,.12)` | `rgba(255,255,255,.12)` |
| `--text-1` | `#1A1A1A` | `#F4F4F6` |
| `--text-2` | `#5C5C5F` | `rgba(244,244,246,.66)` |
| `--text-3` | `#8E8E93` | `rgba(244,244,246,.42)` |

Never use pure black or pure white for text. Use three levels: primary, secondary, tertiary. The alternate section background (the "For the bank" section) is `#F4F3F0`.

## 3. Color and accent

- **One accent pair, close to the bank's yellow:** `--accent-a: #FFD23F` (yellow) and `--accent-b: #FF9A3D` (amber). Don't introduce other hues.
- On Daylight, the accent is **light, never text**: blooms, focus halos (`0 0 0 4px rgba(255,210,63,.35)`), highlighted rows (`#FFF8DC`, `#FFF3C4`) and the logo mark.
- **The primary "ink" is `#1A1A1A`.** Daylight uses it for filled buttons, active segments, slider fills, checkboxes and chart bars. Selection is shown with dark ink, not color.
- Badges/pills: 10.5–11px on a 12% tint of their color (`color-mix(in srgb, var(--c) 12%, transparent)`). Deep amber text (`#8A6A00`, `#7A5A00`) sits on yellow tints.
- Semantic green appears only for checks (`#2E7D4F`).
- `--danger: #B42318` is for form errors and failing checks only (`login.html`, `console.html`), never for decoration or "bad" options.
- **Never:** gradient text, rainbow gradients, purple/blue, neon outlines.

## 4. Typography

Font: **Geist** 400/500/600, with **Geist Mono** for amounts, times, codes, keyboard hints and the thinking panel. Loaded from Google Fonts.

| Token | Size | LH | Weight | Tracking |
|---|---|---|---|---|
| h1 | **36px** (30px under 640px) | 1.1 | 600 | -0.035em |
| h2 | 28px (24px) | 1.15 | 600 | -0.03em |
| h3 | 20px (18px) | 1.3 | 600 | -0.02em |
| h4 | 16px | 1.4 | 600 | -0.01em |
| lead | 17px | 1.55 | 400 | n/a, `max-width: 46ch`, `--text-2` |
| body | 15px | 1.6 | 400 | n/a |
| sm | 14px | 1.55 | 400 | card descriptions, `--text-2` |
| xs | 13px | 1.45 | 500 | buttons, nav, labels |
| micro | 10.5–12px | ~1.35 | 500 | inside mockups, pills |

- **No heading above 36px.** Build hierarchy with weight, color and spacing.
- Eyebrows: 11.5px, weight 500, uppercase, tracking `.08em`, `--text-3`. In the hero, add a glowing 6px yellow dot in front.
- Headings use `text-wrap: balance` and paragraphs `text-wrap: pretty`. Keep lines at 60ch or less.
- Numbers use `font-variant-numeric: tabular-nums`. Money is written `8,000 lei` and `696 lei / month`.

## 5. Layout and spacing

- Container: 1200px, gutter 24px (16px on mobile). Spacing snaps to a 4px grid.
- Section padding: 96px vertically (64px on mobile). Header block to content: 48px (32px on mobile). h1 to lead: 16px. Lead to CTAs: 28px.
- Section headers are **left-aligned** (`max-width: 620px`). Only the final CTA is centered.
- **Bento:** a 12-column grid with a 16px gap. The features use a zigzag of 7/5, then 5/7, then a full-width 12 card. The bank section uses 3 equal cards. Under 860px, everything collapses to one column.
- Deep-dive: a `5fr / 7fr` split (rules list on the left, live simulator card on the right), gap 48px.
- Breakpoints: 1100, 960, 860, 760, 640, 480px.

## 6. Surfaces

**Daylight card:** `#FFF` background, 1px `--border`, radius **20px**, shadow `0 1px 2px rgba(0,0,0,.04)`. The anatomy is a visual zone on top (260–320px tall, `aria-hidden`), then a body with 24px padding, an h4, an 8px gap and an sm description.

**Fragments (`.frag`)** inside visuals: white, hairline border, radius 14px, shadow `0 8px 30px rgba(20,20,40,.08)` (the heaviest allowed, except glows).

**Nocturne hero:** layered backdrop from bottom to top: base, haze (radial amber glows), smoke (SVG turbulence, screen blend), grid (192/32px lines), ghost UI (faint task card, checklist, stat, sparkline, icon dock), isometric art, grain (7% overlay), then the copy. Every layer is masked around one focus point (`--focus-x: 72%`, `--focus-y: 50%`) placed on the art, never behind the headline. A 140px bottom fade hands off into the page.

**Isometric stack (hero art):** three slabs (`rotateX(58deg) rotateZ(-45deg)`) tell the story: a comparison table, then a repayment simulation, then a glowing "You decide" chip. Slabs are 62px apart, with thin extruded sides, a floor glow and two floating notes. The stack orbits toward the cursor (iso-tilt) and gently bobs.

## 7. Product vignettes

The rules every vignette follows:
- Micro-type at 11–13px. Dense but legible, with product-specific copy.
- **Bleed:** at least one fragment runs past the card edge and fades out with a mask (`.fade-r`, `.fade-b`, `.fade-br`).
- **Depth:** dimmed duplicates (`.dim`, opacity .35) sit behind the focused element.
- **One moment of interaction** per vignette: a cursor arrow, a selected row, a slider knob with a yellow halo, or an active segment.
- **One bloom** per visual: a yellow+amber radial (`.bloom`, `--x/--y/--size`), placed off-center and partly clipped by the card. It's drawn with stepped gradient stops, not `filter: blur`.
- Raiffy's avatar: a dark ink circle with a yellow compass icon (`.ava-raiffy`).
- Icons: Lucide (pinned `lucide@0.468.0`), 11–16px.

## 8. Components

- **Nav:** fixed, 60px. Logo (24px yellow rounded mark plus "Raiffy *by Raiffeisen Bank*"), 4 links at 13.5px, then a ghost button and a dark button. No language switch: everything is English for now. It starts transparent over the hero, turns `.is-dark` (blurred) while over the hero and `.is-light` (blurred `rgba(250,249,247,.82)` with a hairline border) after it. Links and the ghost button hide under 860px.
- **Buttons:** 40px tall (34px in the nav), radius 10px, 13px at weight 500.
  - `.btn-dark`: ink background with white text. `.btn-ghost`: transparent with a `--border-strong` hairline.
  - Hero: `.btn-glow` is a 44px pill, 12px uppercase 600 text, a cream-to-yellow fill and a warm outer glow (the hover glow is on `::after` via opacity). `.btn-line` is a 44px pill with a translucent hairline.
  - Chips/quick replies: `.qbtn`, a 12px pill on the landing page. In product UI (`chat.html` onward), chips are 10px-radius rectangles (see Product UI rules).
- **Rules list:** a 28px icon tile, a 14.5px h4 and a 13.5px secondary text, separated by hairline rows.
- **KPI strip:** 3 cells in one bordered card with hairline dividers. Values at 20px/600 with tabular numbers.
- **Inputs:** a custom range with a 4px track (ink fill through `--p`) and an 18px white thumb that gets a yellow halo while active.
- **Swipe deck** (`swipe.html`): a 3/4 card stack, at most 3 cards in the DOM, with each card below 0.95 scale and 22px lower. Cards follow the Daylight card anatomy with a vignette zone on top. Drag tilts up to ±30° and commits at 30% of the card width or on a flick, and a short drag snaps back with overshoot. The stamps stay in the accent language: **Save** is ink on `#FFF3C4` with the yellow halo, and **Skip** is a `--text-2` hairline. No red/green. Controls are equal-size "Skip" (ghost) and "Save" (dark) buttons plus undo, arrow keys and an `aria-live` announcement. A large content set gets one vignette per topic (not per card) and `.qbtn` topic chips, with the active chip in ink. Under reduced motion, there's no tilt and a fade replaces the fly-out.
- **Recommendation:** exactly one option per comparison carries a `.rec-badge`: "Recommended" with a sparkles icon, ink on `#FFF3C4` with the yellow halo `0 0 0 3px rgba(255,210,63,.35)`. The recommended option gets a light tint (`#FFFCF0` column, `#FFFDF5` card, with `#FFF3C4` where it meets a highlighted row). The other options keep the same size and fields. Under it, a "Why I recommend…" block lists 2-3 reasons with check icons, then one line in `--text-3` saying when the other option is the better pick. The rule is deterministic and lives in code (cheapest option that fits, with a near-tie going to the fixed rate), never in the LLM. In live simulators, the badge and reasons move as the inputs change, with no transition.
- **Follow-up suggestions:** every answer ships with 2-3 **pre-generated follow-up replies**, shown as `.chip` buttons above the composer, so the customer can keep going without typing.
  - **Tab** with an empty composer fills it with the first suggestion. Tab again moves to the next one, and after the last one Tab moves focus as usual. **Enter** sends.
  - The next suggestion carries a mono `Tab` kbd hint, hidden on coarse pointers.
  - The placeholder reads "Ask a follow-up, or press Tab for a suggestion", and each fill is announced through the live region.
  - For a `detail` answer, one suggestion goes deeper into the same product and one opens a related Raiffeisen solution.
- **Thinking panel:** while Raiffy works, a dimmed panel above the answer (`#FBFAF8`, hairline border, radius 12px, Geist Mono 12px in `--text-3`) lists pre-written status lines, with the current one in `--text-2` and amber dots, and done lines ticked. When the text starts streaming, the panel folds into a `<details>` summary, "How I worked this out · 2 steps", that the customer can reopen. Then the answer streams word by word with a blinking caret.
- **Sign-in methods** (`login.html`): a dark "Continue with Raiffeisen" button with the yellow logo mark (an SSO placeholder, not wired), then equal ghost Google and Apple buttons with monochrome marks, an "or use your email" divider and an email magic-link form. Sign-up adds the required terms checkbox and a separate, unticked marketing-consent checkbox.
- **Raiffy inside Smart Mobile** (`smart-mobile.html`): a mobile-first app on the same tokens, shown full screen on a phone and in a 390×844 frame on desktop.
  - **Entry points:** an "Ask Raiffy" bar above the tab bar on Home, "Ask Raiffy about this" links (a `#FFFDF7` row with the Raiffy avatar and the pre-generated question in quotes), and the **Raiffy cards** on Home: one `#FFFDF7` card at a time with one bloom, a small title, a figure in bold and its source in `--text-3`, moved through with a swipe or the arrow buttons next to a mono "2 of 6" counter, and a × that offers "Not interested in this" or "Don't show these". A card the customer comes back to shows a bookmark line ("You looked at this on 28 Oct") with "Not interested" (ghost) and "Continue" (ink). No floating bubble.
  - **Routes card:** a recommendation's options as stacked rows (name, detail, figure on the right), the recommended one first with its badge and tint, then the "Why I recommend…" block and an optional handoff button.
  - **Raiffy sheet:** full height with a grab handle, a context chip on `#FFF8DC` ("From: Overdraft · 8,000 lei used"), tap chips above the composer.
  - **Compare on mobile:** one option per column, swiped with scroll snap, the recommended one first, with dots and "Swipe to compare".
  - **Handoff:** an ink "Apply in Smart Mobile" button with an arrow-up-right icon, a ghost secondary, and a lock note saying the customer signs in the app.
  - **One-time allow:** a card showing the object, with equal "Allow once" (ink) and "Not now" (ghost) buttons.
  - **Official screens** (apply, repay): white, no blooms, no Raiffy avatar, a "Smart Mobile" lock tag and a 4-step progress bar, so the customer can see they've left the assistant. Touch targets are at least 44px.
- **Human verification** (`chat.html`): an "Ask a specialist" `.vbtn` in each answer's footer and "Check my plan" on the simulator open an inline request panel (`.vreq`). It says what the specialist will see, has a "See what's sent" disclosure, an optional note, and the honest wait. The status comes back as a `.vstat` line: waiting (grey), confirmed or edited with the reviewer's name and time (check green), and "Changed after the specialist's check" (yellow tint) when the inputs move. Edited text shows added words on `#FFF3C4` and removed words struck through.
- **Console** (`console.html`): Daylight only, with a 240px sidebar (nav with ink count badges for work that needs you) and a demo-only Operator/Admin switch.
  - **Tables:** hairline rows, 11px uppercase headers, mono tabular numbers, whole rows clickable with a real link in the first cell. New rows get a 3px yellow inset on the left.
  - **Dated-value row** (`.dv`): name and what it means, the value in mono, then the source pill, start date, owner and review date always together. Past review date gets a `--danger` pill and a `#FFFCF0` row. Pending changes show under the value.
  - **Diffs:** added text or values on `#FFF3C4`, removed struck through in `--text-3`, never red/green.
  - **Checks** (`.chk`): a dot (green check, yellow minus for a warning, `--danger` cross for a failure) plus a title and one line of why. A failing check disables the action it guards.
  - **Editor sheet:** a native `<dialog>` from the right, 520px. Value, start date, required source, a note, and a live impact preview table where changed rows are tinted `#FFF8DC`.
  - **Review workspace:** conversation, answer and "built from" columns at 1440px or more, two columns below that, one column under 960px. Masked PII is a mono chip with an eye button, and unmasking asks for a reason.
  - **Analytics** (`admin.html#analytics`): one series per chart, in ink on a `#EFEDE8` track with 4px rounded data ends and a 2px gap between bars. Funnels are bar rows (label, bar, count, mono % of the first stage). Daily volume gets a hover tooltip and a "Data table" disclosure. Hidden counts (under the minimum group size) read `<10` in `--text-3`, never 0.
- **Footer:** a hairline top border, 13px `--text-3`, a 2fr + 3×1fr column grid and a legal row.
- **Focus:** `outline: 2px solid var(--ink); outline-offset: 2px` (yellow in Nocturne).

## 9. Motion

- Easing: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` and `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`. UI transitions run 150–200ms. Press feedback is `scale(.97)` over 160ms.
- Hover effects are gated behind `@media (hover: hover) and (pointer: fine)`.
- Reveal on scroll: `opacity` plus `translateY(12px)`, 600ms, with a 60–90ms stagger.
- Vignettes play **once** when revealed: replies rise in parts, cursors arrive, the slider knob glides, checks pop, the chart wipes in. Keyframes only define `from` with `backwards` fill, so the resting CSS is always the final state.
- Animate only `transform`/`opacity` (and the `translate` property). No animated `filter: blur`, `clip-path` or large box-shadows. Pause off-screen animation (blooms, the hero stack) with IntersectionObserver.
- Live controls (slider bars) get **no transition**, so they never lag the user's hand.
- Product UI is stricter than the landing page. See Product UI rules.
- Everything decorative sits in `@media (prefers-reduced-motion: no-preference)`. Under reduced motion, reveals become plain fades.

## 10. Accessibility and output

- Decorative visuals get `aria-hidden="true"`. Include a skip link, semantic landmarks and an `aria-label` on each nav and section.
- Real text meets AA contrast. Focus states are visible.
- At 375px: no horizontal scroll, h1 is 30px, grids are one column. Vignettes are simplified (dimmed extras dropped), never removed.
- Output: one self-contained HTML file with plain CSS tokens on `:root` and `[data-mode]`, Google Fonts and pinned Lucide from unpkg.

## 11. Product UI rules (chat.html onward)

Agreed on 28 Oct 2026 (`plans/chat-ui-plan.md`), applying the SDS grammar to the app pages. The landing page keeps its marketing motion and pills. The palette doesn't change.

- **Named colours only.** Every colour is a `var(--…)` on `:root`. A value that's already in use gets a name; no new values are added.
- **Pills are for read-only labels:** `.rec-badge`, status `.pill`, verification. Anything pressable is a rectangle: chips and "Jump to latest" at `--radius-btn` (10px), source tags at `--radius-sm` (6px). Toggle switch tracks stay rounded.
- **Radii:** `--radius-xs` 4 (bars, tracks), `--radius-sm` 6, `--radius-md` 8 (rows, icon buttons), `--radius-btn` 10, `--radius-panel` 14 (answer cards, thinking panel), `--radius-lg` 16 (composer, starters, bubble), `--radius-pill`.
- **Type steps:** 11 (`--text-eyebrow`), 12 (`--text-micro`), 13 (`--text-xs`), 14 (`--text-sm`), 15 (`--text-body`). Short labels may use 11–12px, but any sentence is at least 13px. 16px is kept only for the mobile textarea.
- **Elevation:** hairlines and ground change. Answer cards, starters and the active chat have no shadow. `--shadow-float` is the only shadow, used for things that float: the composer, "Jump to latest" and the drawers.
- **Motion:** presses change colour or border, never scale. Messages and cards fade in without moving. Drawers slide, and the typing dots and caret stay as progress indicators. A global reduced-motion safety net is the floor.
- **Facts are ink:** amounts, rates, dates, counts and statuses use `--text-1`. Explanations use `--text-2`. `--text-3` (3.1:1 on `--bg`) is only for placeholders, kbd hints, icons and the thinking panel.
- **Status says its name.** Savings access shows a word ("Anytime", "At maturity") next to the bars, and computed figures are labelled "Estimate".
- **Never truncate a figure.** Grids holding figures use `minmax(0, 1fr)`. On narrow screens the comparison table restacks (each row label on its own line, the options under it) instead of scrolling. Names and titles truncate, with the full text in `title`.
- **One primary per screen:** only the newest answer keeps an ink handoff button; older ones show as ghost.
- **Layers:** `--z-float` 30 for floating widgets, `--z-drawer` 50 for open drawers (the scrim sits one below). Open drawers are `role="dialog"` with `aria-modal`, the rest of the page is `inert`, Escape closes them and focus returns to the button that opened them.

## Checklist

- [ ] h1 is 36px or less, h2 28px, h3 20px, h4 16px
- [ ] Only the yellow/amber accent, used as light. Ink `#1A1A1A` for selection.
- [ ] Every feature card has a built vignette with product-specific copy and 11–13px micro-type
- [ ] One fragment bleeds and fades, one bloom, one interaction moment per card
- [ ] Hairline borders, no shadow heavier than `0 8px 30px` at .08–.1
- [ ] Options shown side by side, one recommended with its reasons and when another fits better, and sources cited
- [ ] Motion respects reduced motion, and hover is gated to fine pointers
- [ ] Mobile at 375px is clean, focus is visible, decorative visuals are `aria-hidden`
- [ ] Product UI: no raw colours outside `:root`, pills only on labels, facts in ink, no sentence under 13px, no shadow on in-page cards, no figure truncated
