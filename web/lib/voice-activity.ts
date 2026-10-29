import { z } from "zod";
import { MAX_RECORDING_MS } from "./voice";

export const VOICE_ACTIVITY = { threshold: 0.015, attackMs: 120, minSpeechMs: 300, pauseMs: 1200, idleMs: 10_000 } as const;
export const activityState = z.object({
  startedAt: z.number().nonnegative(), sampledAt: z.number().nonnegative(),
  loudMs: z.number().nonnegative(), speechMs: z.number().nonnegative(), lastSpeechAt: z.number().nonnegative().nullable(),
});
export const activitySample = z.object({ now: z.number().nonnegative(), rms: z.number().nonnegative() });
export const activityResult = z.object({ state: activityState, decision: z.enum(["continue", "submit", "timeout"]) });
export type ActivityState = z.infer<typeof activityState>;

export function beginActivity(now: number): ActivityState {
  return { startedAt: now, sampledAt: now, loudMs: 0, speechMs: 0, lastSpeechAt: null };
}

/** Sustained voice opens the gate; a pause ends a turn. Silence and clicks never submit. */
export function sampleActivity(previous: ActivityState, sample: z.infer<typeof activitySample>): z.infer<typeof activityResult> {
  const now = Math.max(previous.sampledAt, sample.now);
  const delta = Math.min(100, now - previous.sampledAt);
  const loud = sample.rms >= VOICE_ACTIVITY.threshold;
  const loudMs = loud ? previous.loudMs + delta : 0;
  const speechMs = previous.speechMs + (loud ? delta : 0);
  const lastSpeechAt = loud && (previous.lastSpeechAt !== null || loudMs >= VOICE_ACTIVITY.attackMs) ? now : previous.lastSpeechAt;
  const state = { ...previous, sampledAt: now, loudMs, speechMs, lastSpeechAt };
  const hasSpeech = lastSpeechAt !== null && speechMs >= VOICE_ACTIVITY.minSpeechMs;
  const decision = hasSpeech && now - lastSpeechAt >= VOICE_ACTIVITY.pauseMs ? "submit"
    : now - previous.startedAt >= MAX_RECORDING_MS ? hasSpeech ? "submit" : "timeout"
    : lastSpeechAt === null && now - previous.startedAt >= VOICE_ACTIVITY.idleMs ? "timeout" : "continue";
  return { state, decision };
}
