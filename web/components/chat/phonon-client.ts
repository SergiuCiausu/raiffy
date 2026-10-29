"use client";

import type { LoadProgress, PhononTTS } from "phonon-tts";

// Temporary public voice, explicitly selected while Garrett's export is unavailable.
export const PHONON_VOICE = "Preston";
export const PHONON_VOICE_ID = "qIxlZ7Ei8KvWlyQH";
const VERSION = "0.5.0";
const MODEL = "https://huggingface.co/gradium/phonon-31m-en/resolve/92741c5b07d085ff840e26fea8ce43110b87852f";

/** Only model/voice assets are fetched. No text is sent to Gradium or a speech API. */
export async function loadPhonon(onProgress?: (progress: LoadProgress) => void): Promise<PhononTTS> {
  const voice = `/voices/${PHONON_VOICE_ID}.safetensors`;
  const response = await fetch(voice, { cache: "force-cache" });
  if (!response.ok) throw new Error(`${PHONON_VOICE}’s voice file is not installed yet.`);
  const embedding = await response.arrayBuffer();
  if (embedding.byteLength < 16 || embedding.byteLength > 2 * 1024 * 1024) throw new Error(`${PHONON_VOICE}’s voice file is invalid.`);

  const moduleUrl = `/vendor/phonon-tts/${VERSION}/index.js`;
  const { PhononTTS: Runtime } = await import(/* webpackIgnore: true */ moduleUrl) as typeof import("phonon-tts");
  const model = await Runtime.load({
    lang: "en", quant: "q8", device: "cpu", rewrites: "all", cache: true,
    model: {
      weights: { q8: `${MODEL}/model.q8.gguf` }, tokenizer: `${MODEL}/tokenizer.json`, config: `${MODEL}/config.json`,
    },
    onProgress,
  });
  try { await model.addVoice(PHONON_VOICE, embedding); return model; }
  catch (error) { model.dispose(); throw error; }
}
