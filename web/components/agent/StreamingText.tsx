"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "@/components/chat/parts";

/**
 * Text that is still arriving. The server pushes the draft in bursts (about every 100ms); this reveals it a word at
 * a time at a steady pace, faster when it falls behind, so it reads as one continuous stream instead of jumps.
 * Each frame writes the text node directly: React renders only when a new burst arrives, not 60 times a second.
 * Under reduced motion the text shows as it arrives.
 */
export function StreamingText({ text, onGrow }: { text: string; onGrow?: () => void }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const target = useRef(text);
  const raf = useRef(0);
  const grow = useRef(onGrow);

  useLayoutEffect(() => {
    grow.current = onGrow;
    const el = node.current!;
    // A retry rewrites the answer from the start: begin the reveal again
    if (!text.startsWith(target.current.slice(0, shown.current))) shown.current = 0;
    target.current = text;

    if (prefersReducedMotion()) {
      el.textContent = text;
      shown.current = text.length;
      onGrow?.();
      return;
    }
    const tick = () => {
      const goal = target.current;
      const backlog = goal.length - shown.current;
      if (backlog <= 0) { raf.current = 0; return; }
      // Catch up proportionally (about 1/10 of the backlog a frame), then finish the word so none appear half-written
      let next = Math.min(goal.length, shown.current + Math.max(1, Math.ceil(backlog / 10)));
      const space = goal.indexOf(" ", next);
      next = space === -1 ? goal.length : space;
      shown.current = next;
      el.textContent = goal.slice(0, next);
      grow.current?.();
      raf.current = requestAnimationFrame(tick);
    };
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  }, [text, onGrow]);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0; // or a remount (StrictMode does one in dev) would think a frame is still scheduled
  }, []);

  return (
    <>
      <span ref={node} />
      <span className="caret" aria-hidden="true" />
    </>
  );
}
