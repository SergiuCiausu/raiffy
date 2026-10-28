/*
 * iso-tilt, ported from raiffy.html. Orbit mode: the hero stack turns toward the cursor.
 * Writes CSS variables straight onto the elements that read them, so a mouse frame restyles a handful
 * of nodes, not the whole subtree. Off for touch, coarse pointers and reduced motion.
 */

type Options = {
  mode?: "orbit" | "tilt";
  trackOn?: HTMLElement | null;
  targets?: string;
  maxYaw?: number;
  maxPitch?: number;
  maxTiltX?: number;
  maxTiltY?: number;
  reach?: number;
  ease?: number;
  invert?: boolean;
  returnOnLeave?: boolean;
  light?: number;
};

const DEFAULTS = {
  mode: "orbit", maxYaw: 16, maxPitch: 8, maxTiltX: 10, maxTiltY: 14, reach: 520, ease: 0.08,
  invert: false, returnOnLeave: true, light: 22,
} as const;

const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

export function isoTilt(scene: HTMLElement, options: Options = {}) {
  const o = { ...DEFAULTS, ...options };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const track: HTMLElement | Window = o.trackOn || scene.closest("section") || window;
  let rect = scene.getBoundingClientRect();
  const targets: HTMLElement[] = o.targets ? Array.from(scene.querySelectorAll<HTMLElement>(o.targets)) : [scene];
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  let raf = 0, last = 0, visible = true, stale = false;

  // Scroll/resize only mark the rect stale; it's re-measured lazily on the next pointer move
  const measure = () => { stale = true; };
  const enabled = () => !reduce.matches && fine.matches;

  function onMove(e: Event) {
    const p = e as PointerEvent;
    if (!enabled() || p.pointerType === "touch") return;
    if (stale) { rect = scene.getBoundingClientRect(); stale = false; }
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2, s = o.invert ? -1 : 1;
    target.x = s * clamp((p.clientX - cx) / o.reach);
    target.y = s * clamp((p.clientY - cy) / o.reach);
    kick();
  }
  function onLeave() { if (!o.returnOnLeave) return; target.x = 0; target.y = 0; kick(); }

  function write() {
    const x = cur.x, y = cur.y;
    const v: Record<string, string> = {
      "--iso-x": x.toFixed(4), "--iso-y": y.toFixed(4),
      "--iso-yaw": `${(-x * o.maxYaw).toFixed(3)}deg`, "--iso-pitch": `${(-y * o.maxPitch).toFixed(3)}deg`,
    };
    // Only write what the current mode reads: every extra property is another style invalidation per frame
    if (o.mode === "tilt") { v["--iso-tilt-x"] = `${(-y * o.maxTiltX).toFixed(3)}deg`; v["--iso-tilt-y"] = `${(x * o.maxTiltY).toFixed(3)}deg`; }
    if (o.light) { v["--iso-lx"] = `${(50 + x * o.light).toFixed(2)}%`; v["--iso-ly"] = `${(50 + y * o.light).toFixed(2)}%`; }
    for (const t of targets) for (const k in v) t.style.setProperty(k, v[k]!);
  }

  function frame(t: number) {
    const dt = last ? Math.min(t - last, 64) : 16.667; last = t;
    const a = 1 - Math.pow(1 - o.ease, dt / 16.667);
    cur.x += (target.x - cur.x) * a; cur.y += (target.y - cur.y) * a;
    write();
    if (Math.abs(target.x - cur.x) < 0.0005 && Math.abs(target.y - cur.y) < 0.0005) {
      cur.x = target.x; cur.y = target.y; write(); raf = 0; last = 0; return;
    }
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }
  function onPrefChange() { if (!enabled()) { target.x = target.y = cur.x = cur.y = 0; write(); } }

  const io = new IntersectionObserver((en) => { visible = !!en[0]?.isIntersecting; if (visible) { measure(); kick(); } });
  const ro = new ResizeObserver(measure);
  track.addEventListener("pointermove", onMove, { passive: true });
  track.addEventListener("pointerleave", onLeave, { passive: true });
  addEventListener("scroll", measure, { passive: true });
  addEventListener("resize", measure, { passive: true });
  reduce.addEventListener("change", onPrefChange);
  fine.addEventListener("change", onPrefChange);
  io.observe(scene);
  ro.observe(scene);
  scene.setAttribute("data-iso-mode", o.mode);
  write();

  return function destroy() {
    track.removeEventListener("pointermove", onMove);
    track.removeEventListener("pointerleave", onLeave);
    removeEventListener("scroll", measure);
    removeEventListener("resize", measure);
    reduce.removeEventListener("change", onPrefChange);
    fine.removeEventListener("change", onPrefChange);
    io.disconnect(); ro.disconnect();
    if (raf) cancelAnimationFrame(raf);
  };
}
