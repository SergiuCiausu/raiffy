import { describe, expect, it } from "vitest";
import { rounded, trace } from "./trace";

function sink() {
  const lines: string[] = [];
  return { lines, log: (...a: unknown[]) => lines.push(a.join(" ")), error: (...a: unknown[]) => lines.push(a.join(" ")) };
}

describe("message trace", () => {
  it("stays silent unless RAIFFY_TRACE is on", async () => {
    const s = sink();
    const t = trace("message123", {}, s);
    t.step("run.start", { a: 1 });
    expect(await t.time("x", async () => 5)).toBe(5);
    expect(s.lines).toEqual([]);
    expect(t.on).toBe(false);
  });

  it("tags each line with the message and drops customer text unless RAIFFY_TRACE_TEXT is on", () => {
    const s = sink();
    const t = trace("abcdefgh12345678", { RAIFFY_TRACE: "true" }, s);
    t.step("jev.done", { status: "classified", question: t.text("Can I afford 2,000 lei?") });
    expect(s.lines).toEqual(['[raiffy abcdefgh12345678] jev.done {"status":"classified"}']);

    const v = sink();
    trace("abcdefgh12345678", { RAIFFY_TRACE: "true", RAIFFY_TRACE_TEXT: "true" }, v).step("q", { question: "hello" });
    expect(v.lines[0]).toContain('"question":"hello"');
  });

  it("times steps and logs failures before rethrowing", async () => {
    const s = sink();
    const t = trace("m", { RAIFFY_TRACE: "true" }, s);
    await t.time("rag.embed", async () => [1, 2], r => ({ n: r.length }));
    await expect(t.time("rag.vector", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(s.lines[0]).toMatch(/rag\.embed \{"ms":\d+,"n":2\}/);
    expect(s.lines[1]).toMatch(/rag\.vector FAILED .*"message":"boom"/);
  });

  it("rounds probability maps", () => {
    expect(rounded({ a: 0.123456, b: null, c: 1 })).toEqual({ a: 0.123, c: 1 });
  });
});
