import { describe, expect, it } from "vitest";
import { BEAT_LENGTH, DURATION, beatKeyframes, frameMs, parseBeat, type BeatKind } from "./timing";

const KINDS = Object.keys(BEAT_LENGTH) as BeatKind[];

describe("starter vignette beats", () => {
  it("reads a beat with its default or explicit length", () => {
    expect(parseBeat("rise 4")).toEqual({ kind: "rise", at: 4, len: 10 });
    expect(parseBeat(" fill 6 24 ")).toEqual({ kind: "fill", at: 6, len: 24 });
  });

  it("rejects unknown kinds and bad frames", () => {
    expect(parseBeat("spin 4")).toBeNull();
    expect(parseBeat("fade")).toBeNull();
    expect(parseBeat("fade -1")).toBeNull();
    expect(parseBeat("fade 2 0")).toBeNull();
  });

  it("converts frames at 30fps", () => {
    expect(frameMs(30)).toBe(1000);
    expect(frameMs(DURATION)).toBe(1400);
  });

  it("ends every entering beat on the resting CSS", () => {
    for (const kind of KINDS.filter((k) => k !== "blink")) {
      const last = beatKeyframes(kind, BEAT_LENGTH[kind]).at(-1)!;
      if ("transform" in last) expect(last.transform).toBe("none");
      if ("opacity" in last) expect(last.opacity).toBe(1);
    }
  });

  it("animates only transform and opacity", () => {
    for (const kind of KINDS) {
      for (const frame of beatKeyframes(kind, BEAT_LENGTH[kind])) {
        expect(Object.keys(frame).filter((k) => k !== "offset").every((k) => k === "transform" || k === "opacity")).toBe(true);
      }
    }
  });

  it("never fades the layers that keep their own opacity", () => {
    for (const kind of ["shift", "fill", "rail"] as const) {
      expect(beatKeyframes(kind, 10).some((f) => "opacity" in f)).toBe(false);
    }
  });

  it("lets a passing highlight in and out again", () => {
    const frames = beatKeyframes("blink", 6);
    expect(frames[0].opacity).toBe(0);
    expect(frames.at(-1)!.opacity).toBe(0);
    expect(frames.map((f) => f.offset)).toEqual([...frames.map((f) => f.offset)].sort());
  });
});
