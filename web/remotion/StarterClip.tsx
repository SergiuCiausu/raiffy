import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import { VIGNETTES, vignetteClass, type StarterVignetteKind } from "@/components/agent/StarterVignettes";
import { createBeats } from "@/components/agent/starter-motion/timing";
import "@/styles/generated/chat.css";
import "@/styles/agent.css";

// Next loads Geist through next/font; Remotion has to fetch it itself before the first frame.
const FONTS = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@500&display=block";
const FONT_VARS = { "--font-geist": "Geist", "--font-geist-mono": "'Geist Mono'" } as CSSProperties;

const seek = (beats: Animation[], ms: number) => beats.forEach((a) => { a.currentTime = ms; });

/*
 * A starter vignette in Remotion. It builds the same Web Animations the live chat plays and seeks them to the
 * current frame, so preview, export and the chat can't drift apart.
 */
export function StarterClip({ kind }: { kind: StarterVignetteKind }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = useRef<HTMLSpanElement>(null);
  const beats = useRef<Animation[]>([]);
  const [fontsHandle] = useState(() => delayRender("Loading Geist"));

  useLayoutEffect(() => {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: FONTS });
    link.onload = () => {
      void Promise.all(["400 12px Geist", "600 12px Geist", "500 11px 'Geist Mono'"].map((f) => document.fonts.load(f)))
        .finally(() => continueRender(fontsHandle));
    };
    link.onerror = () => continueRender(fontsHandle);
    document.head.append(link);
    return () => link.remove();
  }, [fontsHandle]);

  useLayoutEffect(() => {
    beats.current = createBeats(box.current!);
    beats.current.forEach((a) => a.pause());
    return () => beats.current.forEach((a) => a.cancel());
  }, [kind]);

  useLayoutEffect(() => {
    seek(beats.current, (frame / fps) * 1000);
  }, [frame, fps]);

  const Picture = VIGNETTES[kind];
  return (
    <div className="pg-chat" style={{ ...FONT_VARS, width: "100%", height: "100%", background: "var(--surface-3)" }}>
      <div className="starter" style={{ border: 0, borderRadius: 0, padding: 0, background: "none" }}>
        <span ref={box} className={vignetteClass(kind)} style={{ margin: 0, border: 0 }}><Picture /></span>
      </div>
    </div>
  );
}
