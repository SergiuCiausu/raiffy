import { test, expect, expectNoHorizontalScroll, isMobile } from "./fixtures";
import type { Page } from "@playwright/test";

// Real browser MediaRecorder + AudioContext; synthetic devices only, never the user's microphone.
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const voiceFile = "**/voices/qIxlZ7Ei8KvWlyQH.safetensors";

// Deterministic streaming runtime for UI states. Actual model inference is checked separately.
const runtimeFixture = `
export class PhononTTS {
  sampleRate = 24000;
  static async load() { return new PhononTTS(); }
  async addVoice() {}
  dispose() {}
  stream(text, { signal }) {
    globalThis.phononCalls = (globalThis.phononCalls || 0) + 1;
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    return {
      done,
      cancel() {},
      async *[Symbol.asyncIterator]() {
        try {
          for (let part = 0; part < 6 && !signal.aborted; part++) {
            const pcm = new Float32Array(24000);
            for (let n = 0; n < pcm.length; n++) pcm[n] = Math.sin(n * Math.PI * 2 * 220 / 24000) * 0.1;
            yield pcm;
            await new Promise(resolve => setTimeout(resolve, 40));
          }
        } finally { finish({ cancelled: signal.aborted }); }
      }
    };
  }
}`;

test.beforeEach(async ({ page }) => {
  await page.route(voiceFile, route => route.fulfill({ contentType: "application/octet-stream", body: Buffer.alloc(16) }));
  await page.route("**/vendor/phonon-tts/0.5.0/index.js", route => route.fulfill({ contentType: "text/javascript", body: runtimeFixture }));
  await page.goto("/chat");
});

async function dictate(page: Page, text = "Explain the five lei ATM fee.") {
  await page.route("**/api/voice/transcribe", route => route.fulfill({ json: { text } }));
  await page.locator("#voice-mic").click();
  await expect(page.getByText("Listening…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review draft", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("#input")).toHaveValue(text);
}

async function trackAudioContexts(page: Page) {
  await page.evaluate(() => {
    const target = window as typeof window & { voiceTestContexts: AudioContext[] };
    target.voiceTestContexts = [];
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) { super(options); target.voiceTestContexts.push(this); }
    };
  });
}

const contextStates = (page: Page) => page.evaluate(() =>
  (window as typeof window & { voiceTestContexts: AudioContext[] }).voiceTestContexts.map(context => context.state));
const speechCalls = (page: Page) => page.evaluate(() => (window as typeof window & { phononCalls?: number }).phononCalls ?? 0);

async function controlVoiceActivity(page: Page) {
  await trackAudioContexts(page);
  await page.evaluate(() => {
    const target = window as typeof window & { microphoneLevel: number; microphoneStreams: MediaStream[] };
    target.microphoneLevel = 0;
    target.microphoneStreams = [];
    AnalyserNode.prototype.getFloatTimeDomainData = function (samples) { samples.fill(target.microphoneLevel); };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      target.microphoneStreams.push(stream);
      return stream;
    };
  });
}

const microphoneStates = (page: Page) => page.evaluate(() =>
  (window as typeof window & { microphoneStreams: MediaStream[] }).microphoneStreams.map(stream => stream.getTracks().map(track => track.readyState)));

async function finishSpokenTurn(page: Page) {
  await page.evaluate(() => { (window as typeof window & { microphoneLevel: number }).microphoneLevel = 0.05; });
  await page.waitForTimeout(500); // Sustained synthetic activity, followed by the real silence timer.
  await page.evaluate(() => { (window as typeof window & { microphoneLevel: number }).microphoneLevel = 0; });
}

test("dictation appends a reviewable draft and never sends automatically", async ({ page }) => {
  await page.route("**/api/voice/transcribe", (route) => route.fulfill({ json: { text: "I am saving for a car." } }));
  const messages = await page.locator(".msg-user").count();
  await page.locator("#input").fill("My goal:");
  await page.getByRole("button", { name: "Dictate a message" }).click();
  await expect(page.getByText("Listening…", { exact: true })).toBeVisible();
  await expect(page.locator("#send")).toBeDisabled();
  await page.locator("#input").press("Enter");
  await expect(page.locator(".msg-user")).toHaveCount(messages);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("#input")).toHaveValue("My goal: I am saving for a car.");
  await expect(page.locator("#input")).toBeFocused();
  await expect(page.locator(".msg-user")).toHaveCount(messages);
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("denied microphone access has a dismissible explanation", async ({ page }) => {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); };
  });
  await page.getByRole("button", { name: "Start voice conversation", exact: true }).click();
  await expect(page.getByText("Microphone access is off. Allow it in your browser to dictate.")).toBeVisible();
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss voice message" }).click();
  await expect(page.locator(".voice-status")).toHaveCount(0);
});

test("cancelling while permission is pending releases a late microphone stream", async ({ page }) => {
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const target = window as typeof window & { completeVoicePermission?: () => Promise<string[]> };
    navigator.mediaDevices.getUserMedia = () => new Promise<MediaStream>((resolve) => {
      target.completeVoicePermission = async () => {
        const stream = await original({ audio: true });
        resolve(stream);
        await new Promise<void>((done) => setTimeout(done, 0));
        return stream.getTracks().map((track) => track.readyState);
      };
    });
  });
  await page.locator("#voice-mic").click();
  await expect(page.getByText("Allow microphone access", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const tracks = await page.evaluate(() => (window as typeof window & { completeVoicePermission: () => Promise<string[]> }).completeVoicePermission());
  expect(tracks.length).toBeGreaterThan(0);
  expect(tracks.every((state) => state === "ended")).toBe(true);
  await expect(page.locator(".voice-status")).toHaveCount(0);
  await expect(page.locator("#input")).toHaveValue("");
});

test("Escape cancels a pending transcript without changing the draft", async ({ page }) => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/voice/transcribe", async (route) => {
    await pending;
    await route.fulfill({ json: { text: "A cancelled transcript." } });
  });
  await page.locator("#input").fill("Keep this draft");
  await page.locator("#voice-mic").click();
  await expect(page.getByText("Listening…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Writing your draft…", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  finish();
  await expect(page.locator(".voice-status")).toHaveCount(0);
  await expect(page.locator("#input")).toHaveValue("Keep this draft");
});

test("speaking orb follows streamed playback without a speech API call", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/voice/speak")) apiCalls.push(request.url()); });
  const read = page.getByRole("button", { name: "Read answer aloud", exact: true }).last();
  await read.click();
  await expect(page.getByText("Raiffy is speaking", { exact: true })).toBeVisible();
  await expect(page.getByTestId("speaking-orb")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop reading answer" })).toHaveAttribute("aria-pressed", "true");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop reading answer" })).toHaveCount(0);
  expect(apiCalls).toEqual([]);
});

test("reduced motion keeps the orb still and playback completion dismisses it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Read answer aloud", exact: true }).last().click();
  const orb = page.getByTestId("speaking-orb");
  await expect(orb).toBeVisible();
  expect(await orb.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(orb).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".voice-status")).toHaveCount(0);
});

test("switching chats cancels generation before any speaking orb appears", async ({ page }) => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  await page.route(voiceFile, async (route) => {
    await pending;
    await route.fulfill({ contentType: "application/octet-stream", body: Buffer.alloc(16) });
  });
  await page.getByRole("button", { name: "Read answer aloud", exact: true }).last().click();
  await expect(page.getByText("Preparing audio…", { exact: true })).toBeVisible();
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
  if (isMobile(page)) await page.locator("#open-side").click();
  await page.getByRole("button", { name: /Why I paid a 5 lei ATM fee/ }).click();
  finish();
  await expect(page.locator(".voice-status")).toHaveCount(0);
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
});

test("an invalid voice file fails explicitly without another voice or a cloud fallback", async ({ page }) => {
  await page.route(voiceFile, route => route.fulfill({ contentType: "application/octet-stream", body: Buffer.alloc(4) }));
  await page.getByRole("button", { name: "Read answer aloud", exact: true }).last().click();
  await expect(page.getByText("Preston’s voice file is invalid.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
});

test("a voice-submitted question reads its completed reply, while the next typed question stays silent", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trackAudioContexts(page);
  await dictate(page);
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Send message and read reply aloud");
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
  await page.locator("#send").click();
  await expect(page.locator(".think-live")).toBeVisible();
  expect(await contextStates(page)).toEqual(["closed", "running"]); // Draft capture closed; Send primes playback.
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
  await expect(page.getByTestId("speaking-orb")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#thread .msg-raiffy").last().getByRole("button", { name: "Stop reading answer" })).toBeVisible();
  expect((await contextStates(page)).length).toBe(2); // Playback reuses the context primed by Send.
  await page.getByRole("button", { name: "Stop speaking", exact: true }).click();
  await page.locator("#input").fill("What does DAE mean?");
  await page.locator("#input").press("Enter");
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Stop reply");
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Send message", { timeout: 15_000 });
  await expect(page.locator(".voice-status")).toHaveCount(0);
  expect(await speechCalls(page)).toBe(1);
});

test("stopping a voice-triggered reply cancels its queued narration and closes prepared audio", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trackAudioContexts(page);
  await dictate(page);
  await page.locator("#send").click();
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Stop reply");
  await page.locator("#send").click();
  await expect(page.locator("#thread .msg-raiffy").last().getByText("You stopped this reply.")).toBeVisible();
  await expect.poll(() => contextStates(page)).toEqual(["closed", "closed"]);
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
  expect(await speechCalls(page)).toBe(0);
});

test("switching chats drops a queued voice reply", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trackAudioContexts(page);
  await dictate(page);
  await page.locator("#send").click();
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Stop reply");
  if (isMobile(page)) await page.locator("#open-side").click();
  await page.locator("#new-chat").click();
  await expect(page.locator("#empty")).toBeVisible();
  await expect.poll(() => contextStates(page)).toEqual(["closed", "closed"]);
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
  expect(await speechCalls(page)).toBe(0);
});

test("clearing a dictated draft restores manual playback for typed questions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await dictate(page);
  await page.locator("#input").fill("");
  await page.locator("#input").fill("What does DAE mean?");
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Send message");
  await page.locator("#input").press("Enter");
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Stop reply");
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Send message", { timeout: 15_000 });
  await expect(page.locator(".voice-status")).toHaveCount(0);
  expect(await speechCalls(page)).toBe(0);
});

test("hands-free sends on a pause, speaks with the orb, then listens for the next turn", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await controlVoiceActivity(page);
  let transcriptions = 0;
  await page.route("**/api/voice/transcribe", route => route.fulfill({ json: {
    text: ++transcriptions === 1 ? "Explain the five lei ATM fee." : "What does DAE mean?",
  } }));
  const count = await page.locator(".msg-user").count();
  await page.getByRole("button", { name: "Start voice conversation", exact: true }).click();
  await expect(page.getByText("Pause to send · English", { exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  expect(transcriptions).toBe(0);
  await finishSpokenTurn(page);
  await expect(page.locator(".msg-user")).toHaveCount(count + 1);
  await expect(page.locator("#input")).toHaveValue("");
  await expect(page.getByTestId("speaking-orb")).toBeVisible();
  expect(await microphoneStates(page)).toEqual([["ended"]]); // No recording during response playback.
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `test-results/hands-free-${isMobile(page) ? "mobile" : "desktop"}-speaking.png` });
  await expect(page.getByText("Listening…", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByTestId("speaking-orb")).toHaveCount(0);
  expect(await microphoneStates(page)).toEqual([["ended"], ["live"]]);
  await page.screenshot({ path: `test-results/hands-free-${isMobile(page) ? "mobile" : "desktop"}-listening.png` });
  await finishSpokenTurn(page);
  await expect(page.locator(".msg-user")).toHaveCount(count + 2);
  await expect(page.getByTestId("speaking-orb")).toBeVisible();
  expect(await speechCalls(page)).toBe(2);
  expect(await contextStates(page)).toEqual(["running"]); // One context unlocked by the initial click.
  await page.locator(".voice-dismiss").click();
  await expect(page.locator(".voice-status")).toHaveCount(0);
  await expect.poll(() => contextStates(page)).toEqual(["closed"]);
  expect(await microphoneStates(page)).toEqual([["ended"], ["ended"]]);
});

test("hands-free silence times out without transcribing or sending", async ({ page }) => {
  await controlVoiceActivity(page);
  let calls = 0;
  await page.route("**/api/voice/transcribe", route => { calls++; return route.fulfill({ json: { text: "Must not be sent" } }); });
  const count = await page.locator(".msg-user").count();
  await page.locator("#voice-mic").click();
  await expect(page.getByText("Listening…", { exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.runFor(10_200);
  await expect(page.getByText("No speech detected. Start voice again when you’re ready.", { exact: true })).toBeVisible();
  expect(calls).toBe(0);
  await expect(page.locator(".msg-user")).toHaveCount(count);
  expect(await microphoneStates(page)).toEqual([["ended"]]);
  await expect.poll(() => contextStates(page)).toEqual(["closed"]);
});

test("ending hands-free during transcription discards a late transcript", async ({ page }) => {
  await controlVoiceActivity(page);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/api/voice/transcribe", async route => {
    await pending;
    await route.fulfill({ json: { text: "A late question" } });
  });
  const count = await page.locator(".msg-user").count();
  await page.locator("#voice-mic").click();
  await expect(page.getByText("Listening…", { exact: true })).toBeVisible();
  await finishSpokenTurn(page);
  await expect(page.getByText("Sending your question…", { exact: true })).toBeVisible();
  await page.locator(".voice-dismiss").click();
  finish();
  await expect(page.locator(".voice-status")).toHaveCount(0);
  await expect(page.locator(".msg-user")).toHaveCount(count);
  await expect.poll(() => contextStates(page)).toEqual(["closed"]);
});

test("switching chats ends hands-free and prevents a late reply from restarting it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await controlVoiceActivity(page);
  await page.route("**/api/voice/transcribe", route => route.fulfill({ json: { text: "Explain the ATM fee" } }));
  await page.locator("#voice-mic").click();
  await expect(page.getByText("Listening…", { exact: true })).toBeVisible();
  await finishSpokenTurn(page);
  await expect(page.locator("#send")).toHaveAttribute("aria-label", "Stop reply");
  if (isMobile(page)) await page.locator("#open-side").click();
  await page.locator("#new-chat").click();
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator(".voice-status")).toHaveCount(0);
  await expect.poll(() => contextStates(page)).toEqual(["closed"]);
  expect(await speechCalls(page)).toBe(0);
});

test("typing or hiding the tab ends hands-free recording", async ({ page }) => {
  await controlVoiceActivity(page);
  await page.locator("#voice-mic").click();
  await expect(page.getByText("Listening…", { exact: true })).toBeVisible();
  await page.locator("#input").fill("Let me type instead");
  await expect(page.locator(".voice-status")).toHaveCount(0);
  expect(await microphoneStates(page)).toEqual([["ended"]]);
  await page.locator("#input").fill("");
  await page.locator("#voice-mic").click();
  await expect(page.getByText("Listening…", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".voice-status")).toHaveCount(0);
  await expect.poll(() => contextStates(page)).toEqual(["closed", "closed"]);
  expect(await microphoneStates(page)).toEqual([["ended"], ["ended"]]);
});

test("a speech error ends hands-free instead of silently reopening the microphone", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await controlVoiceActivity(page);
  await page.route(voiceFile, route => route.fulfill({ contentType: "application/octet-stream", body: Buffer.alloc(4) }));
  await page.route("**/api/voice/transcribe", route => route.fulfill({ json: { text: "Explain the ATM fee" } }));
  await page.locator("#voice-mic").click();
  await expect(page.getByText("Listening…", { exact: true })).toBeVisible();
  await finishSpokenTurn(page);
  await expect(page.getByText("Preston’s voice file is invalid.", { exact: true })).toBeVisible();
  await expect.poll(() => contextStates(page)).toEqual(["closed"]);
  expect(await microphoneStates(page)).toEqual([["ended"]]);
  await expect(page.getByRole("button", { name: "Start voice conversation", exact: true })).toBeVisible();
});
