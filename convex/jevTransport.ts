import { buildJevRequest, classifierInputSchema, type ClassifierInput } from "../lib/agent/jev";
import { JEV_MAX_RESPONSE_BYTES, JEV_TIMEOUT_MS, jevTransportResultSchema, validateJevTransportResponse, type JevTransportResult } from "../lib/agent/jev-transport";

/** Called only from a Convex action with stored, screened input. Never logs input, headers or provider bodies. */
export async function requestJev(input: ClassifierInput, options: { enabled: boolean; apiKey?: string; fetcher?: typeof fetch }): Promise<JevTransportResult> {
  const unavailable = (reason: "disabled" | "missing_api_key" | "timeout" | "provider_error" | "invalid_response") => jevTransportResultSchema.parse({ status: "unavailable", reason });
  if (!options.enabled) return unavailable("disabled");
  if (!options.apiKey?.trim()) return unavailable("missing_api_key");
  const parsed = classifierInputSchema.safeParse(input);
  if (!parsed.success) return unavailable("invalid_response");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async (): Promise<JevTransportResult> => {
      const response = await (options.fetcher ?? fetch)("https://api.typesafe.ai/v1/systemone", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${options.apiKey!.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildJevRequest(parsed.data)),
      });
      if (!response.ok) { await response.body?.cancel(); return unavailable("provider_error"); }
      if (!response.body) return unavailable("invalid_response");
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > JEV_MAX_RESPONSE_BYTES) { await reader.cancel(); return unavailable("invalid_response"); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let body: unknown;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return unavailable("invalid_response"); }
      return validateJevTransportResponse(body);
    };
    const timeout = new Promise<JevTransportResult>((resolve) => {
      timer = setTimeout(() => { resolve(unavailable("timeout")); controller.abort(); }, JEV_TIMEOUT_MS);
    });
    // The deadline includes reading the body and still resolves if a custom transport ignores abort.
    return await Promise.race([work(), timeout]);
  } catch { return unavailable("provider_error"); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
