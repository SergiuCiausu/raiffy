# chat.html UI improvement plan (SDS grammar)

Scope: `chat.html` only. Source: an audit of the file against the `/sds-ui` playbook (hard rules, §5 truncation, §6 shapes, §7 elevation, §11 motion, §12 status, §14 anti-patterns).

**Palette is frozen.** No colour value is added, removed or changed. Where the plan says "token", it means giving a colour that's already in the file a name on `:root`, with exactly the same value.

## Stance

The SDS playbook has two stances. Raiffy follows neither exactly, and `DESIGN.md` stays the authority. This plan takes the SDS **grammar**: tokens, truncation, status words, muted vs facts, motion restraint, z-layers. It keeps Raiffy's **vocabulary**: palette, Geist, the bloom, the copy voice.

| SDS choice | For chat.html |
| --- | --- |
| Type | One family + mono (Geist + Geist Mono). Already true. |
| Colour | Frozen. Neither a ramp nor two-hue; it's DESIGN.md's ink + yellow/amber light. |
| Elevation | Hairlines + ground change, plus one float shadow. Needs decision D3. |
| Shell | Sidebar + content, with drawers on narrow screens. Already true. |
| Motion | Minimal: 150ms colour/border. Needs decision D2. |

## Phase 1: fixes that don't conflict with DESIGN.md

### 1.1 Name the colours already in use (values unchanged)

There are 46 inline hexes and about 15 repeated `rgba()` literals in rules. Lift them to `:root` with their exact values, then use `var(--…)` everywhere. These are names for existing colours, not new ones:

| Token | Value | Used at |
| --- | --- | --- |
| `--tint-rec` | `#FFF3C4` | 144, 211, 234, 235, 307, 450 |
| `--tint-rec-soft` | `#FFFCF0` | 233 |
| `--tint-rec-card` | `#FFFDF5` | 275 |
| `--tint-hl` | `#FFF8DC` | 180, 231, 318, 392, 447, 460 |
| `--surface-3` | `#FBFAF8` | 160, 222, 382 |
| `--surface-warm` | `#FBFAF6` | 240, 289 |
| `--bubble` | `#EFEDE8` | 141 |
| `--track` | `#E9E6DE` | 256–258, 304, 387 |
| `--off` | `#D9D5CB` | 68, 442 |
| `--amber-ink` | `#7A5A00` | 144, 308, 450 |
| `--amber-ink-2` | `#6B5200` | 210, 447 |
| `--amber-ink-3` | `#8A6A00` | 322 |
| `--ok-bg` | `#F1F8F3` | 207, 352 |
| `--ok-ink` | `#1E5B37` | 207, 208, 352 |
| `--ok` | `#2E7D4F` | 209, 463 |
| `--rec-line` | `rgba(200,150,20,.3)` | 318, 392, 460 |
| `--hover-fill` | `rgba(20,20,20,.04)` / `.05` | 78, 114 (kept as two tokens) |
| `--border-hover` | `rgba(20,20,20,.24)` | 77, 191, 270 |

Alphas that are close but not equal, such as `.35`/`.4`/`.18` on the rec line and `.24`/`.26`/`.14` on hover borders, stay separate tokens. Merging them would change the palette.

### 1.2 Contrast and "Muted is not for facts"

- `--text-3` (`#8E8E93`) on `--bg` measures **3.1:1**, below AA (4.5:1) for small text. This doesn't change the palette: real text moves to `--text-2` (6.4:1), and `--text-3` keeps placeholders, kbd hints and decoration.
- **Facts currently in muted that move to ink (`--text-1`):**
  - The "rates 28 Oct" date in card headers (`.gc-h .micro`, 220).
  - Statement amounts (`.line .amt`, 315).
  - The "Done" status in the documents checklist (903).
  - Dates on chats in the sidebar (`.conv small`, 112).
  - Saved-simulation figures (`.pin small`, 453).
- **Explanations on tinted grounds that step up to `--text-2`:**
  - Card notes (`.gc-note`, 222).
  - The "when the other option fits better" line (`.rec-alt`, 247).
  - The simulator's alternative line (`.sim-say .alt`, 293).
  - Option notes (`.opt-note`, 288).
  - The liquidity legend (`.legend`, 310).
  - The disclaimer (422).
- The thinking panel (160) stays dimmed, as DESIGN.md asks. It isn't a fact.

### 1.3 Truncation and grids

- **Grids holding a figure that won't wrap: `1fr` becomes `minmax(0, 1fr)`.**
  - `.save` (297), `.line` (314), `.pin` (449), `.perm` (437), `.ck` (330).
  - `.why-row` (320), `.rec-why li` (245), `.check` (344), `.promise` (462), `.src-item` (456), `.think-line` (169).
  - Paired grids become `repeat(2, minmax(0, 1fr))`: `.opts` (271) and `.starters` (374). `.terms` (266) becomes `repeat(5, minmax(0, 1fr))`.
  - `.cmp` (226) becomes `minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr)`.
- **Flex rows:**
  - `.gc-h > span:first-child` (218): add `min-width: 0` and truncate the label; the icon gets `flex: none`.
  - `.kv` (283): the label gets `min-width: 0`, and the value gets `white-space: nowrap; flex: none`.
  - `.adv > div` (337): add `min-width: 0`.
  - `.file-chip` (142): the filename gets its own span that truncates, and the size `small` doesn't shrink.
- **Never truncate a fact.** At 520px or less, the comparison table (225–226) scrolls sideways (`min-width: 440px`). Instead, it **restacks**: one block per option, label/value rows in one shared template, and the recommended block first with its badge. Nothing is cut and nothing scrolls.
- The chat title is cut in JS at 40 characters (1237). Instead, store the full title, truncate with CSS ellipsis, and put the full text in `title`.

### 1.4 Type scale consolidation

The file uses 11 font sizes: 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15 and 16px. Collapse them onto DESIGN.md's steps and add the missing tokens:

| Token | Size | Takes |
| --- | --- | --- |
| `--text-eyebrow` | 11px | 10, 10.5, 11: kbd, badges, eyebrows |
| `--text-micro` | 12px | 11.5, 12: meta, notes, sources |
| `--text-xs` | 13px | 12.5, 13: buttons, chips, card body |
| `--text-sm` | 14px | 13.5, 14 |
| `--text-body` | 15px | 15 |

The 16px size stays only for the mobile textarea, to stop iOS zooming.

**Money in rows:**
- DESIGN.md says Geist Mono for amounts, but today only `.line .amt` uses it.
- Make every amount in a column or row mono with tabular figures: `.cmp` cells, `.kv b`, `.save .rt` and `.line .amt`.
- `.big`, the one headline figure per card, stays Geist 600 with proportional figures (SDS §9.6).

### 1.5 Status says its name

- Liquidity bars (882): today they're four bars with an `aria-label` on a plain `div`, which screen readers skip.
  - Add the visible word next to the bars ("Anytime", "At maturity", "With notice").
  - Give the bars `role="img"`.
- "Done" in the checklist becomes ink text (see 1.2).
- `.vstat` and `.rec-badge` already print their words. No change.

### 1.6 Estimates are labelled

The simulator's figures are computed, not read from the bank. Its header gets an "Estimate" label next to "rates 28 Oct", and so do the savings rows. This fits Raiffy's "every number has a source" rule.

### 1.7 Drawers, z-layers and keyboard

- **Z-index tokens:**
  - `--z-float: 30` for the "Jump to latest" button (currently 2, line 424).
  - `--z-drawer: 50` for the drawers and their scrim (currently 40 and 30, lines 466, 470, 477). Open drawers behave like modals, so they must sit above every floating element.
- **Open drawers become real modal dialogs:**
  - `role="dialog"`, `aria-modal="true"`, and `inert` on `.main`.
  - Focus moves into the drawer and returns to the button that opened it.
  - Escape already closes them (1536).
- Drawer shadows (`-20px 0 50px rgba(20,20,40,.12)`, lines 470 and 477) are heavier than DESIGN.md's limit. They switch to the existing `--shadow-float`.

### 1.8 One primary action per screen

- Older answers keep their ink handoff buttons, so several primaries pile up down the thread.
- Only the **latest** answer's handoff stays ink; earlier ones render as ghost buttons.
- Send stays ink. "Talk to an advisor" stays ghost.

### 1.9 Icons and the reduced-motion safety net

- **Icon sizes:** the file uses 11, 12, 13, 14, 15, 16, 17 and 19px. Collapse them onto the SDS matrix:
  - 12px inside badges.
  - 14px inline with 12–13px text.
  - 16px in buttons.
  - 18px in card rows and avatars.
- Check in the browser that the Lucide SVGs come out `aria-hidden`; add it in `icons()` if not.
- **Reduced motion:** the reduced-motion block (509–511) only covers the drawers and the switch. Replace it with the global safety net from SDS §11:
  - `animation-duration` and `transition-duration` set to `.01ms`.
  - Iteration count 1.
  - `scroll-behavior: auto`.

## Phase 2: conflicts with DESIGN.md (decide first)

The project rule is to ask before deviating from `DESIGN.md`. **Decided on 28 Oct 2026:** D1–D4 use the recommendation below. D5 wasn't asked and uses its recommendation unless changed.

| # | SDS rule | DESIGN.md today | Recommendation |
| --- | --- | --- | --- |
| **D1** | The pill shape is reserved for status | Chips (401), sources (177), "Jump to latest" (423) and badges (235, 84) are all pills | Pills only for labels you read: `.rec-badge`, `.pill`, verification status. Pressable things become `--radius-btn` (10px) rectangles: chips, sources, "Jump to latest". |
| **D2** | No scale presses, no translate entrances | Presses use `scale(.97)` (64, 73, 190, 378, 403); messages and starters rise 8px (490–506); the range thumb grows (262) | Presses become a background or border colour change. Messages and starters fade in, without moving. Drawers keep sliding (that's functional). The typing dots and caret stay: they're progress indicators, like a spinner. |
| **D3** | Commit to hairlines or to shadows | Cards use hairline + `--shadow-card`; the active chat uses a shadow and a ring (113); starters lift on hover (379) | Hairlines + ground change in the thread and sidebar: drop `--shadow-card` from `.gcard` and `.starter`, and mark the active chat with `--surface` + a border. `--shadow-float` stays only on things that really float: composer, jump button, drawers. `.vreq` (194) sits in the thread, so it loses its shadow. |
| **D4** | 14px floor for text | DESIGN.md allows 10.5–12px micro text | Keep DESIGN.md's micro sizes (12px meta, 11px badges and eyebrows) for short labels, and lift any **sentence** under 13px to 13px: notes, explanations, `.vstat`, the disclaimer. |
| **D5** | Small radii budget (4/6/12–16 + pill) | 12 distinct radii: 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 999 | Six tokens: `--radius-xs` 4 (bars, tracks), `--radius-sm` 6 (kbd, checkboxes, inline highlights), `--radius-md` 8 (icon buttons, rows, slots), `--radius-btn` 10, `--radius-card` 14 (cards, thinking panel, panels), `--radius-lg` 16 (composer, starters, bubble), plus the pill. |

After the decisions, update `DESIGN.md` (§ Components, § Motion, Checklist) so the chosen rules become part of the design language. That keeps `raiffy.html`, `smart-mobile.html` and the console from drifting.

## Not in scope

- Any colour value. Copy voice, information architecture, the answer flows and the scripted logic stay as they are.
- Other pages. The same pass can follow on `smart-mobile.html` once chat.html is done.
- **The SDS "format on the server" rule** doesn't apply to an HTML prototype. `fmt()` (665) already formats with a fixed separator, not the browser locale, which is the risk that rule guards against. At the Next.js conversion, formatting goes through one shared helper with a fixed `en` locale, as the project's CLAUDE.md asks.

## Verification

- At 1440, 1024, 860, 520 and 375px:
  - No horizontal scroll, the comparison restacks, and no figure is truncated.
  - Every Phase 1 fact is ink.
- With the gstack browse tool:
  - Run every demo flow (compare, sim, savings, fee, docs + booking, hand-off, verification).
  - Open and close both drawers with Tab focus checked, close with Escape, and check reduced motion.
  - No console errors.
- Search the CSS for any remaining `#` hex or `rgba(` outside `:root`. Diff the `:root` values against the current file to prove the palette is unchanged.
- Run the DESIGN.md checklist.
