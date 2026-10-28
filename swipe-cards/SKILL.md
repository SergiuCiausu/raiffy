---
name: swipe-cards
description: Build Tinder-style swipeable card stacks. Swipe right to save/match and left to skip, with the card tilting toward the swipe direction (up to ±30°), LIKE/NOPE stamps, fly-out and snap-back animations. Use when the user asks for swipe cards, a Tinder-like deck, swipe right/left to like/dismiss, or a draggable card that rotates as it moves.
---

# Swipe Cards (Tinder-style)

Recreate the Tinder card-stack interaction:
- **Drag right → save / match** ("LIKE" stamp, green)
- **Drag left → skip / not match** ("NOPE" stamp, red)
- The card **tilts toward the swipe**: dragging right tilts it right (clockwise, up to +30°), dragging left tilts it left (counter-clockwise, up to -30°). Where the card was grabbed doesn't matter.
- Released past a threshold (distance OR flick velocity) the card **flies off-screen** and continues rotating; otherwise it **springs back** to center.
- The card underneath **scales up** as the top card moves away, so the stack feels physical.

## Workflow

1. **Detect the stack.** Check the project for the framework (React/Next, Vue, Svelte, plain HTML, React Native). Look for an existing gesture/animation library (`framer-motion`, `@use-gesture/react`, `react-spring`, `react-native-reanimated` + `react-native-gesture-handler`). Use what is installed; don't add a dependency when the pointer-event implementation will do.
2. **Pick the reference to adapt:**
   - Plain HTML/JS, Vue, Svelte, or anything non-React → `references/vanilla.html` (framework-free `SwipeDeck` class; port the logic into the component).
   - React / Next.js → `references/SwipeDeck.tsx` (no dependencies; hooks + pointer events).
   - React with framer-motion already installed → the framer-motion snippet below.
   - React Native → the Reanimated notes below.
3. **Wire the callbacks** to the app's data: `onSwipe(item, "right" | "left")` is where saving/matching or skipping happens. Never put business logic in the animation code.
4. **Add the accessible controls** (buttons + arrow keys) — always, not optionally. See "Accessibility".
5. **Verify** by actually running it (dev server / open the HTML) and checking every item in the checklist at the bottom.

## The mechanics (get these numbers right)

All values are tunable constants at the top of the implementation.

| Constant | Default | Meaning |
|---|---|---|
| `SWIPE_THRESHOLD` | `0.3` | Fraction of card width the card must travel to commit a swipe |
| `VELOCITY_THRESHOLD` | `0.5` px/ms | A flick faster than this commits even below the distance threshold (must also be moving in the same direction as the drag) |
| `MAX_ROTATION` | `30` deg | Tilt at a drag of one full card width (clamped to ±30) |
| `FLY_OUT_ROTATION` | `30` deg | Final rotation as the card leaves the screen, same sign as the swipe |
| `FLY_OUT_MS` | `300` | Fly-out duration |
| `SNAP_BACK_MS` | `400` | Snap-back duration, with overshoot easing `cubic-bezier(.175,.885,.32,1.275)` |
| `NEXT_CARD_SCALE` | `0.95` | Scale of the card below; interpolates to `1` as top card nears the threshold |

**Tilt formula** (the core of the "feel"):

```
progress  = dx / cardWidth                         // -1 … 1 roughly
rotation  = clamp(progress * MAX_ROTATION, -MAX_ROTATION, MAX_ROTATION)   // right → +, left → −
transform = translate(dx, dy) rotate(rotation deg)
```

Use `transform-origin: center`. The vertical offset `dy` follows the finger freely (Tinder lets you drag diagonally), but only `dx` decides the outcome.

**Stamp opacity:** `likeOpacity = clamp(dx / (cardWidth * SWIPE_THRESHOLD), 0, 1)`, `nopeOpacity` the same with `-dx`. Stamp reaches full opacity exactly when the swipe would commit — this is the user's feedback that letting go will count.

**Commit decision on release:**
```
committed = |dx| > cardWidth * SWIPE_THRESHOLD
         || (|vx| > VELOCITY_THRESHOLD && sign(vx) === sign(dx))
direction = dx > 0 ? "right" : "left"
```

**Fly-out:** animate to `x = direction * (window.innerWidth + cardWidth)`, keep `y = dy + vy * FLY_OUT_MS` (so it leaves along its trajectory), `rotate = direction * FLY_OUT_ROTATION` (+30° right, -30° left). Call `onSwipe` when the animation ends (with a timeout fallback in case `transitionend` doesn't fire), then remove the card.

**Velocity:** track an exponentially smoothed velocity on every pointermove (`v = 0.8*v + 0.2*instant`); a single last-sample velocity is too noisy.

## Implementation rules

- **Pointer Events**, not separate mouse/touch handlers. Call `setPointerCapture` on `pointerdown` so the drag continues when the pointer leaves the card. Handle `pointercancel` as a snap-back.
- Only the **top card** is draggable. Render at most 3 cards in the DOM; the rest are data.
- Animate only `transform` and `opacity`. Set `transition: none` while dragging, and add the transition back only for fly-out / snap-back. Add `will-change: transform` to the top card.
- CSS on the card: `touch-action: none; user-select: none;`. Images inside: `draggable="false"` and `pointer-events: none`, otherwise the browser's native image drag hijacks the gesture.
- If the card has a tappable element (e.g. "info" button), treat a pointerup with total movement < 5px as a tap, not a swipe.
- Lock input while a card is flying out, so a double swipe can't skip two cards.
- Programmatic swipes (buttons, keys) go through the **same** fly-out function as gestures, so they look identical.
- Expose `onSwipe(item, dir)` and `onEmpty()`; optionally `undo()` that re-inserts the last card with a reverse fly-in.

## Accessibility (required)

- Visible ✕ and ♥ buttons under the deck that trigger left/right swipes.
- `ArrowLeft` / `ArrowRight` keys when the deck has focus (`tabindex="0"`, `role="group"`, an `aria-label` like "Profile cards").
- Announce the outcome in an `aria-live="polite"` region ("Saved Alex", "Skipped Alex").
- Respect `prefers-reduced-motion: reduce`: skip the tilt and rotation, use a short opacity fade instead of a fly-out.

## framer-motion variant (React, when already installed)

```tsx
const x = useMotionValue(0);
const rotate = useTransform(x, [-300, 0, 300], [-30, 0, 30]);
const likeOpacity = useTransform(x, [0, 100], [0, 1]);
const nopeOpacity = useTransform(x, [-100, 0], [1, 0]);

<motion.div
  drag
  dragSnapToOrigin
  style={{ x, rotate }}
  onDragEnd={(_, info) => {
    const w = ref.current!.offsetWidth;
    if (Math.abs(info.offset.x) > w * 0.3 || Math.abs(info.velocity.x) > 500) {
      const dir = info.offset.x > 0 ? 1 : -1;
      animate(x, dir * (window.innerWidth + w), { duration: 0.3 })
        .then(() => onSwipe(item, dir > 0 ? "right" : "left"));
    }
  }}
/>
```
Replace `[-300, 300]` with `[-cardWidth, cardWidth]` if the card width is known.

## React Native variant

Use `react-native-gesture-handler` `Gesture.Pan()` + `react-native-reanimated` shared values. Same math: `translateX`, `translateY` from `event.translationX/Y`; rotation via `interpolate(translateX, [-width, 0, width], [-30, 0, 30], Extrapolation.CLAMP)`; on `onEnd` check `translationX` vs `width * 0.3` or `velocityX` vs 800, then `withTiming` off-screen and `runOnJS(onSwipe)(...)`, else `withSpring(0)`.

## Verification checklist

Run the result and confirm each of these before saying it's done:
- [ ] Slow drag right past ~30% width → LIKE stamp fully visible → release → card flies right, `onSwipe(..., "right")` fires once.
- [ ] Same for left / NOPE.
- [ ] Short drag (below threshold), slow release → springs back with slight overshoot, nothing fires.
- [ ] Short fast flick → commits.
- [ ] Dragging right tilts the card right (clockwise) and dragging left tilts it left (counter-clockwise), whether grabbed at the top or bottom; tilt tops out at ±30°.
- [ ] Card below scales up while dragging and becomes draggable after the swipe.
- [ ] Buttons and arrow keys produce the same animation.
- [ ] Works with mouse and touch (test with device emulation); dragging outside the card keeps tracking.
- [ ] Empty state shows after the last card.
- [ ] Reduced-motion setting replaces the fly-out with a fade.
