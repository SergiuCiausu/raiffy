import { describe, expect, it } from "vitest";
import { activityResult, beginActivity, sampleActivity, type ActivityState } from "./voice-activity";

function samples(state: ActivityState, until: number, rms: number) {
  let result = sampleActivity(state, { now: state.sampledAt, rms });
  for (let now = state.sampledAt + 50; now <= until; now += 50) result = sampleActivity(result.state, { now, rms });
  return result;
}

describe("hands-free turn detection", () => {
  it("submits after sustained speech and a 1.2-second pause", () => {
    const voice = samples(beginActivity(0), 600, 0.04);
    expect(samples(voice.state, 1750, 0).decision).toBe("continue");
    const complete = samples(voice.state, 1800, 0);
    expect(complete.decision).toBe("submit");
    expect(activityResult.safeParse(complete).success).toBe(true);
  });
  it("allows short pauses and resets the silence timer when speaking resumes", () => {
    const first = samples(beginActivity(0), 500, 0.03);
    const pause = samples(first.state, 1200, 0);
    expect(pause.decision).toBe("continue");
    const second = samples(pause.state, 1500, 0.03);
    expect(samples(second.state, 2650, 0).decision).toBe("continue");
    expect(samples(second.state, 2700, 0).decision).toBe("submit");
  });
  it("times out silence and low-level background noise without a submission", () => {
    expect(samples(beginActivity(0), 10_000, 0.003).decision).toBe("timeout");
  });
  it("ignores isolated clicks and requires enough speech for a turn", () => {
    let state = beginActivity(0);
    for (let now = 50; now <= 10_000; now += 50) {
      const result = sampleActivity(state, { now, rms: now % 500 === 0 ? 0.1 : 0 });
      expect(result.decision).not.toBe("submit");
      state = result.state;
    }
    expect(sampleActivity(state, { now: 10_000, rms: 0 }).decision).toBe("timeout");
    const brief = samples(beginActivity(0), 150, 0.05);
    expect(samples(brief.state, 1350, 0).decision).toBe("continue");
    expect(samples(brief.state, 30_000, 0).decision).toBe("timeout");
  });
  it("caps continuous speech at 30 seconds", () => {
    expect(samples(beginActivity(0), 29_950, 0.05).decision).toBe("continue");
    expect(samples(beginActivity(0), 30_000, 0.05).decision).toBe("submit");
  });
  it("does not count a stalled timer or backwards clock as sustained speech", () => {
    const stalled = sampleActivity(beginActivity(0), { now: 5000, rms: 0.1 });
    expect(stalled.state.lastSpeechAt).toBeNull();
    const backwards = sampleActivity(stalled.state, { now: 4000, rms: 0.1 });
    expect(backwards.state.sampledAt).toBe(5000);
    expect(backwards.state.loudMs).toBe(100);
  });
});
