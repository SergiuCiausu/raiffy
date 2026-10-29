/**
 * Routing evals for Jev and the route policy (scoring: lib/agent/routing-eval.ts).
 *
 *   pnpm agent:eval-routing --live            classify every case with Jev and save the raw responses to evals/results/
 *   pnpm agent:eval-routing --replay <file>   re-score saved responses with the current thresholds, no Jev calls
 *
 * --live needs TYPESAFE_API_KEY in the environment and makes one Jev request per case.
 * Targets: at least 95% of routed messages reach the right pattern, at most 10% of messages get a clarifying question.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { requestJev } from "../convex/jevTransport";
import { routingCaseSchema, scoreRouting, type RoutingCase } from "../lib/agent/routing-eval";

const { values } = parseArgs({ options: { live: { type: "boolean" }, replay: { type: "string" }, cases: { type: "string", default: "evals/agent-routing.json" } } });
const cases = z.array(routingCaseSchema).parse(JSON.parse(readFileSync(values.cases!, "utf8")));
const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(1)}%` : "n/a";

let pairs: { case: RoutingCase; response: unknown }[];
if (values.replay) {
  const saved = z.array(z.object({ message: z.string(), response: z.unknown() })).parse(JSON.parse(readFileSync(values.replay, "utf8")));
  const byMessage = new Map(saved.map(r => [r.message, r.response]));
  pairs = cases.filter(c => byMessage.has(c.message)).map(c => ({ case: c, response: byMessage.get(c.message) }));
} else if (values.live) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");
  pairs = [];
  for (const c of cases) {
    const result = await requestJev({ message: c.message, recentContext: c.recentContext ?? "" }, { enabled: true, apiKey });
    pairs.push({ case: c, response: result.status === "classified" ? result.classification : { unavailable: result.reason } });
  }
  mkdirSync("evals/results", { recursive: true });
  // Messages are synthetic eval text; no customer data is written here.
  const file = `evals/results/routing-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify(pairs.map(p => ({ message: p.case.message, response: p.response })), null, 1));
  console.log(`Saved ${pairs.length} responses to ${file}`);
} else {
  console.log("Pass --live or --replay <file>."); process.exit(1);
}

const s = scoreRouting(pairs);
console.log(`Pattern cases ${s.cases} · routed ${s.routed} (${pct(s.routed, s.cases)}) · clarified ${s.clarified} (${pct(s.clarified, s.cases)})`);
console.log(`Right pattern when routed ${pct(s.correct, s.routed)} · wrong pattern sent to the model ${s.wrongRouted}`);
console.log(`Jev top-1 ${pct(s.top1, s.cases)} · family ${pct(s.family, s.cases)} · risks caught ${s.riskCaught}/${s.riskCases}`);
console.table(s.calibration);
if (s.misses.length) console.table(s.misses);
