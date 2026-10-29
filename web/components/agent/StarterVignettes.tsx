"use client";

import { useEffect, useRef, type ComponentType, type CSSProperties } from "react";
import { CheckIcon, FileTextIcon } from "lucide-react";
import { useMedia } from "@/components/chat/parts";
import { createBeats } from "@/components/agent/starter-motion/timing";

/*
 * One built picture per starter card. They show the shape of the answer (terms, a checklist, two card types,
 * a table, routes), never a figure: /chat quotes numbers only from cited sources, so values are neutral bars.
 *
 * The markup is the still picture. Moving parts carry `data-beat` (starter-motion/timing.ts), and everything
 * that moves does it with transform or opacity: fills scale, the knob rides a rail, and selections are
 * highlight layers that fade, so playback never triggers layout or repaints a row.
 */

export type StarterVignetteKind = "term" | "checklist" | "cards" | "doctable" | "limit" | "tiers" | "routes" | "docstack";

const Bar = ({ w, beat }: { w: string; beat: string }) => <i className="mini-bar"><i style={{ width: w }} data-beat={beat} /></i>;
const Highlight = ({ beat }: { beat: string }) => <i className="mini-hl" data-beat={beat} />;

function Term() {
  return (
    <span className="mini-frag">
      <span className="mini-slots">
        {/* The selection passes over 1 and 3 months and settles on 6 */}
        <span data-beat="rise 0">1 mo<b className="mini-on is-passing" data-beat="blink 12">1 mo</b></span>
        <span data-beat="rise 3">3 mo<b className="mini-on is-passing" data-beat="blink 17">3 mo</b></span>
        <span data-beat="rise 6">6 mo<b className="mini-on" data-beat="fade 22">6 mo</b></span>
        <span data-beat="rise 9">12 mo</span>
      </span>
      <span className="mini-line" data-beat="fade 26"><span>Access</span><b>At maturity</b></span>
    </span>
  );
}

function Checklist() {
  return (
    <span className="mini-frag">
      <span className="mini-line" data-beat="rise 0"><span><CheckIcon className="mini-tick" data-beat="pop 10" />ID card</span></span>
      <span className="mini-line sel" data-beat="rise 4"><Highlight beat="fade 22" /><span><CheckIcon className="mini-tick" data-beat="pop 16" />Proof of income</span></span>
      <span className="mini-line dim" data-beat="shift 8"><span><CheckIcon className="mini-tick" />Employer certificate</span></span>
    </span>
  );
}

function Cards() {
  return (
    <span className="mini-frag mini-cards">
      <span className="mini-cardrow" data-beat="rise 0"><span className="mini-card" /><span><b>Debit</b><br />Your own money</span></span>
      <span className="mini-cardrow" data-beat="slide 8"><span className="mini-card on" /><span><b>Credit</b><br />A limit, repaid later</span></span>
    </span>
  );
}

function DocTable() {
  return (
    <span className="mini-frag mini-table">
      <span className="mini-tr mini-th" data-beat="fade 0"><span>Document</span><span>Raiffeisen</span><span>BCR</span></span>
      <span className="mini-tr" data-beat="rise 4"><span>ID card</span><Bar w="70%" beat="fill 10" /><Bar w="70%" beat="fill 16" /></span>
      <span className="mini-tr sel" data-beat="rise 8"><Highlight beat="fade 30" /><span>Income proof</span><Bar w="90%" beat="fill 12" /><Bar w="55%" beat="fill 18" /></span>
    </span>
  );
}

function Limit() {
  return (
    <span className="mini-frag">
      <span className="mini-line" data-beat="fade 0"><span>Credit line</span><b>Limit</b></span>
      <span className="mini-meter" style={{ "--w": "62%" } as CSSProperties}>
        <i data-beat="fill 6 24" />
        <span className="mini-rail" data-beat="rail 6 24" />
      </span>
      <span className="mini-caption" data-beat="fade 4">Used</span>
    </span>
  );
}

function Tiers() {
  return (
    <span className="mini-frag">
      <span className="mini-slots">
        <span data-beat="rise 0">Package A<b className="mini-on is-passing" data-beat="blink 10 9">Package A</b></span>
        <span data-beat="rise 3">Package B<b className="mini-on" data-beat="fade 18">Package B</b></span>
        <span data-beat="rise 6">Package C</span>
      </span>
      <span className="mini-line" data-beat="fade 20"><span>Monthly fee</span><Bar w="60%" beat="fill 22" /></span>
    </span>
  );
}

function Routes() {
  return (
    <span className="mini-frag">
      <span className="mini-line" data-beat="rise 0"><span>Investment loan</span><Bar w="80%" beat="fill 8" /></span>
      <span className="mini-line sel" data-beat="rise 4"><Highlight beat="fade 28" /><span>Leasing</span><Bar w="65%" beat="fill 12" /></span>
      <span className="mini-line dim" data-beat="shift 8"><span>Another route</span><Bar w="50%" beat="fill 16" /></span>
    </span>
  );
}

function DocStack() {
  return (
    <>
      <span className="mini-frag mini-sheet dim" data-beat="shift 0" />
      <span className="mini-frag mini-sheet dim" data-beat="shift 5" />
      <span className="mini-frag mini-sheet front" data-beat="drop 10">
        <span className="mini-line sel"><Highlight beat="fade 18" /><span><FileTextIcon className="mini-ic" />Registration certificate</span><CheckIcon className="mini-tick" data-beat="pop 22" /></span>
        <span className="mini-line"><span><FileTextIcon className="mini-ic" />Articles of association</span></span>
      </span>
    </>
  );
}

export const VIGNETTES: Record<StarterVignetteKind, ComponentType> = {
  term: Term, checklist: Checklist, cards: Cards, doctable: DocTable, limit: Limit, tiers: Tiers, routes: Routes, docstack: DocStack,
};

export const vignetteClass = (kind: StarterVignetteKind) => `mini mini-v mini-${kind}`;

/**
 * Plays the picture's beats once each time the empty state is shown, and only once the card is on screen
 * (until then they wait on their first frame). Under reduced motion nothing is created and the still shows.
 */
export function StarterVignette({ kind, index, active }: { kind: StarterVignetteKind; index: number; active: boolean }) {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || !active || reduced || typeof el.animate !== "function") return;
    const beats = createBeats(el, index * 80);
    beats.forEach((a) => a.pause());
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      el.classList.add("is-playing");
      beats.forEach((a) => a.play());
      Promise.all(beats.map((a) => a.finished)).then(() => el.classList.remove("is-playing"), () => {});
    }, { threshold: 0.5 });
    io.observe(el);
    return () => { io.disconnect(); beats.forEach((a) => a.cancel()); el.classList.remove("is-playing"); };
  }, [active, reduced, index]);

  const Picture = VIGNETTES[kind];
  return <span ref={box} className={vignetteClass(kind)} aria-hidden="true"><Picture /></span>;
}
