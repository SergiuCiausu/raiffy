# Local speech: Phonon TTS and VibeVoice STT

The voice layer is now integrated with the authenticated `AgentChat` on main `131fe19`. Dictation uses the existing local VibeVoice bridge; read-aloud uses the pinned Phonon/Preston browser runtime. Automatic speech waits for the exact checked reply returned by the current Convex chat request, and Stop or switching conversations cancels the pending narration. Backend, authentication, account access, memory, catalog and booking logic are unchanged from main. The browser can narrate checked replies up to 12,000 characters; the separate Python speech endpoint remains capped at 2,000.

Merge validation: 693 backend tests pass (one existing skip), 90 web tests, 10 Python guards, all TypeScript checks, scoped lint and the production build pass. A synthetic browser harness exercised microphone activity, transcription handoff, automatic send, checked-reply playback and Stop using mock backend/model responses and a generated audio stream. It did not access a physical microphone, call paid providers or establish live model accuracy. Earlier browser scripts below target the historical scripted-chat checkpoint (`81553c3`) and need an authenticated fixture adapter before use against the current `/chat`.

## Current app read-aloud: Phonon + Preston

The app's read-aloud path now uses `phonon-tts@0.5.0` in a browser worker, with the Apache-2.0 Phonon 31m English checkpoint pinned to `92741c5b07d085ff840e26fea8ce43110b87852f`. The worker stays loaded across replies and streams PCM into Web Audio and the existing Siri orb. No answer text goes to Gradium or a speech API. VibeVoice STT remains the existing local bridge; the VibeVoice TTS CLI below is retained for comparison.

The owner selected a temporary public voice: **Preston** (`qIxlZ7Ei8KvWlyQH`), English (US), from the Apache-2.0 `gradium/phonon-voices` catalog. Its 256,136-byte embedding is included under `web/public/voices/`, with a source revision, SHA-256 provenance sidecar and license. No Gradium account, API key or voice-export step is required. The client labels the speaker Preston; it does not present it as Garrett.

Click the microphone with an empty composer to start a hands-free conversation. Sustained speech followed by a 1.2-second pause is transcribed and sent automatically. The completed reply plays with the supplied Siri orb, then listening resumes after the audio ends. One audio context is unlocked by the initial click and reused across turns. The microphone is stopped during transcription, thinking and playback so the answer cannot transcribe itself. This is turn-by-turn voice; speaking over the reply is not supported.

No speech for 10 seconds ends listening without a transcription request or message; a recording can last at most 30 seconds. Stop, Escape, typing, hiding the tab or switching chats ends the conversation and releases its resources. Transcription or playback errors also end the loop. Detection uses local audio energy with a minimum speech duration and a short attack gate, not a cloud VAD service; noisy rooms and real microphones still need acceptance samples.

Choose “Review draft” while listening to keep the recording as an editable draft. Starting the microphone with an existing draft or attachment also uses review mode. Sending that draft prepares audio from the Send/Enter gesture and reads the completed reply automatically. Typed questions retain the manual speaker action. Clearing the dictated draft restores manual playback; editing a nonempty dictated draft preserves its read-aloud intent.

Garrett (`POBHtemksfWQbng0`) remains a future voice change. It is absent from the public catalog checked on 2026-10-28, and the Studio catalog offers no “Download for Phonon” action for it. The Studio download route is authenticated; its demo can fall back to cloud generation. The optional import commands below only install its file. To switch later, update `PHONON_VOICE` and `PHONON_VOICE_ID` in `web/components/chat/phonon-client.ts` after validating that export.

Install an owner-provided **Garrett** `.safetensors` export:

```sh
pnpm voice:garrett --file /absolute/path/to/Garrett.safetensors
```

Or, after putting `GRADIUM_API_KEY` in the root `.env.local`, try Gradium's official one-time export workflow:

```sh
pnpm voice:garrett --download
```

This sends the key only in a header to `api.gradium.ai`, fetches the requested voice without generating speech, validates the safetensors container, and writes `web/public/voices/POBHtemksfWQbng0.safetensors` plus a provenance/hash sidecar. The key never enters a browser bundle. Gradium may restrict catalog exports; an HTTP rejection leaves the asset absent. Only a successful export or an owner-supplied file can unblock this voice. A preview WAV is not a voice embedding and is rejected. The client reports a missing/invalid selected voice explicitly; it does not silently use another speaker or cloud TTS.

The first model load downloads roughly 64 MB and reports progress. Later replies reuse the worker and cached weights. CPU is selected; no cross-origin isolation or new hosting provider is needed. Phonon generates on-device after its model and selected voice are loaded; Garrett remains unverified. This does not turn the rest of the Next app into an offline PWA. Browser assets from the pinned npm package (including license notices) are copied unchanged into the ignored `web/public/vendor/` directory by the dev/build commands.

Browser runtime check on 2026-10-28, Apple M5: the **public default voice**, not Garrett, generated a synthetic 6.32-second sentence on one CPU thread. The first PCM chunk arrived 35 ms after model load; total generation was about 700 ms. Initial model/download initialization took 30.2 seconds in that fresh Chrome profile. These are one-run measurements, exclude actual audio output buffering, and do not validate Garrett. Evidence is in `.local/voice/outputs/phonon-browser-check.json` and `phonon-browser-fixture.wav`.

36 deterministic desktop/phone voice UI checks cover the hands-free loop, silence timeout, automatic voice replies, manual typed replies, streaming playback, cancellation, reduced motion, microphone handling and explicit invalid-file failure. Six pure detector tests cover pauses, sustained speech, clicks, background noise, clock stalls and recording limits. The exact Garrett voice remains unverified until its file is available.

Run `pnpm voice:check-browser` with the web dev server running for actual Preston acceptance through the chat: it plays a seeded synthetic answer, captures its PCM as a WAV, verifies a second playback with the network disabled, checks Stop and the 375px layout, and records timings/screenshots under `.local/voice/outputs/phonon-preston-*`. This uses an isolated Chrome test profile and performs no speech API call.

Preston app acceptance on 2026-10-28: real seeded-answer playback passed with the selected public embedding, followed by a successful replay with the network disabled. One M5/Chrome run scheduled its first audio 449 ms after clicking with cached assets, and the already-loaded offline replay took 85 ms. These timings stop at Web Audio scheduling, exclude physical speaker latency, and are single-run observations. Stop worked, there were zero speech API POSTs or page errors, and the 375×812 viewport had no horizontal overflow. STT of the captured 29.12-second narration preserved the seeded amounts and rates; it spelled the Romanian currency phonetically as “lay.” Evidence: `.local/voice/outputs/phonon-preston-browser.json`, `phonon-preston-app.wav`, and desktop/mobile screenshots.

Run `pnpm voice:check-reply` for the complete automatic-reply path with a synthetic microphone fixture, actual local VibeVoice transcription and actual Phonon playback. Acceptance on 2026-10-29 passed: the dictated draft was reviewed/sent, one audio context was prepared before completion and reused, the completed reply began speaking with the orb, and Stop closed the context. There were zero speech API POSTs or page errors. Evidence: `.local/voice/outputs/phonon-auto-reply.json` and `phonon-auto-reply.png`. This checks Chrome with synthetic audio; it does not establish real iPhone/Safari acceptance.

Run `pnpm voice:check-hands-free` for actual silence detection → local transcription → automatic Send → Preston playback → resumed listening. The test appends silence to the existing synthetic microphone fixture, uses an isolated Chrome test profile and calls no paid speech API. Acceptance on 2026-10-29 passed: the sentence about saving for a car was sent without a second click, recording stopped during playback, listening resumed, one audio context served the conversation, and Stop released it along with both microphone streams. There were no speech API POSTs, page errors or horizontal overflow at 375×812. Evidence: `.local/voice/outputs/phonon-hands-free.json`, `phonon-hands-free-speaking.png` and `phonon-hands-free-mobile.png`. The two-turn loop and interruptions are also covered by deterministic browser checks; a real noisy room and real iPhone/Safari remain untested.


## VibeVoice sandbox

Run the voice models on a Mac while Raiffy's existing Convex deployment stays in the cloud. This sandbox does not change deployment configuration, call the agent, or use OpenAI, Anthropic or another paid API.

## Models

- STT: Microsoft's [VibeVoice-ASR-BitNet](https://github.com/microsoft/VibeASR.cpp), a quantized CPU model with an official ARM/Apple Silicon implementation. Only the two GGUF weights are downloaded, not the larger original ASR safetensors. The first English synthetic fixture passed on this M5; the first Romanian fixture failed. Do not treat the quantized 1.5B model as equivalent to the full 7B model's language support, or enable Romanian app dictation on this result.
- TTS: Microsoft's [VibeVoice-Realtime-0.5B](https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-realtime-0.5b.md), using the upstream MPS path and a supplied English voice preset. English is the supported target for Raiffy's current interface. Romanian transcription needs its own acceptance samples; Romanian TTS is not promised.

Both repositories and model revisions are pinned in `upstream.lock.json`. The models are separate processes and run sequentially so their memory use does not overlap on a 16 GB Mac. Upstream licences are retained in the vendor checkouts/model cards.

## Setup and use

Prerequisites: macOS Apple Silicon, Git, Xcode Command Line Tools and [uv](https://docs.astral.sh/uv/). Python 3.11 and CMake install into the isolated sandbox; Docker is not required.

```sh
pnpm voice:setup
pnpm voice:test
pnpm voice:smoke

pnpm voice:transcribe /absolute/path/to/recording.wav
pnpm voice:speak "Hello. How can I help you today?"
```

Use `pnpm voice:setup --only stt` or `--only tts` to prepare one direction. The first setup downloads several GB; subsequent runs reuse the checkouts and weights. No microphone is accessed automatically.

`voice:smoke` creates a synthetic English recording with macOS `say`, transcribes it with VibeASR, generates a separate response with VibeVoice TTS, then transcribes that generated response. The original fixture is synthetic, not a recording of a customer. It checks preservation of key words; it is not a transcription-quality benchmark.

Generated audio, transcripts, logs, timings, vendor repositories and the Python environment are under the gitignored `.local/voice/` directory:

- `outputs/smoke.json`: test results, including the exact model revisions and elapsed times.
- `outputs/speech-input_generated.wav`: generated speech to listen to.
- `outputs/stt.log`, `outputs/tts.log`: upstream diagnostics.

Elapsed time includes process startup/model loading unless a separate inference field is present. Advertised upstream latency is not used as a result for this Mac. `--device cpu` is an explicit TTS alternative; there is no automatic switch to a hosted API.

The local TTS launcher adds a compatibility fix for current PyTorch's handling of the upstream preset's Transformers cache objects. The exception applies only to the fixed Microsoft Carter preset whose SHA-256 is pinned in `upstream.lock.json`; it deserializes verified bytes and leaves all other checkpoint load policies unchanged. Uploaded/custom voice presets are not supported. Three tests cover that boundary. PyTorch is pinned to the tested `2.15.0`, and the upstream streaming-TTS extra pins Transformers to `4.51.3`.

## Acceptance on 2026-10-28

Test machine: Apple M5, 16 GB unified memory; PyTorch reports MPS available. Actual model inference was run, not mocked:

- English STT preserved the synthetic sentence about saving for a car.
- English TTS generated a greeting on MPS; STT transcribed the generated speech back correctly, apart from the spelling of the product name.
- A synthetic Romanian sentence generated with macOS's Ioana voice produced an incorrect transcript. Romanian input is a failed acceptance case for this selected small model. The model card lists English, Chinese, French, Italian, Korean, Portuguese and Vietnamese, not Romanian.
- One measured run: 2.69 s English input → 0.90 s STT inference (1.49 s including load). TTS produced 4.40 s audio in 6.26 s of generation (18.85 s including load). These are single synthetic-clip observations, not latency guarantees or a quality benchmark.

The current launcher loads TTS for each invocation and writes a complete WAV. It does not implement the advertised streaming first-audio latency. A persistent streaming service remains later work.

## VibeVoice browser bridge retained

The Next.js microphone continues to use `POST /api/voice/transcribe`: at most 2 MB of browser audio, decoded to at most 30 seconds of mono WAV. Hands-free mode sends after a pause; review mode fills an editable draft. Use `pnpm --dir web dev`, then open `http://localhost:3000/chat`.

The legacy `POST /api/voice/speak` VibeVoice route remains a local comparison/test endpoint. The app's read-aloud action now uses the Phonon browser worker described at the top of this document and does not call that endpoint. Both legacy routes accept only same-origin loopback HTTP requests in Next development mode; they reject production, remote hosts and cross-origin requests. They serialize model jobs and delete per-request temporary recordings/transcripts/logs on completion or cancellation.

Earlier browser acceptance on 2026-10-28 verified the actual VibeVoice STT/TTS workers with synthetic audio, including cancellation cleanup. The subsequent Phonon runtime and UI checks are described above. Real iPhone/Safari playback remains untested. The chat's separate agent/answer integration is outside this voice work.

Do not start a local Convex backend for these tests. No public tunnel, paid speech API fallback or shared inference host is configured.
