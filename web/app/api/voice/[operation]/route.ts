import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { isLocalVoiceRequest, MAX_RECORDING_BYTES, speechInput, transcriptOutput, voiceOperation } from "../../../../lib/voice";

// One model process at a time on the local 16 GB machine, including across dev reloads.
const host = globalThis as typeof globalThis & { raiffyVoiceBusy?: boolean };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
class InputError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("The recording is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RECORDING_BYTES) { await reader.cancel(); throw new InputError("Keep recordings under 2 MB.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

function run(operation: "transcribe" | "speak", data: Buffer, signal: AbortSignal): Promise<Buffer> {
  return new Promise((accept, reject) => {
    if (signal.aborted) { reject(new Error("Cancelled")); return; }
    const root = resolve(process.cwd(), "..");
    const child = spawn(resolve(root, ".local/voice/venv/bin/python"), ["-u", resolve(root, "tools/voice/web.py"), operation], {
      cwd: root, stdio: ["pipe", "pipe", "ignore"], detached: true,
    });
    const chunks: Buffer[] = [];
    let size = 0, cancelled = false;
    const stop = () => {
      cancelled = true;
      if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ } }
    };
    const timer = setTimeout(stop, 180_000);
    signal.addEventListener("abort", stop, { once: true });
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", stop); };
    child.on("error", () => { cleanup(); reject(new Error("Unavailable")); });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) stop(); else chunks.push(chunk);
    });
    child.stdin.on("error", () => { /* Process exit is handled below. */ });
    child.on("close", (code) => {
      cleanup();
      if (code !== 0 || cancelled) reject(new Error("Voice job failed")); else accept(Buffer.concat(chunks));
    });
    child.stdin.end(data);
  });
}

export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  if (!isLocalVoiceRequest(request.url, request.headers.get("origin"), process.env.NODE_ENV)) {
    return fail("Voice is available in the local development app only.", 403);
  }
  const operation = voiceOperation.safeParse((await context.params).operation);
  if (!operation.success) return fail("Unknown voice action.", 404);
  if (host.raiffyVoiceBusy) return fail("Voice is busy. Try again in a moment.", 409);
  host.raiffyVoiceBusy = true;
  try {
    let data = await body(request);
    if (operation.data === "speak") {
      let json: unknown;
      try { json = JSON.parse(data.toString("utf8")); } catch { throw new InputError("Choose an answer to read aloud."); }
      const input = speechInput.safeParse(json);
      if (!input.success) return fail("Choose an answer of up to 2,000 characters.", 400);
      data = Buffer.from(JSON.stringify(input.data));
    } else if (!/^audio\/(webm|mp4|wav|x-wav|ogg|mpeg)(;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return fail("This recording format is not supported.", 400);
    }
    const result = await run(operation.data, data, request.signal);
    if (operation.data === "transcribe") {
      return Response.json(transcriptOutput.parse(JSON.parse(result.toString("utf8"))), { headers: { "Cache-Control": "no-store" } });
    }
    return new Response(new Uint8Array(result), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InputError) return fail(error.message, error.status);
    return fail("Voice could not finish. Check the local VibeVoice setup and try again.", 503);
  } finally { host.raiffyVoiceBusy = false; }
}
