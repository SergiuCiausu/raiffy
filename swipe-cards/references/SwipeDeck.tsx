// SwipeDeck.tsx — Tinder-style swipe cards for React. No dependencies.
// Right = save/match, left = skip. Card tilts toward the swipe: right → +30°, left → -30°.
import React, { useCallback, useEffect, useRef, useState } from "react";

export type Direction = "left" | "right";

const SWIPE_THRESHOLD = 0.3;     // fraction of card width
const VELOCITY_THRESHOLD = 0.5;  // px/ms
const MAX_ROTATION = 30;         // deg at one card-width of drag
const FLY_OUT_ROTATION = 30;     // deg, same direction as the swipe
const FLY_OUT_MS = 300;
const SNAP_BACK_MS = 400;
const NEXT_CARD_SCALE = 0.95;
const VISIBLE = 3;
const SNAP_EASE = "cubic-bezier(.175,.885,.32,1.275)";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Props<T> = {
  items: T[];
  getKey: (item: T) => string;
  getLabel?: (item: T) => string;          // used for screen-reader announcements
  renderCard: (item: T) => React.ReactNode;
  onSwipe: (item: T, dir: Direction) => void;
  onEmpty?: () => void;
  emptyState?: React.ReactNode;
};

type Drag = { dx: number; dy: number; vx: number; vy: number };

export function SwipeDeck<T>({
  items, getKey, getLabel = () => "card", renderCard, onSwipe, onEmpty, emptyState,
}: Props<T>) {
  const [index, setIndex] = useState(0);
  const [announce, setAnnounce] = useState("");
  const topRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const drag = useRef<(Drag & { active: boolean; x0: number; y0: number; lx: number; ly: number; lt: number }) | null>(null);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const visible = items.slice(index, index + VISIBLE);

  useEffect(() => {
    if (index >= items.length && items.length > 0) onEmpty?.();
  }, [index, items.length, onEmpty]);

  const setNextScale = (progress: number, transition = "none") => {
    const n = nextRef.current;
    if (!n) return;
    n.style.transition = transition;
    n.style.transform = `scale(${NEXT_CARD_SCALE + (1 - NEXT_CARD_SCALE) * progress})`;
  };

  const paint = (el: HTMLDivElement, d: Drag) => {
    const w = el.offsetWidth;
    const rot = reducedMotion.current ? 0 : clamp((d.dx / w) * MAX_ROTATION, -MAX_ROTATION, MAX_ROTATION);
    el.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${rot}deg)`;
    const t = w * SWIPE_THRESHOLD;
    const like = el.querySelector<HTMLElement>("[data-stamp=like]");
    const nope = el.querySelector<HTMLElement>("[data-stamp=nope]");
    if (like) like.style.opacity = String(clamp(d.dx / t, 0, 1));
    if (nope) nope.style.opacity = String(clamp(-d.dx / t, 0, 1));
    setNextScale(clamp(Math.abs(d.dx) / t, 0, 1));
  };

  // shared by gestures, buttons and keys
  const flyOut = useCallback((dir: Direction, d: Drag = { dx: 0, dy: 0, vx: 0, vy: 0 }) => {
    const el = topRef.current;
    const item = items[index];
    if (!el || item === undefined || busy.current) return;
    busy.current = true;
    const sign = dir === "right" ? 1 : -1;
    const stamp = el.querySelector<HTMLElement>(`[data-stamp=${dir === "right" ? "like" : "nope"}]`);
    if (stamp) stamp.style.opacity = "1";
    setNextScale(1, `transform ${FLY_OUT_MS}ms ease-out`);

    if (reducedMotion.current) {
      el.style.transition = `opacity ${FLY_OUT_MS}ms`;
      el.style.opacity = "0";
    } else {
      el.style.transition = `transform ${FLY_OUT_MS}ms ease-out`;
      const x = sign * (window.innerWidth + el.offsetWidth);
      const y = d.dy + d.vy * FLY_OUT_MS;
      el.style.transform = `translate(${x}px, ${y}px) rotate(${sign * FLY_OUT_ROTATION}deg)`;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      busy.current = false;
      onSwipe(item, dir);
      setAnnounce(`${dir === "right" ? "Saved" : "Skipped"} ${getLabel(item)}`);
      setIndex(i => i + 1);
    };
    el.addEventListener("transitionend", finish, { once: true });
    window.setTimeout(finish, FLY_OUT_MS + 50);
  }, [items, index, onSwipe, getLabel]);

  const snapBack = (el: HTMLDivElement) => {
    el.style.transition = `transform ${SNAP_BACK_MS}ms ${SNAP_EASE}`;
    el.style.transform = "translate(0px, 0px) rotate(0deg)";
    el.querySelectorAll<HTMLElement>("[data-stamp]").forEach(s => {
      s.style.transition = `opacity ${SNAP_BACK_MS}ms`;
      s.style.opacity = "0";
    });
    setNextScale(0, `transform ${SNAP_BACK_MS}ms ${SNAP_EASE}`);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (busy.current) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    drag.current = {
      active: true, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, lt: e.timeStamp,
      dx: 0, dy: 0, vx: 0, vy: 0,
    };
    el.style.transition = "none";
    el.querySelectorAll<HTMLElement>("[data-stamp]").forEach(s => (s.style.transition = "none"));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d?.active) return;
    const dt = Math.max(1, e.timeStamp - d.lt);
    d.vx = 0.8 * d.vx + 0.2 * ((e.clientX - d.lx) / dt);
    d.vy = 0.8 * d.vy + 0.2 * ((e.clientY - d.ly) / dt);
    d.lx = e.clientX; d.ly = e.clientY; d.lt = e.timeStamp;
    d.dx = e.clientX - d.x0; d.dy = e.clientY - d.y0;
    paint(e.currentTarget, d);
  };

  const end = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d?.active) return;
    d.active = false;
    const w = e.currentTarget.offsetWidth;
    const far = Math.abs(d.dx) > w * SWIPE_THRESHOLD;
    const flick = Math.abs(d.vx) > VELOCITY_THRESHOLD && Math.sign(d.vx) === Math.sign(d.dx);
    if (!cancelled && (far || flick)) flyOut(d.dx > 0 ? "right" : "left", d);
    else snapBack(e.currentTarget);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); flyOut("right"); }
    if (e.key === "ArrowLeft") { e.preventDefault(); flyOut("left"); }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.deck} tabIndex={0} role="group" aria-label="Cards. Use left and right arrow keys to skip or save." onKeyDown={onKeyDown}>
        {visible.length === 0 && (emptyState ?? <div style={styles.empty}>No more cards</div>)}
        {visible
          .map((item, i) => ({ item, depth: i }))
          .reverse() // render bottom card first so the top card is last in the DOM
          .map(({ item, depth }) => {
            const isTop = depth === 0;
            return (
              <div
                key={getKey(item)}
                ref={isTop ? topRef : depth === 1 ? nextRef : undefined}
                style={{
                  ...styles.card,
                  transform: isTop ? undefined : `scale(${1 - (1 - NEXT_CARD_SCALE) * depth})`,
                  willChange: isTop ? "transform" : undefined,
                  cursor: isTop ? "grab" : "default",
                }}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? e => end(e, false) : undefined}
                onPointerCancel={isTop ? e => end(e, true) : undefined}
                onDragStart={e => e.preventDefault()}
              >
                {renderCard(item)}
                <div data-stamp="like" style={{ ...styles.stamp, ...styles.like }}>LIKE</div>
                <div data-stamp="nope" style={{ ...styles.stamp, ...styles.nope }}>NOPE</div>
              </div>
            );
          })}
      </div>
      <div style={styles.controls}>
        <button aria-label="Skip" style={{ ...styles.btn, color: "#ef4444" }} onClick={() => flyOut("left")}>✕</button>
        <button aria-label="Save" style={{ ...styles.btn, color: "#22c55e" }} onClick={() => flyOut("right")}>♥</button>
      </div>
      <div aria-live="polite" style={styles.srOnly}>{announce}</div>
    </div>
  );
}

// Put images inside cards with draggable={false} and style={{ pointerEvents: "none" }}.
const styles: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 24 },
  deck: { position: "relative", width: "min(340px, calc(100vw - 32px))", aspectRatio: "3 / 4" },
  card: {
    position: "absolute", inset: 0, borderRadius: 20, overflow: "hidden", background: "#fff",
    boxShadow: "0 10px 30px rgba(0,0,0,.15)", touchAction: "none", userSelect: "none",
    WebkitUserSelect: "none", transformOrigin: "center",
  },
  stamp: {
    position: "absolute", top: 28, padding: "4px 12px", border: "4px solid", borderRadius: 8,
    fontSize: 34, fontWeight: 800, letterSpacing: 2, opacity: 0, pointerEvents: "none",
  },
  like: { left: 22, color: "#22c55e", borderColor: "#22c55e", transform: "rotate(-15deg)" },
  nope: { right: 22, color: "#ef4444", borderColor: "#ef4444", transform: "rotate(15deg)" },
  controls: { display: "flex", gap: 28 },
  btn: {
    width: 64, height: 64, borderRadius: "50%", border: 0, background: "#fff",
    boxShadow: "0 4px 14px rgba(0,0,0,.15)", fontSize: 28, cursor: "pointer",
  },
  empty: { position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#71717a" },
  srOnly: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" },
};

/* Usage:
<SwipeDeck
  items={profiles}
  getKey={p => p.id}
  getLabel={p => p.name}
  renderCard={p => (<><img src={p.photo} alt={p.name} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} /><h2>{p.name}</h2></>)}
  onSwipe={(p, dir) => dir === "right" ? saveMatch(p.id) : skip(p.id)}
/>
*/
