/*
 * The starter vignette clips as data. Each moving part carries `data-beat="<kind> <frame> [<frames>]"`, and the
 * same table drives two players: the live chat plays it with the Web Animations API (transform and opacity only,
 * so the browser can run it off the main thread), and Remotion Studio seeks the very same animations frame by
 * frame for previews and exports. Every beat ends on the element's resting CSS, so the still picture is the
 * last frame.
 */

export const FPS = 30;
export const DURATION = 42;

// DESIGN.md --ease-out
export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

export type BeatKind = "fade" | "rise" | "pop" | "slide" | "drop" | "shift" | "fill" | "rail" | "blink";

export const BEAT_LENGTH: Record<BeatKind, number> = {
  fade: 8, rise: 10, pop: 8, slide: 12, drop: 10, shift: 10, fill: 16, rail: 16, blink: 6,
};

export type Beat = { kind: BeatKind; at: number; len: number };

export const frameMs = (frames: number) => (frames * 1000) / FPS;

export function parseBeat(attr: string): Beat | null {
  const [kind, at, len] = attr.trim().split(/\s+/);
  if (!(kind in BEAT_LENGTH)) return null;
  const start = Number(at);
  if (!Number.isFinite(start) || start < 0) return null;
  const frames = len === undefined ? BEAT_LENGTH[kind as BeatKind] : Number(len);
  if (!Number.isFinite(frames) || frames <= 0) return null;
  return { kind: kind as BeatKind, at: start, len: frames };
}

const enter = (from: string): Keyframe[] => [{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }];
const move = (from: string): Keyframe[] => [{ transform: from }, { transform: "none" }];

/**
 * Keyframes per beat. `shift`, `fill` and `rail` never touch opacity, so dimmed layers keep theirs. A `blink`
 * (the selection passing over a slot) ends at opacity 0, which is the resting CSS of a passing highlight.
 */
export function beatKeyframes(kind: BeatKind, len: number): Keyframe[] {
  switch (kind) {
    case "fade": return [{ opacity: 0 }, { opacity: 1 }];
    case "rise": return enter("translateY(6px)");
    case "pop": return enter("scale(0.6)");
    case "slide": return enter("translateX(24px)");
    case "drop": return enter("translateY(-8px)");
    case "shift": return move("translateY(6px)");
    case "fill": return move("scaleX(0)");
    // The knob's rail is as wide as the fill, so sliding it by its own width keeps the knob on the fill's end.
    case "rail": return move("translateX(-100%)");
    case "blink": {
      const edge = Math.min(0.5, 2 / len);
      return [{ opacity: 0, offset: 0 }, { opacity: 1, offset: edge }, { opacity: 1, offset: 1 - edge }, { opacity: 0, offset: 1 }];
    }
  }
}

/** One animation per `[data-beat]` under `root`, held at its first frame until played (fill: backwards). */
export function createBeats(root: Element, delayMs = 0): Animation[] {
  const beats: Animation[] = [];
  root.querySelectorAll<HTMLElement | SVGElement>("[data-beat]").forEach((el) => {
    const beat = parseBeat(el.getAttribute("data-beat") ?? "");
    if (!beat) return;
    beats.push(el.animate(beatKeyframes(beat.kind, beat.len), {
      delay: delayMs + frameMs(beat.at),
      duration: frameMs(beat.len),
      easing: beat.kind === "blink" ? "linear" : EASE_OUT,
      fill: "backwards",
    }));
  });
  return beats;
}
