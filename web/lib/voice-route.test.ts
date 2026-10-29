import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/voice/[operation]/route";
import { MAX_RECORDING_BYTES } from "./voice";

afterEach(() => { vi.unstubAllEnvs(); });

function request(body: string | Uint8Array, type = "application/json", origin = "http://localhost:3000", operation = "speak") {
  return POST(new Request(`http://localhost:3000/api/voice/${operation}`, {
    method: "POST", headers: { origin, "content-type": type }, body: typeof body === "string" ? body : new Uint8Array(body),
  }), { params: Promise.resolve({ operation }) });
}

describe("voice endpoint rejects invalid requests before inference", () => {
  it("rejects production even on localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await request('{"text":"Hello"}')).status).toBe(403);
  });
  it("rejects cross-origin requests", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await request('{"text":"Hello"}', "application/json", "https://another-site.test")).status).toBe(403);
  });
  it("rejects unknown actions", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await request("{}", "application/json", "http://localhost:3000", "shell")).status).toBe(404);
  });
  it("rejects invalid JSON and oversized speech without locking future requests", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await request("{")).status).toBe(400);
    expect((await request(JSON.stringify({ text: "x".repeat(2001) }))).status).toBe(400);
    expect((await request(JSON.stringify({ text: "Hello", path: "/tmp/anything" }))).status).toBe(400);
  });
  it("rejects oversized audio and unsupported types", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await request(new Uint8Array(MAX_RECORDING_BYTES + 1), "audio/webm", "http://localhost:3000", "transcribe")).status).toBe(413);
    expect((await request("not audio", "text/plain", "http://localhost:3000", "transcribe")).status).toBe(400);
  });
});
