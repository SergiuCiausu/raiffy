"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import Link from "next/link";
import { ArrowRightIcon, BookmarkIcon, BookOpenIcon, LandmarkIcon, RotateCcwIcon, Undo2Icon, XIcon } from "lucide-react";
import type { Fact } from "@/lib/facts";
import { Vignette, type Topic } from "./vignettes";

/*
 * "Did you know" swipe deck, ported from swipe.html. React owns which cards exist (at most three);
 * the drag, fly-out and fly-in run on refs, so a pointer frame never re-renders the tree.
 */

const SWIPE_THRESHOLD = 0.3;     // fraction of card width
const VELOCITY_THRESHOLD = 0.5;  // px per ms
const MAX_ROTATION = 30;         // deg at one card-width of drag
const FLY_OUT_ROTATION = 30;
const FLY_OUT_MS = 300;
const SNAP_BACK_MS = 400;
const SNAP_EASE = "cubic-bezier(.175,.885,.32,1.275)";
const NEXT_CARD_SCALE = 0.95;
const PEEK_Y = 22;               // px each card below sits lower, so the stack reads as a stack
const TAP_SLOP = 5;              // px; less movement than this is a tap, not a swipe
const VISIBLE = 3;
const SHOW_SAVED = 6;

type Dir = "left" | "right";
type TopicData = Topic & { name: string; facts: Fact[] };
type Drag = { dragging: boolean; x0: number; y0: number; dx: number; dy: number; vx: number; vy: number; lx: number; ly: number; lt: number };

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SwipeApp({ topics, all }: { topics: TopicData[]; all: Fact[] }) {
  const [filter, setFilter] = useState(-1); // -1 = all topics
  const [seen, setSeen] = useState(0);
  const [version, setVersion] = useState(0); // new deck → fresh card elements
  const [saved, setSaved] = useState<Map<number, Fact>>(new Map());
  const [newId, setNewId] = useState<number | null>(null);
  const [live, setLive] = useState("");

  const items = filter < 0 ? all : topics[filter]!.facts;
  const total = items.length;
  const visible = items.slice(seen, seen + VISIBLE);
  const empty = seen >= total;

  const deck = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const history = useRef<{ fact: Fact; dir: Dir }[]>([]);
  const busy = useRef(false);
  const drag = useRef<Drag>({ dragging: false, x0: 0, y0: 0, dx: 0, dy: 0, vx: 0, vy: 0, lx: 0, ly: 0, lt: 0 });
  const pendingUndo = useRef<Dir | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const keyOf = (f: Fact) => `${version}-${f.id}`;
  /** Cards in DOM order: bottom first, top last. */
  const els = () => [...visible].reverse().map((f) => cards.current.get(keyOf(f))).filter((x): x is HTMLElement => !!x);
  const top = () => els().at(-1) ?? null;

  /* Scale and lower the cards beneath the top; progress 0..1 lifts the next card into place */
  function layoutStack(progress: number, list = els()) {
    list.forEach((c, i) => {
      const depth = list.length - 1 - i;
      if (depth === 0) return;
      const base = 1 - (1 - NEXT_CARD_SCALE) * depth;
      const p = depth === 1 ? progress : 0;
      c.style.transform = `translateY(${PEEK_Y * depth * (1 - p)}px) scale(${base + (1 - base) * p})`;
    });
  }

  // After every change to which cards exist: settle the stack, or fly the restored card back in
  useLayoutEffect(() => {
    const list = els();
    const dir = pendingUndo.current;
    if (!dir) { list.forEach((c) => (c.style.transition = "none")); layoutStack(0, list); return; }
    pendingUndo.current = null;
    const card = list.at(-1)!;
    const sign = dir === "right" ? 1 : -1;
    list.forEach((c) => (c.style.transition = "none"));
    layoutStack(1, list); // the old top stays full size for now, then settles back into the stack
    if (reduced()) card.style.opacity = "0";
    else card.style.transform = `translate(${sign * (innerWidth + card.offsetWidth)}px, 0px) rotate(${sign * FLY_OUT_ROTATION}deg)`;
    void card.offsetWidth; // commit the start position before transitioning
    list.forEach((c) => c !== card && (c.style.transition = `transform ${FLY_OUT_MS}ms ease-out`));
    card.style.transition = reduced() ? `opacity ${FLY_OUT_MS}ms` : `transform ${FLY_OUT_MS}ms var(--ease-out)`;
    card.style.transform = "translate(0px, 0px) rotate(0deg)";
    card.style.opacity = "1";
    layoutStack(0, list);
    timers.current.push(window.setTimeout(() => { busy.current = false; list.forEach((c) => (c.style.transition = "none")); }, FLY_OUT_MS + 50));
    // Only when the set of cards changes: other re-renders (saved list, live text) must not touch an animation in flight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, version]);

  function newDeck(nextFilter: number) {
    history.current = [];
    busy.current = false;
    setFilter(nextFilter);
    setSeen(0);
    setVersion((v) => v + 1);
  }

  function onSwiped(f: Fact, dir: Dir) {
    history.current.push({ fact: f, dir });
    if (dir === "right") { setSaved((m) => new Map(m).set(f.id, f)); setNewId(f.id); } else setNewId(null);
    const next = items[seen + 1];
    const nextSeen = seen + 1;
    setSeen(nextSeen);
    if (nextSeen >= total) {
      setLive(`You’ve seen ${scope()}.`);
    } else {
      setLive(`${dir === "right" ? "Saved" : "Skipped"} fact ${f.id}.${next ? ` Next: ${next.headline}` : ""}`);
    }
  }
  const scope = () => (filter < 0 ? `all ${total} facts` : `all ${total} ${topics[filter]!.short} facts`);

  // Shared by gestures, buttons and keys
  function flyOut(card: HTMLElement, dir: Dir, s: { dy: number; vy: number } = { dy: 0, vy: 0 }) {
    if (busy.current) return;
    busy.current = true;
    const f = visible[0]!;
    const sign = dir === "right" ? 1 : -1;
    const stamp = card.querySelector<HTMLElement>(dir === "right" ? ".stamp.like" : ".stamp.nope")!;
    stamp.style.transition = "none";
    stamp.style.opacity = "1";
    els().forEach((c) => c !== card && (c.style.transition = `transform ${FLY_OUT_MS}ms ease-out`));
    layoutStack(1);
    if (reduced()) {
      card.style.transition = `opacity ${FLY_OUT_MS}ms`;
      card.style.opacity = "0";
    } else {
      card.style.transition = `transform ${FLY_OUT_MS}ms ease-out`;
      card.style.transform = `translate(${sign * (innerWidth + card.offsetWidth)}px, ${s.dy + s.vy * FLY_OUT_MS}px) rotate(${sign * FLY_OUT_ROTATION}deg)`;
    }
    let done = false;
    const finish = (e?: TransitionEvent) => {
      if (e && e.target !== card) return; // ignore transitionend bubbling up from the stamps
      if (done) return;
      done = true;
      card.removeEventListener("transitionend", finish);
      busy.current = false;
      onSwiped(f, dir);
    };
    card.addEventListener("transitionend", finish);
    timers.current.push(window.setTimeout(finish, FLY_OUT_MS + 50)); // fallback if transitionend never fires
  }

  function swipe(dir: Dir) { const c = top(); if (c && !empty) flyOut(c, dir); }

  // Re-insert the last swiped card, flying in from the side it left
  function undo() {
    if (busy.current || !history.current.length) return;
    busy.current = true;
    const { fact, dir } = history.current.pop()!;
    if (dir === "right") setSaved((m) => { const n = new Map(m); n.delete(fact.id); return n; }); // undoing a skip leaves an earlier save alone
    setNewId(null);
    pendingUndo.current = dir;
    setSeen((n) => n - 1);
    setLive(`Back to fact ${fact.id}.`);
  }

  /* ───────────── Drag ───────────── */
  function stamps(card: HTMLElement) {
    return [card.querySelector<HTMLElement>(".stamp.like")!, card.querySelector<HTMLElement>(".stamp.nope")!] as const;
  }
  function paint(card: HTMLElement) {
    const s = drag.current, w = card.offsetWidth, [like, nope] = stamps(card);
    const rot = reduced() ? 0 : Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, (s.dx / w) * MAX_ROTATION));
    card.style.transform = `translate(${s.dx}px, ${s.dy}px) rotate(${rot}deg)`;
    const t = w * SWIPE_THRESHOLD;
    like.style.opacity = String(Math.max(0, Math.min(1, s.dx / t)));
    nope.style.opacity = String(Math.max(0, Math.min(1, -s.dx / t)));
    layoutStack(Math.min(1, Math.abs(s.dx) / t));
  }
  function onDown(e: PointerEvent<HTMLElement>) {
    const card = e.currentTarget;
    if (card !== top() || busy.current || e.button > 0) return;
    const s = drag.current;
    Object.assign(s, { dragging: true, x0: e.clientX, lx: e.clientX, y0: e.clientY, ly: e.clientY, lt: e.timeStamp, dx: 0, dy: 0, vx: 0, vy: 0 });
    card.setPointerCapture(e.pointerId);
    card.classList.add("dragging");
    card.style.transition = "none";
    stamps(card).forEach((st) => (st.style.transition = "none"));
    els().forEach((c) => c !== card && (c.style.transition = "none"));
  }
  function onMove(e: PointerEvent<HTMLElement>) {
    const s = drag.current;
    if (!s.dragging) return;
    const dt = Math.max(1, e.timeStamp - s.lt);
    s.vx = 0.8 * s.vx + 0.2 * ((e.clientX - s.lx) / dt);
    s.vy = 0.8 * s.vy + 0.2 * ((e.clientY - s.ly) / dt);
    s.lx = e.clientX; s.ly = e.clientY; s.lt = e.timeStamp;
    s.dx = e.clientX - s.x0; s.dy = e.clientY - s.y0;
    paint(e.currentTarget);
  }
  function onEnd(e: PointerEvent<HTMLElement>, cancelled: boolean) {
    const s = drag.current, card = e.currentTarget;
    if (!s.dragging) return;
    s.dragging = false;
    card.classList.remove("dragging");
    if (Math.hypot(s.dx, s.dy) < TAP_SLOP) { // a tap: put it back quietly
      card.style.transform = "translate(0px, 0px) rotate(0deg)";
      layoutStack(0);
      return;
    }
    const far = Math.abs(s.dx) > card.offsetWidth * SWIPE_THRESHOLD;
    const flick = Math.abs(s.vx) > VELOCITY_THRESHOLD && Math.sign(s.vx) === Math.sign(s.dx);
    if (!cancelled && (far || flick)) { flyOut(card, s.dx > 0 ? "right" : "left", s); return; }
    // Snap back with a little overshoot
    card.style.transition = `transform ${SNAP_BACK_MS}ms ${SNAP_EASE}`;
    stamps(card).forEach((st) => { st.style.transition = `opacity ${SNAP_BACK_MS}ms`; st.style.opacity = "0"; });
    els().forEach((c) => c !== card && (c.style.transition = `transform ${SNAP_BACK_MS}ms ${SNAP_EASE}`));
    card.style.transform = "translate(0px, 0px) rotate(0deg)";
    layoutStack(0);
  }

  const savedList = [...saved.values()].reverse(); // newest first
  const chips = [{ i: -1, label: "All topics" }, ...topics.map((t, i) => ({ i, label: t.short }))];

  return (
    <>
      <div className="head">
        <p className="eyebrow">Did you know</p>
        <h1>One money idea at a time</h1>
        <p className="lead">Short, plain-language facts about saving, credit, payments and staying safe. Swipe right to keep one, left to move on. None of them sells you anything.</p>
        <div className="chips" role="group" aria-label="Filter by topic">
          {chips.map((c) => (
            <button key={c.i} className="qbtn" type="button" aria-pressed={c.i === filter} onClick={() => {
              if (busy.current) return;
              newDeck(c.i);
              const n = c.i < 0 ? all.length : topics[c.i]!.facts.length;
              setLive(`Showing ${n} facts${c.i < 0 ? "" : ` about ${topics[c.i]!.short}`}.`);
            }}>{c.label}</button>
          ))}
        </div>
      </div>

      <section className="stage" aria-label="Fact cards">
        <div className="deck-wrap">
          <div className="deck" id="deck" ref={deck} tabIndex={0} role="group" aria-roledescription="card deck"
            aria-label="Facts. Use the right arrow key to save a fact and the left arrow key to skip it."
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); swipe("right"); }
              if (e.key === "ArrowLeft") { e.preventDefault(); swipe("left"); }
            }}>
            {[...visible].reverse().map((f, i, list) => {
              const depth = list.length - 1 - i, t = topics[f.topic]!;
              return (
                <article key={keyOf(f)} ref={(el) => { if (el) cards.current.set(keyOf(f), el); else cards.current.delete(keyOf(f)); }}
                  className={depth === 0 ? "swipe-card is-top" : "swipe-card"} inert={depth !== 0} aria-hidden={depth !== 0}
                  onPointerDown={onDown} onPointerMove={onMove} onPointerUp={(e) => onEnd(e, false)} onPointerCancel={(e) => onEnd(e, true)}>
                  <div className="sc-visual" aria-hidden="true">
                    <div className="bloom" style={{ "--x": t.bloom[0], "--y": t.bloom[1], "--size": "260px" } as CSSProperties} />
                    <Vignette v={t.visual} />
                  </div>
                  <div className="sc-body">
                    <div className="sc-top"><p className="eyebrow">{t.short}</p><span className="mono">#{f.id}</span></div>
                    <h4><span className="sr-only">Did you know </span>{f.headline}</h4>
                    {f.support && <p className="text-sm">{f.support}</p>}
                    <div className="sc-src">
                      {f.tag === "RO"
                        ? <span className="pill" style={{ "--c": "#8A6A00" } as CSSProperties}><LandmarkIcon strokeWidth={1.6} />Romanian rule</span>
                        : <span className="pill"><BookOpenIcon strokeWidth={1.6} />General</span>}
                    </div>
                  </div>
                  <div className="stamp like" aria-hidden="true">Save</div>
                  <div className="stamp nope" aria-hidden="true">Skip</div>
                </article>
              );
            })}
          </div>
          <div className="deck-empty" hidden={!empty}>
            <div className="bloom" aria-hidden="true" style={{ "--x": "90%", "--y": "0%", "--size": "320px" } as CSSProperties} />
            <p className="eyebrow mono">You’re all caught up</p>
            <h2>You’ve seen {scope()}</h2>
            <p className="text-sm">{saved.size ? `${saved.size} saved so far. Pick another topic, or start over to see them again.` : "Pick another topic, or start over to see them again."}</p>
            <div className="actions">
              <button className="btn btn-ghost" type="button" onClick={() => { newDeck(filter); deck.current?.focus(); }}>
                <RotateCcwIcon strokeWidth={1.6} />Start over
              </button>
              <Link className="btn btn-dark" href="/sign-up">Ask Raiffy a question <ArrowRightIcon strokeWidth={1.6} /></Link>
            </div>
          </div>
        </div>

        <div className="deck-meta" aria-hidden="true">
          <span className="progress" style={{ "--p": `${total ? (seen / total) * 100 : 0}%` } as CSSProperties}><span /></span>
          <span className="mono">{Math.min(seen + 1, total)} / {total}</span>
        </div>

        <div className="controls">
          <button className="btn btn-ghost" type="button" disabled={empty} onClick={() => swipe("left")}><XIcon strokeWidth={1.6} />Skip</button>
          <button className="btn btn-ghost btn-undo" type="button" aria-label="Undo last swipe" disabled={seen === 0} onClick={undo}><Undo2Icon strokeWidth={1.6} /></button>
          <button className="btn btn-dark" type="button" disabled={empty} onClick={() => swipe("right")}><BookmarkIcon strokeWidth={1.6} />Save</button>
        </div>
        <p className="keys" aria-hidden="true"><span><kbd>←</kbd>Skip</span><span><kbd>→</kbd>Save</span></p>

        <div className="sr-only" aria-live="polite">{live}</div>
      </section>

      <aside className="guide" aria-labelledby="guide-title">
        <div className="guide-card">
          <div className="guide-h"><h4 id="guide-title">Saved facts</h4><span className="mono">{saved.size} saved</span></div>
          <ul className="guide-list">
            {savedList.slice(0, SHOW_SAVED).map((f) => (
              <li key={f.id} className={f.id === newId ? "new" : undefined}>
                <span className="tile" aria-hidden="true"><BookmarkIcon strokeWidth={1.6} /></span>
                <div><b>{f.headline}</b><span className="micro">{topics[f.topic]!.short} · #{f.id}</span></div>
              </li>
            ))}
          </ul>
          <p className="guide-empty" hidden={saved.size > 0}>Nothing saved yet. Swipe right on a fact to keep it here.</p>
          <p className="micro guide-more" hidden={saved.size <= SHOW_SAVED}>+ {saved.size - SHOW_SAVED} more saved</p>
        </div>
        <p className="micro foot-note">Educational content only. Facts marked “Romanian rule” must be checked by compliance against current law before publishing. Examples use round illustrative numbers.</p>
      </aside>
    </>
  );
}
