"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

/* Pieces shared by the scripted demo chat (ChatApp) and the live agent chat (AgentChat). */

export function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(query).matches,
    () => false,
  );
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const noop = () => () => {};
export const useIsMac = () => useSyncExternalStore(noop, isMac, () => false);

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function GroupList({ label, children }: { label: string; children: ReactNode }) {
  return <><span className="grp eyebrow">{label}</span>{children}</>;
}

/** Status lines while Raiffy works: done lines plain, the current one with amber dots. */
export function ThinkLines({ lines, live }: { lines: ReactNode[]; live?: boolean }) {
  return lines.map((t, i) => {
    const on = live && i === lines.length - 1;
    return (
      <li key={i} className={on ? "think-line on" : "think-line"}>
        {on && <span className="dots" aria-hidden="true"><i /><i /><i /></span>}<span>{t}</span>
      </li>
    );
  });
}

/** The folded panel once the answer starts: "How I worked this out · N steps", reopenable. */
export function Thinking({ lines }: { lines: ReactNode[] }) {
  return (
    <details className="think">
      <summary><ChevronRightIcon />How I worked this out · {lines.length}{lines.length === 1 ? " step" : " steps"}</summary>
      <ol className="think-lines"><ThinkLines lines={lines} /></ol>
    </details>
  );
}
