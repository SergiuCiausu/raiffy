"use client";

import * as React from "react";

function cn(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(" ");
}

const SIZE_THRESHOLD_SMALL = 50;
const SIZE_THRESHOLD_TINY = 30;
const SIZE_THRESHOLD_MEDIUM = 100;
const BLUR_MULTIPLIER_SMALL = 0.008;
const BLUR_MIN_SMALL = 1;
const BLUR_MULTIPLIER_LARGE = 0.015;
const BLUR_MIN_LARGE = 4;
const CONTRAST_MULTIPLIER_SMALL = 0.004;
const CONTRAST_MIN_SMALL = 1.2;
const CONTRAST_MULTIPLIER_LARGE = 0.008;
const CONTRAST_MIN_LARGE = 1.5;
const DOT_SIZE_MULTIPLIER_SMALL = 0.004;
const DOT_SIZE_MIN_SMALL = 0.05;
const DOT_SIZE_MULTIPLIER_LARGE = 0.008;
const DOT_SIZE_MIN_LARGE = 0.1;
const SHADOW_MULTIPLIER_SMALL = 0.004;
const SHADOW_MIN_SMALL = 0.5;
const SHADOW_MULTIPLIER_LARGE = 0.008;
const SHADOW_MIN_LARGE = 2;
const MASK_RADIUS_TINY = "0%";
const MASK_RADIUS_SMALL = "5%";
const MASK_RADIUS_MEDIUM = "15%";
const MASK_RADIUS_LARGE = "25%";
const CONTRAST_TINY = 1.1;
const CONTRAST_MULTIPLIER_FINAL = 1.2;
const CONTRAST_MIN_FINAL = 1.3;

export interface SiriOrbProps {
  animationDuration?: number;
  className?: string;
  colors?: {
    bg?: string;
    c1?: string;
    c2?: string;
    c3?: string;
  };
  size?: string;
  analyser?: AnalyserNode;
}

export const Component: React.FC<SiriOrbProps> = ({
  size = "192px",
  className,
  colors,
  animationDuration = 20,
  analyser,
}) => {
  const orb = usePlaybackMotion(analyser);

  const defaultColors = {
    bg: "#FFF9E8",
    c1: "#FFD23F",
    c2: "#FF9A3D",
    c3: "#FFF0B5",
  };

  const finalColors = { ...defaultColors, ...colors };

  const sizeValue = Number.parseInt(size.replace("px", ""), 10);

  const blurAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * BLUR_MULTIPLIER_SMALL, BLUR_MIN_SMALL)
      : Math.max(sizeValue * BLUR_MULTIPLIER_LARGE, BLUR_MIN_LARGE);

  const contrastAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * CONTRAST_MULTIPLIER_SMALL, CONTRAST_MIN_SMALL)
      : Math.max(sizeValue * CONTRAST_MULTIPLIER_LARGE, CONTRAST_MIN_LARGE);

  const dotSize =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * DOT_SIZE_MULTIPLIER_SMALL, DOT_SIZE_MIN_SMALL)
      : Math.max(sizeValue * DOT_SIZE_MULTIPLIER_LARGE, DOT_SIZE_MIN_LARGE);

  const shadowSpread =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * SHADOW_MULTIPLIER_SMALL, SHADOW_MIN_SMALL)
      : Math.max(sizeValue * SHADOW_MULTIPLIER_LARGE, SHADOW_MIN_LARGE);

  const getMaskRadius = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return MASK_RADIUS_TINY;
    if (value < SIZE_THRESHOLD_SMALL) return MASK_RADIUS_SMALL;
    if (value < SIZE_THRESHOLD_MEDIUM) return MASK_RADIUS_MEDIUM;
    return MASK_RADIUS_LARGE;
  };

  const maskRadius = getMaskRadius(sizeValue);

  const getFinalContrast = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return CONTRAST_TINY;
    if (value < SIZE_THRESHOLD_SMALL) {
      return Math.max(
        contrastAmount * CONTRAST_MULTIPLIER_FINAL,
        CONTRAST_MIN_FINAL
      );
    }
    return contrastAmount;
  };

  const finalContrast = getFinalContrast(sizeValue);

  return (
    <div
      ref={orb}
      className={cn("siri-orb", className)}
      aria-hidden="true"
      data-testid="speaking-orb"
      style={
        {
          width: size,
          height: size,
          "--bg": finalColors.bg,
          "--c1": finalColors.c1,
          "--c2": finalColors.c2,
          "--c3": finalColors.c3,
          "--animation-duration": `${animationDuration}s`,
          "--blur-amount": `${blurAmount}px`,
          "--contrast-amount": finalContrast,
          "--dot-size": `${dotSize}px`,
          "--shadow-spread": `${shadowSpread}px`,
          "--mask-radius": maskRadius,
        } as React.CSSProperties
      }
    />
  );
};

/** Keep the supplied component's API and six-gradient/grain composition. */
export { Component as SiriOrb };
export default Component;

function usePlaybackMotion(analyser?: AnalyserNode) {
  const orb = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const element = orb.current!;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const samples = new Uint8Array(analyser?.fftSize ?? 256);
    let frame = 0;
    function draw() {
      if (analyser && !motion.matches && !document.hidden) {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        element.style.setProperty("--voice-scale", String(1 + Math.min(1, rms * 5) * 0.12));
      }
      frame = requestAnimationFrame(draw);
    }
    function visibility() {
      cancelAnimationFrame(frame);
      element.dataset.paused = String(document.hidden || motion.matches);
      element.style.removeProperty("--voice-scale");
      if (!document.hidden && !motion.matches) frame = requestAnimationFrame(draw);
    }
    visibility();
    document.addEventListener("visibilitychange", visibility);
    motion.addEventListener("change", visibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", visibility);
    };
  }, [analyser]);
  return orb;
}
