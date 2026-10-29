"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_RECORDING_MS, playbackInput, transcriptOutput, voiceFailure } from "@/lib/voice";
import { beginActivity, sampleActivity } from "@/lib/voice-activity";
import type { LoadProgress, PhononTTS, SpeechStream } from "phonon-tts";
import { PHONON_VOICE, loadPhonon } from "./phonon-client";

type Phase = "idle" | "requesting" | "listening" | "transcribing" | "waiting" | "preparing" | "speaking" | "error";
type VoiceState = { phase: Phase; seconds?: number; messageId?: string; error?: string; analyser?: AnalyserNode; downloadPercent?: number };
type Session = {
  controller: AbortController; stream?: MediaStream; recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>; context?: AudioContext; sources?: Set<AudioBufferSourceNode>; speech?: SpeechStream;
  microphone?: MediaStreamAudioSourceNode; automatic?: boolean;
};
type PreparedReply = { token: symbol; context?: AudioContext; ready?: Promise<void> };

function closeAudio(context?: AudioContext) {
  if (context && context.state !== "closed") void context.close().catch(() => {});
}

function dispose(session: Session | null, preservedContext?: AudioContext) {
  if (!session) return;
  session.controller.abort();
  clearInterval(session.timer);
  if (session.recorder) {
    session.recorder.onstop = null;
    session.recorder.onerror = null;
    if (session.recorder.state !== "inactive") session.recorder.stop();
  }
  session.stream?.getTracks().forEach((track) => track.stop());
  session.microphone?.disconnect();
  session.speech?.cancel();
  session.sources?.forEach((source) => { source.onended = null; try { source.stop(); } catch { /* Already stopped. */ } });
  if (session.context !== preservedContext) closeAudio(session.context);
}

async function requestVoice(operation: "transcribe" | "speak", body: BodyInit, type: string, signal: AbortSignal) {
  const response = await fetch(`/api/voice/${operation}`, { method: "POST", body, headers: { "Content-Type": type }, signal });
  if (!response.ok) {
    const result = voiceFailure.safeParse(await response.json().catch(() => null));
    throw new Error(result.success ? result.data.error : "Voice is unavailable. Please try again.");
  }
  return response;
}

/** User-initiated local dictation and read-aloud. Switching chats cancels the current session. */
export function useVoice(onTranscript: (text: string, automatic: boolean) => void) {
  const [state, setState] = useState<VoiceState>({ phase: "idle" });
  const [handsFree, setHandsFree] = useState(false);
  const session = useRef<Session | null>(null);
  const model = useRef<Promise<PhononTTS> | null>(null);
  const preparedReply = useRef<PreparedReply | null>(null);
  const conversationAudio = useRef<PreparedReply | null>(null);
  const restart = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const progressListener = useRef<((progress: LoadProgress) => void) | undefined>(undefined);
  const receive = useRef(onTranscript);
  useLayoutEffect(() => { receive.current = onTranscript; }, [onTranscript]);
  useEffect(() => () => {
    dispose(session.current); session.current = null;
    closeAudio(preparedReply.current?.context); preparedReply.current = null;
    closeAudio(conversationAudio.current?.context); conversationAudio.current = null;
    clearTimeout(restart.current);
    progressListener.current = undefined;
    void model.current?.then((loaded) => loaded.dispose(), () => {});
    model.current = null;
  }, []);

  const cancel = useCallback(() => {
    const previous = session.current;
    session.current = null;
    dispose(previous);
    closeAudio(preparedReply.current?.context); preparedReply.current = null;
    closeAudio(conversationAudio.current?.context); conversationAudio.current = null;
    clearTimeout(restart.current);
    progressListener.current = undefined;
    setHandsFree(false);
    setState({ phase: "idle" });
  }, []);

  useEffect(() => {
    const hide = () => { if (document.hidden && conversationAudio.current) cancel(); };
    const leave = () => cancel();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); };
  }, [cancel]);

  function clearSession() {
    const previous = session.current;
    session.current = null;
    dispose(previous, conversationAudio.current?.context);
  }

  function getModel(onProgress?: (progress: LoadProgress) => void) {
    progressListener.current = onProgress;
    if (!model.current) {
      const loading = loadPhonon((progress) => progressListener.current?.(progress))
        .catch((error) => { if (model.current === loading) model.current = null; throw error; });
      model.current = loading;
    }
    return model.current;
  }

  /** Called from Send/Enter so autoplay has an AudioContext resumed by the user's gesture. */
  function prepareReply() {
    if (conversationAudio.current) clearSession(); else cancel();
    const prepared: PreparedReply = { ...conversationAudio.current, token: Symbol("voice reply") };
    preparedReply.current = prepared;
    try {
      if (!prepared.context && typeof AudioContext !== "undefined") {
        prepared.context = new AudioContext();
        prepared.ready = prepared.context.resume();
        void prepared.ready.catch(() => {}); // Surface any failure with the completed reply.
      }
    } catch { /* Text submission still works if audio is unavailable. */ }
    // Only public model assets load here. The reply text reaches Phonon after completion.
    void getModel().catch(() => {});
    if (conversationAudio.current) setState({ phase: "waiting" });
    return prepared.token;
  }

  function cancelReply(token: symbol) {
    if (preparedReply.current?.token !== token) return;
    cancel();
  }

  function readReply(token: symbol, messageId: string, text: string) {
    if (preparedReply.current?.token !== token) return;
    const prepared = preparedReply.current;
    preparedReply.current = null;
    return startSpeaking(messageId, text, prepared);
  }

  function fail(current: Session, error: unknown, fallback: string) {
    if (session.current !== current) return;
    cancel();
    setState({ phase: "error", error: error instanceof Error ? error.message : fallback });
  }

  function startConversation() {
    cancel();
    try {
      if (typeof AudioContext === "undefined") throw new Error("Hands-free voice is not supported in this browser.");
      // Keep one context unlocked from the microphone click across all conversation turns.
      const context = new AudioContext();
      const ready = context.resume();
      conversationAudio.current = { token: Symbol("conversation"), context, ready };
      void ready.catch(() => {});
      setHandsFree(true);
      void getModel().catch(() => {});
      void record(true);
    } catch (error) {
      cancel();
      setState({ phase: "error", error: error instanceof Error ? error.message : "Could not start voice." });
    }
  }

  function reviewDraft() {
    const current = session.current;
    if (!current || current.recorder?.state !== "recording") return;
    current.automatic = false;
    // The recording's analyser still owns this context until the draft completes.
    conversationAudio.current = null;
    setHandsFree(false);
  }

  function finishRecording() {
    const current = session.current;
    if (current?.recorder?.state === "recording") {
      clearInterval(current.timer);
      setState({ phase: "transcribing" });
      current.recorder.stop();
      current.stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function record(automatic = false) {
    if (automatic) { if (!conversationAudio.current) return; clearSession(); } else cancel();
    const current: Session = { controller: new AbortController(), automatic };
    session.current = current;
    setState({ phase: "requesting" });
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Microphone recording needs a supported browser on localhost or HTTPS.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (session.current !== current) { stream.getTracks().forEach((track) => track.stop()); return; }
      current.stream = stream;
      let detector: { analyser: AnalyserNode; samples: Float32Array<ArrayBuffer>; activity: ReturnType<typeof beginActivity> } | undefined;
      if (automatic) {
        const audio = conversationAudio.current!;
        current.context = audio.context;
        await audio.ready;
        if (session.current !== current) return;
        const analyser = audio.context!.createAnalyser();
        analyser.fftSize = 1024;
        current.microphone = audio.context!.createMediaStreamSource(stream);
        current.microphone.connect(analyser); // Never connect microphone audio to the speakers.
        detector = { analyser, samples: new Float32Array(analyser.fftSize), activity: beginActivity(performance.now()) };
      }
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      current.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => fail(current, new Error("The microphone stopped. Please try again."), "Recording failed.");
      recorder.onstop = async () => {
        if (session.current !== current) return;
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const response = await requestVoice("transcribe", blob, blob.type, current.controller.signal);
          const transcript = transcriptOutput.parse(await response.json());
          if (session.current !== current) return;
          const autoSend = !!current.automatic && !!conversationAudio.current;
          if (autoSend) { clearSession(); setState({ phase: "waiting" }); } else cancel();
          receive.current(transcript.text, autoSend);
        } catch (error) { fail(current, error, "Could not transcribe this recording."); }
      };
      recorder.start(250);
      setState({ phase: "listening", seconds: 0 });
      const start = performance.now();
      current.timer = setInterval(() => {
        if (session.current !== current) return;
        const elapsed = performance.now() - start;
        if (detector && current.automatic) {
          detector.analyser.getFloatTimeDomainData(detector.samples);
          const rms = Math.sqrt(detector.samples.reduce((sum, sample) => sum + sample * sample, 0) / detector.samples.length);
          const result = sampleActivity(detector.activity, { now: performance.now(), rms });
          detector.activity = result.state;
          if (result.decision === "timeout") {
            fail(current, new Error("No speech detected. Start voice again when you’re ready."), "No speech detected.");
            return;
          }
          if (result.decision === "submit") { finishRecording(); return; }
        }
        if (elapsed >= MAX_RECORDING_MS) finishRecording();
        else if (Math.floor(elapsed / 1000) !== Math.floor((elapsed - 50) / 1000)) setState({ phase: "listening", seconds: Math.floor(elapsed / 1000) });
      }, 50);
    } catch (error) {
      const denied = error instanceof DOMException && ["NotAllowedError", "PermissionDeniedError"].includes(error.name);
      fail(current, denied ? new Error("Microphone access is off. Allow it in your browser to dictate.") : error, "Could not open the microphone.");
    }
  }

  async function startSpeaking(messageId: string, text: string, prepared?: PreparedReply) {
    clearSession();
    const current: Session = { controller: new AbortController() };
    current.context = prepared?.context;
    session.current = current;
    setState({ phase: "preparing", messageId });
    try {
      const input = playbackInput.safeParse({ text });
      if (!input.success) throw new Error("Read-aloud supports answers of up to 12,000 characters.");
      if (typeof AudioContext === "undefined") throw new Error("Read-aloud is not supported in this browser.");
      // Resume from the click gesture, before awaiting model generation (including on mobile Safari).
      const context = prepared?.context ?? new AudioContext();
      current.context = context;
      await (prepared?.ready ?? context.resume());
      if (session.current !== current) return;
      const loaded = await getModel((progress) => {
        if (session.current === current && progress.file === "weights" && progress.total) {
          setState({ phase: "preparing", messageId, downloadPercent: Math.min(100, Math.round(progress.loaded / progress.total * 100)) });
        }
      });
      if (session.current !== current) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(context.destination);
      current.sources = new Set();
      const complete = () => {
        if (session.current !== current) return;
        if (!conversationAudio.current) { cancel(); return; }
        clearSession();
        setState({ phase: "waiting" });
        restart.current = setTimeout(() => { if (conversationAudio.current) void record(true); }, 250);
      };
      const speech = loaded.stream(input.data.text, { voice: PHONON_VOICE, signal: current.controller.signal });
      current.speech = speech;
      void speech.done.catch(() => {}); // The iterator and the awaited done below report failures.
      let cursor = context.currentTime, started = false, generated = false;
      for await (const pcm of speech) {
        if (session.current !== current) return;
        if (!pcm.length) continue;
        const buffer = context.createBuffer(1, pcm.length, loaded.sampleRate);
        buffer.copyToChannel(new Float32Array(pcm), 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(analyser);
        current.sources.add(source);
        source.onended = () => {
          current.sources?.delete(source);
          source.disconnect();
          if (generated && !current.sources?.size) complete();
        };
        cursor = Math.max(cursor, context.currentTime);
        source.start(cursor);
        cursor += buffer.duration;
        if (!started) { started = true; setState({ phase: "speaking", messageId, analyser }); }
      }
      await speech.done;
      if (session.current !== current) return;
      generated = true;
      if (!started) throw new Error("No speech was generated. Please try again.");
      if (!current.sources.size) complete();
    } catch (error) { fail(current, error, "Could not read this answer aloud."); }
  }

  return {
    ...state, handsFree, startConversation, reviewDraft, record: () => record(), finishRecording,
    speak: (messageId: string, text: string) => { cancel(); return startSpeaking(messageId, text); },
    prepareReply, readReply, cancelReply, cancel, active: state.phase !== "idle" && state.phase !== "error",
  };
}
