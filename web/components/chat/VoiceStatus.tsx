"use client";

import { MicIcon, SquareIcon, Volume2Icon, XIcon } from "lucide-react";
import { SiriOrb } from "@/components/ui/siri-orb";
import { PHONON_VOICE } from "./phonon-client";
import type { useVoice } from "./useVoice";

export function VoiceStatus({ voice }: { voice: ReturnType<typeof useVoice> }) {
  if (voice.phase === "idle") return null;
  const listening = voice.phase === "listening";
  const speaking = voice.phase === "speaking";
  const title = {
    requesting: "Allow microphone access", listening: "Listening…", transcribing: voice.handsFree ? "Sending your question…" : "Writing your draft…",
    waiting: "Raiffy is thinking",
    preparing: "Preparing audio…", speaking: "Raiffy is speaking", error: "Voice unavailable",
  }[voice.phase];
  const detail = voice.phase === "error" ? voice.error
    : voice.downloadPercent !== undefined ? `Downloading speech model · ${voice.downloadPercent}% · Saved on this device`
    : listening ? voice.handsFree ? "Pause to send · English" : "English · Review before sending"
    : voice.phase === "requesting" ? "Your browser will ask for permission"
    : voice.phase === "transcribing" || voice.phase === "waiting" ? voice.handsFree ? "Microphone paused · Hands-free is on" : "You can keep editing your message"
    : `English · ${PHONON_VOICE} · On this device`;
  return (
    <div className="voice-status" data-phase={voice.phase}>
      {speaking ? <SiriOrb size="40px" analyser={voice.analyser} />
        : <span className="voice-status-icon" aria-hidden="true">{dictationIcon(voice.phase)}</span>}
      <div className="voice-status-copy" role="status" aria-live="polite" aria-atomic="true">
        <span className="voice-status-title">{title}</span><span className="voice-status-detail">{detail}</span>
      </div>
      {listening && <span className="voice-time" aria-label={`${voice.seconds ?? 0} seconds recorded`}>0:{String(voice.seconds ?? 0).padStart(2, "0")}</span>}
      {listening && voice.handsFree && <button type="button" className="voice-done" onClick={voice.reviewDraft}>Review draft</button>}
      {listening && !voice.handsFree && <button type="button" className="voice-done" onClick={voice.finishRecording}>Done</button>}
      <button type="button" className="icon-btn voice-dismiss" aria-label={voice.handsFree ? "End voice conversation" : speaking ? "Stop speaking" : voice.phase === "error" ? "Dismiss voice message" : "Cancel voice"}
        onClick={voice.cancel}>{speaking ? <SquareIcon /> : <XIcon />}</button>
    </div>
  );
}

function dictationIcon(phase: string) { return phase === "preparing" ? <Volume2Icon /> : <MicIcon />; }
