"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { isoTilt } from "./iso-tilt";

/**
 * The landing page's wrapper (it plays the prototype's <body>) and its page-wide effects:
 * nav glass over and after the hero, reveal on scroll, blooms that drift only on screen, and the hero orbit.
 */
export function LandingShell({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    // Like the prototype's no-js → js swap: the hide-until-revealed styles only apply once JS runs
    el.classList.add("js");
    const cleanups: (() => void)[] = [];

    /* Nav: dark glass over the hero, light glass over Daylight sections */
    const nav = el.querySelector<HTMLElement>("#nav"), hero = el.querySelector<HTMLElement>(".hero");
    if (nav && hero) {
      let past = false;
      const update = () => {
        nav.classList.toggle("is-light", past);
        nav.classList.toggle("is-dark", !past && scrollY > 8);
      };
      const navIo = new IntersectionObserver((en) => { past = !en[0]?.isIntersecting; update(); }, { rootMargin: "-60px 0px 0px 0px" });
      const offIo = new IntersectionObserver((en) => { hero.classList.toggle("is-off", !en[0]?.isIntersecting); });
      navIo.observe(hero); offIo.observe(hero);
      addEventListener("scroll", update, { passive: true }); update();
      cleanups.push(() => { navIo.disconnect(); offIo.disconnect(); removeEventListener("scroll", update); });
    }

    /* Reveal once. Cards entering in the same batch start 90ms apart, so their first frames don't land on one frame */
    const timers: number[] = [];
    const io = new IntersectionObserver((entries) => {
      let n = 0;
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const t = en.target; io.unobserve(t);
        timers.push(window.setTimeout(() => t.classList.add("in"), n++ * 90));
      }
    }, { rootMargin: "0px 0px -80px 0px" });
    el.querySelectorAll(".reveal").forEach((e) => io.observe(e));

    /* Blooms only drift while on screen */
    const bio = new IntersectionObserver((entries) => {
      for (const en of entries) en.target.classList.toggle("is-visible", en.isIntersecting);
    });
    el.querySelectorAll(".bloom").forEach((b) => bio.observe(b));
    cleanups.push(() => { io.disconnect(); bio.disconnect(); timers.forEach(clearTimeout); });

    /* Hero orbit, tracking the whole hero so the stack turns while visitors read the copy */
    const iso = el.querySelector<HTMLElement>(".iso");
    if (iso) {
      cleanups.push(isoTilt(iso, {
        mode: "orbit", trackOn: hero, maxYaw: 16, maxPitch: 7, reach: 580, ease: 0.07,
        targets: ".iso-floor-glow, .iso-stage, .slab, .iso-note", light: 0,
      }));
    }

    return () => cleanups.forEach((c) => c());
  }, []);

  return (
    <div ref={root} className="pg-landing" data-mode="daylight">
      {children}
    </div>
  );
}
