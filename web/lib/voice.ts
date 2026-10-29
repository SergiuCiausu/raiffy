import { z } from "zod";

export const MAX_RECORDING_BYTES = 2 * 1024 * 1024;
export const MAX_RECORDING_MS = 30_000;
export const speechInput = z.object({ text: z.string().trim().min(1).max(2000) }).strict();
// On-device TTS can read a full checked chat reply; the optional Python speech endpoint stays bounded separately.
export const playbackInput = z.object({ text: z.string().trim().min(1).max(12_000) }).strict();
export const transcriptOutput = z.object({ text: z.string().trim().min(1).max(8000) }).strict();
export const voiceFailure = z.object({ error: z.string() }).strict();
export const voiceOperation = z.enum(["transcribe", "speak"]);

/** The current models live on the developer's Mac, never in a public Next endpoint. */
export function isLocalVoiceRequest(url: string, origin: string | null, environment: string | undefined) {
  if (environment !== "development" || !origin) return false;
  try {
    const target = new URL(url);
    return ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
      && target.protocol === "http:" && origin === target.origin;
  } catch { return false; }
}
