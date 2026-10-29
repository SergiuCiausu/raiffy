import { describe, expect, it } from "vitest";
import { isLocalVoiceRequest, speechInput, transcriptOutput } from "./voice";

describe("local voice boundary", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("accepts same-origin development on %s", (hostname) => {
    const origin = `http://${hostname}:3000`;
    expect(isLocalVoiceRequest(`${origin}/api/voice/speak`, origin, "development")).toBe(true);
  });
  it.each([
    ["http://localhost:3000/api/voice/speak", "http://localhost:3000", "production"],
    ["http://localhost:3000/api/voice/speak", "http://localhost:3000", "test"],
    ["http://localhost:3000/api/voice/speak", null, "development"],
    ["http://localhost:3000/api/voice/speak", "https://another-site.test", "development"],
    ["http://localhost:3000/api/voice/speak", "http://localhost:4000", "development"],
    ["https://raiffy.test/api/voice/speak", "https://raiffy.test", "development"],
    ["http://192.168.1.5:3000/api/voice/speak", "http://192.168.1.5:3000", "development"],
    ["invalid", "invalid", "development"],
  ])("rejects public, cross-origin and non-dev requests", (url, origin, environment) => {
    expect(isLocalVoiceRequest(url!, origin, environment!)).toBe(false);
  });
  it("bounds model text and rejects arbitrary worker arguments", () => {
    expect(speechInput.safeParse({ text: " ", path: "/tmp/secret" }).success).toBe(false);
    expect(speechInput.safeParse({ text: "x".repeat(2001) }).success).toBe(false);
    expect(speechInput.parse({ text: " Hello. " })).toEqual({ text: "Hello." });
    expect(transcriptOutput.safeParse({ text: "" }).success).toBe(false);
  });
});
