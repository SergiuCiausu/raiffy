import { buildJevRequest, buildJevSlotRequest, classifierInputSchema, validateJevSlotResponse, type ClassifierInput } from "../lib/agent/jev";
import { JEV_MAX_RESPONSE_BYTES, JEV_TIMEOUT_MS, jevTransportResultSchema, validateJevTransportResponse, type JevTransportResult } from "../lib/agent/jev-transport";

type Options = { enabled: boolean; apiKey?: string; fetcher?: typeof fetch };
type Unavailable = Extract<JevTransportResult, { status: "unavailable" }>;
const unavailable = (reason: "disabled" | "missing_api_key" | "timeout" | "provider_error" | "invalid_response") =>
  jevTransportResultSchema.parse({ status: "unavailable", reason }) as Unavailable;

/** Posts one request within the deadline and size cap. Never logs input, headers or provider bodies. */
async function postJev(body: unknown, options: Options): Promise<{ status: "ok"; body: unknown } | Unavailable> {
  if (!options.enabled) return unavailable("disabled");
  if (!options.apiKey?.trim()) return unavailable("missing_api_key");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async (): Promise<{ status: "ok"; body: unknown } | Unavailable> => {
      const response = await (options.fetcher ?? fetch)("https://api.typesafe.ai/v1/systemone", {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${options.apiKey!.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      try { return { status: "ok", body: JSON.parse(new TextDecoder().decode(bytes)) }; } catch { return unavailable("invalid_response"); }
    };
    const timeout = new Promise<Unavailable>((resolve) => {
      timer = setTimeout(() => { resolve(unavailable("timeout")); controller.abort(); }, JEV_TIMEOUT_MS);
    });
    // The deadline includes reading the body and still resolves if a custom transport ignores abort.
    return await Promise.race([work(), timeout]);
  } catch { return unavailable("provider_error"); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}

/** Called only from a Convex action with stored, screened input. */
export async function requestJev(input: ClassifierInput, options: Options): Promise<JevTransportResult> {
  const parsed = classifierInputSchema.safeParse(input);
  if (!parsed.success) return options.enabled && options.apiKey?.trim() ? unavailable("invalid_response") : unavailable(options.enabled ? "missing_api_key" : "disabled");
  const result = await postJev(buildJevRequest(parsed.data), options);
  return result.status === "ok" ? validateJevTransportResponse(result.body) : result;
}

/** Asks Jev which option fits each open input choice. Returns null when Jev is unavailable or the response is invalid. */
export async function requestJevSlots(input: ClassifierInput, slots: { key: string; options: Record<string, string> }[], options: Options) {
  const parsed = classifierInputSchema.safeParse(input);
  if (!parsed.success || !slots.length) return null;
  const result = await postJev(buildJevSlotRequest(parsed.data, slots), options);
  return result.status === "ok" ? validateJevSlotResponse(result.body, slots) : null;
}
