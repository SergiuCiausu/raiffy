/**
 * Live evals for solution answers (evals/advice-answers.json, `live` cases).
 *
 *   pnpm advice:eval --live     run each case through runAgent with the real model and save the answers to evals/results/
 *
 * The compare_routes result is the renovation fixture (lib/advice/fixtures.ts) for the case's timing, so the model
 * sees what the live tool would return; search returns nothing. Each answer is scored by the agent's own number
 * check (status "answered"), whether it called compare_routes, and checkAdviceAnswer (no other route recommended, no
 * eligibility or offer claim, no recommendation while the rule is waiting for an input).
 * --live needs ANTHROPIC_API_KEY in the environment and makes a few model calls per case.
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { COMPARE_ROUTES_TOOL } from "../convex/advice";
import { checkAdviceAnswer } from "../lib/advice/check";
import { renovationComparison } from "../lib/advice/fixtures";
import { AGENT_POLICY } from "../lib/agent/config";
import { runAgent } from "../lib/rag/agent";
import { buildKnowledgeResult, isPublicCollection, unavailableResult } from "../lib/rag/knowledge";

const { values } = parseArgs({ options: { live: { type: "boolean" }, cases: { type: "string", default: "evals/advice-answers.json" } } });
const liveCase = z.object({ id: z.string(), question: z.string(), needByMonths: z.number().nullable(), expectPick: z.string().nullable() });
const cases = z.object({ live: z.array(liveCase) }).parse(JSON.parse(readFileSync(values.cases!, "utf8"))).live;

if (!values.live) {
  console.log(`${cases.length} live cases. Run with --live (needs ANTHROPIC_API_KEY) to call the model.`);
  process.exit(0);
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
const model = AGENT_POLICY.complexModel;
const GUIDE = "For a goal the customer wants to reach (a renovation, a purchase), call compare_routes once with the loan's term IDs and the customer's timing: it shows the routes card with Raiffy's recommendation itself. Don't make a routes card, don't recommend a different route, and if it asks for an input, ask the customer for it in one short question. The catalog has raiffeisen:personal-loan (Flexicredit) with term IDs raiffeisen:personal-loan#rate, #analysis-fee and #term. Quote figures exactly as written and cite them. Never say whether the customer is eligible.";

const rows = [];
let passed = 0;
for (const c of cases) {
  const fixture = renovationComparison(c.needByMonths);
  let called = 0;
  const answer = await runAgent({
    question: c.question, track: "personal", model: model.id, customerFigures: [c.question],
    hostTools: [{ tool: COMPARE_ROUTES_TOOL, run: async () => { called += 1; return { citables: [fixture.citable] }; } }],
  }, {
    createMessage: ({ system, tools, messages }) => client.beta.messages.create({ model: model.id, max_tokens: 4000, output_config: { effort: model.effort },
      system: [...system, { type: "text", text: GUIDE }], tools, messages }),
    search: async ({ collection, query, limit }) => isPublicCollection(collection)
      ? buildKnowledgeResult({ collection, query, limit, hits: [], now: Date.now() })
      : unavailableResult(collection, "collection_not_connected", limit),
  });
  const issues = checkAdviceAnswer(answer.text, fixture.routes.routes, fixture.recommendation);
  const pickOk = fixture.recommendation.pick === (c.expectPick ?? undefined);
  const ok = answer.status === "answered" && called === 1 && issues.length === 0 && pickOk;
  if (ok) passed += 1;
  rows.push({ id: c.id, ok, status: answer.status, calledCompareRoutes: called, issues, text: answer.text });
  console.log(`${ok ? "PASS" : "FAIL"} ${c.id}  status=${answer.status} calls=${called} issues=${issues.join(",") || "none"}`);
}
mkdirSync("evals/results", { recursive: true });
const file = `evals/results/advice-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ model: model.id, policy: AGENT_POLICY.version, rows }, null, 2));
console.log(`${passed}/${cases.length} passed. Answers saved to ${file}`);
process.exit(passed === cases.length ? 0 : 1);
