/*
 * Step-by-step logs for one customer message on its way through the backend: privacy screen, Jev, routing, inputs,
 * the answer model, search_knowledge and the RAG database, checks and save. They appear in `convex dev`, `convex logs`
 * and the dashboard, never in the browser.
 *
 * Off unless the deployment sets RAIFFY_TRACE=true (dev only). Lines carry ids, labels, counts, scores and timings.
 * Customer text (the screened question, search queries) is added only with RAIFFY_TRACE_TEXT=true as well.
 */

export type TraceDetail = Record<string, unknown>;
type Env = Record<string, string | undefined>;
type Sink = Pick<Console, "log" | "error">;

export type Trace = {
  readonly on: boolean;
  step(name: string, detail?: TraceDetail): void;
  /** Runs `fn`, then logs the step with its duration and `describe(result)`, or the error it threw (and rethrows). */
  time<T>(name: string, fn: () => Promise<T>, describe?: (result: T) => TraceDetail): Promise<T>;
  fail(name: string, error: unknown, detail?: TraceDetail): void;
  /** Customer text, only when RAIFFY_TRACE_TEXT is on; undefined otherwise, and undefined fields are dropped. */
  text(value: string): string | undefined;
};

const clean = (detail: TraceDetail) => Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== undefined));
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Rounds every number in a probability or score map, for short log lines. */
export function rounded(map: Record<string, number | null | undefined>): Record<string, number> {
  return Object.fromEntries(Object.entries(map).filter((e): e is [string, number] => typeof e[1] === "number").map(([k, v]) => [k, round(v)]));
}

export function errorDetail(error: unknown): TraceDetail {
  return error instanceof Error ? { error: error.name, message: error.message } : { error: String(error) };
}

export const NO_TRACE: Trace = {
  on: false,
  step() {},
  time: (_name, fn) => fn(),
  fail() {},
  text: () => undefined,
};

export function trace(id: string, env: Env = process.env, sink: Sink = console): Trace {
  if (env.RAIFFY_TRACE !== "true") return NO_TRACE;
  const withText = env.RAIFFY_TRACE_TEXT === "true";
  const tag = `[raiffy ${id}]`;
  const t: Trace = {
    on: true,
    step: (name, detail = {}) => sink.log(`${tag} ${name}`, JSON.stringify(clean(detail))),
    fail: (name, error, detail = {}) => sink.error(`${tag} ${name} FAILED`, JSON.stringify(clean({ ...detail, ...errorDetail(error) }))),
    text: (value) => (withText ? value : undefined),
    async time(name, fn, describe) {
      const started = Date.now();
      try {
        const result = await fn();
        t.step(name, { ms: Date.now() - started, ...(describe ? describe(result) : {}) });
        return result;
      } catch (error) {
        t.fail(name, error, { ms: Date.now() - started });
        throw error;
      }
    },
  };
  return t;
}
