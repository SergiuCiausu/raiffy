/** Actual app/model acceptance with an isolated test profile and synthetic seeded answers. */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "web/package.json"));
const { chromium } = require("@playwright/test");
const output = resolve(root, ".local/voice/outputs");
const handsFree = process.argv.includes("--hands-free");
const automatic = handsFree || process.argv.includes("--voice-reply");
await mkdir(output, { recursive: true });
if (handsFree) {
  execFileSync(resolve(root, ".local/voice/venv/bin/python"), ["-c", `
import sys, wave
with wave.open(sys.argv[1], 'rb') as source:
    params, frames = source.getparams(), source.readframes(source.getnframes())
with wave.open(sys.argv[2], 'wb') as target:
    target.setparams(params)
    target.writeframes(frames + bytes(params.framerate * params.nchannels * params.sampwidth * 20))
`, resolve(output, "synthetic-input.wav"), resolve(output, "hands-free-input.wav")]);
}
const context = await chromium.launchPersistentContext(resolve(root, ".local/voice/phonon-browser-test"), {
  channel: "chrome", headless: true, viewport: { width: 1360, height: 900 },
  args: automatic ? [
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${resolve(output, handsFree ? "hands-free-input.wav" : "synthetic-input.wav")}`,
  ] : [],
});
try {
  const page = await context.newPage();
  const errors = [];
  const speechCalls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && /speech|\/speak|gradium|huggingface/.test(request.url())) speechCalls.push(request.url());
  });
  await page.addInitScript(() => {
    window.phononCheck = { clicked: 0, first: null, chunks: [], sampleRate: 24000, contexts: [] };
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest('button[aria-label="Read answer aloud"]')) {
        window.phononCheck.clicked = performance.now();
        window.phononCheck.first = null;
        window.phononCheck.chunks = [];
      }
    }, true);
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options) { super(options); window.phononCheck.contexts.push(this); }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => {
          const state = window.phononCheck;
          if (state.first === null) state.first = performance.now();
          if (source.buffer) {
            state.chunks.push(source.buffer.getChannelData(0).slice());
            state.sampleRate = source.buffer.sampleRate;
          }
          return start(...args);
        };
        return source;
      }
    };
  });
  await page.goto("http://localhost:3000/chat");
  if (handsFree) {
    await checkHandsFree(page, errors, speechCalls);
  } else if (automatic) {
    await checkAutomaticReply(page, errors, speechCalls);
  } else {
  const read = () => page.getByRole("button", { name: "Read answer aloud", exact: true }).last();
  await read().click();
  await page.getByTestId("speaking-orb").waitFor({ timeout: 180_000 });
  await page.getByText("English · Preston · On this device", { exact: true }).waitFor();
  const firstUseMs = await page.evaluate(() => Math.round(window.phononCheck.first - window.phononCheck.clicked));
  console.log(JSON.stringify({ voice: "Preston", firstUseMs, stage: "playing actual app audio" }));
  await page.screenshot({ path: resolve(output, "phonon-preston-desktop.png") });
  await page.locator(".voice-status").waitFor({ state: "detached", timeout: 120_000 });

  const audio = await page.evaluate(() => {
    const { chunks, sampleRate } = window.phononCheck;
    const samples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
    const ascii = (offset, text) => { for (let n = 0; n < text.length; n++) view.setUint8(offset + n, text.charCodeAt(n)); };
    ascii(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, samples * 2, true);
    let offset = 44;
    for (const chunk of chunks) for (const sample of chunk) { view.setInt16(offset, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true); offset += 2; }
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let n = 0; n < bytes.length; n += 8192) binary += String.fromCharCode(...bytes.subarray(n, n + 8192));
    return { base64: btoa(binary), seconds: samples / sampleRate };
  });
  await writeFile(resolve(output, "phonon-preston-app.wav"), Buffer.from(audio.base64, "base64"));

  // Same open app, loaded model, and loaded voice; no network is available for the second reply.
  await context.setOffline(true);
  await read().click();
  await page.getByTestId("speaking-orb").waitFor({ timeout: 10_000 }).catch(async (error) => {
    console.log(JSON.stringify({ offlineFailure: await page.locator(".voice-status").innerText(), errors, speechCalls }));
    throw error;
  });
  const warmOfflineMs = await page.evaluate(() => Math.round(window.phononCheck.first - window.phononCheck.clicked));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300); // Let existing responsive drawer transitions settle for the screenshot.
  await page.screenshot({ path: resolve(output, "phonon-preston-mobile.png") });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  await page.getByTestId("speaking-orb").waitFor({ state: "detached" });
  const report = {
    voice: "Preston", voiceId: "qIxlZ7Ei8KvWlyQH", syntheticSeededAnswer: true,
    firstUseClickToScheduledAudioMs: firstUseMs, warmOfflineClickToScheduledAudioMs: warmOfflineMs,
    audioSeconds: audio.seconds, offlinePlayback: true, stoppedSuccessfully: true,
    phoneViewport: "375x812", horizontalOverflow: overflow, speechApiCalls: speechCalls.length, errors,
  };
  await writeFile(resolve(output, "phonon-preston-browser.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (errors.length || speechCalls.length || overflow > 0) throw new Error("Browser acceptance failed; see the report.");
  }
} finally {
  await context.setOffline(false);
  await context.close();
}

async function checkAutomaticReply(page, errors, speechCalls) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#voice-mic").click();
  await page.getByText("Listening…", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Review draft", exact: true }).click();
  await page.waitForTimeout(3200); // Record only the synthetic file supplied to Chrome's fake device.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator('#send[aria-label="Send message and read reply aloud"]').waitFor({ timeout: 60_000 });
  const transcript = await page.locator("#input").inputValue();
  if (!/saving|car|years/i.test(transcript)) throw new Error("The local ASR did not preserve the synthetic fixture.");
  if (await page.getByTestId("speaking-orb").count()) throw new Error("Speech started before the draft was sent.");

  const priorContexts = await page.evaluate(() => window.phononCheck.contexts.length);
  await page.locator("#send").click();
  await page.locator(".think-live").waitFor();
  const preparedBeforeReply = await page.evaluate(prior => window.phononCheck.contexts.length === prior + 1, priorContexts);
  if (await page.getByTestId("speaking-orb").count()) throw new Error("Speech started during thinking.");
  await page.getByTestId("speaking-orb").waitFor({ timeout: 180_000 });
  await page.getByText("English · Preston · On this device", { exact: true }).waitFor();
  const completeBeforePlayback = await page.locator(".think-live").count() === 0
    && await page.locator("#send").getAttribute("aria-label") === "Send message";
  const contextCount = await page.evaluate(() => window.phononCheck.contexts.length);
  await page.screenshot({ path: resolve(output, "phonon-auto-reply.png") });
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  await page.getByTestId("speaking-orb").waitFor({ state: "detached" });
  const closed = await page.evaluate(() => window.phononCheck.contexts.every(audio => audio.state === "closed"));
  const report = {
    syntheticMicrophoneFixture: true, transcription: transcript, actualLocalSTT: true, actualPhononTTS: true,
    voice: "Preston", automaticallyReadReply: true, preparedBeforeReply, completeBeforePlayback,
    audioContexts: contextCount, preparedContextReused: contextCount === priorContexts + 1, stoppedSuccessfully: closed,
    speechApiCalls: speechCalls.length, errors,
  };
  await writeFile(resolve(output, "phonon-auto-reply.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (!preparedBeforeReply || !completeBeforePlayback || contextCount !== priorContexts + 1 || !closed || speechCalls.length || errors.length) {
    throw new Error("Automatic reply acceptance failed; see the report.");
  }
}

async function checkHandsFree(page, errors, speechCalls) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.phononCheck.microphones = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      window.phononCheck.microphones.push(stream);
      return stream;
    };
  });
  const prior = await page.locator(".msg-user").count();
  await page.locator("#voice-mic").click();
  await page.getByText("Listening…", { exact: true }).waitFor();
  await page.getByText("Sending your question…", { exact: true }).waitFor({ timeout: 35_000 });
  await page.getByTestId("speaking-orb").waitFor({ timeout: 180_000 });
  const transcription = await page.locator(".msg-user").last().innerText();
  const autoSent = await page.locator(".msg-user").count() === prior + 1 && /saving|car|years/i.test(transcription);
  const pausedDuringPlayback = await page.evaluate(() => window.phononCheck.microphones.length === 1
    && window.phononCheck.microphones[0].getTracks().every(track => track.readyState === "ended"));
  await page.screenshot({ path: resolve(output, "phonon-hands-free-speaking.png") });
  await page.getByText("Listening…", { exact: true }).waitFor({ timeout: 120_000 });
  const resumedListening = await page.evaluate(() => window.phononCheck.microphones.length === 2
    && window.phononCheck.microphones[1].getTracks().every(track => track.readyState === "live"));
  const contextReused = await page.evaluate(() => window.phononCheck.contexts.length === 1);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(output, "phonon-hands-free-mobile.png") });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.locator(".voice-dismiss").click();
  await page.locator(".voice-status").waitFor({ state: "detached" });
  const released = await page.evaluate(() => window.phononCheck.contexts.every(audio => audio.state === "closed")
    && window.phononCheck.microphones.every(stream => stream.getTracks().every(track => track.readyState === "ended")));
  const report = {
    syntheticMicrophoneFixture: true, actualLocalSTT: true, actualPhononTTS: true, actualSilenceDetection: true,
    voice: "Preston", transcription, automaticallySent: autoSent, microphonePausedDuringPlayback: pausedDuringPlayback,
    resumedListeningAfterPlayback: resumedListening, singleAudioContextReused: contextReused, stoppedAndReleased: released,
    phoneViewport: "375x812", horizontalOverflow: overflow, speechApiCalls: speechCalls.length, errors,
  };
  await writeFile(resolve(output, "phonon-hands-free.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (!autoSent || !pausedDuringPlayback || !resumedListening || !contextReused || !released || overflow > 0 || speechCalls.length || errors.length) {
    throw new Error("Hands-free acceptance failed; see the report.");
  }
}
