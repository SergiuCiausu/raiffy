import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AGENT_POLICY } from "../lib/agent/config";
import { buildJevRequest } from "../lib/agent/jev";
import { MEMORY_POLICY } from "../lib/agent/memory";
import { AGENT_TOOLS, RAIFFY_SYSTEM } from "../lib/agent/prompt";

const root = fileURLToPath(new URL("../agents/", import.meta.url));
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
// Flow-style JSON is valid YAML, so schemas need no additional YAML dependency.
const yaml = [
  "# Draft tool contracts: creating an agent does not implement the backend handlers.",
  "# Jev runs in the application before starting a Claude turn; see jev.request.example.json.",
  "name: Raiffy financial assistant",
  "description: Explains banking products, compares verified offers and personalizes guidance using scoped customer context.",
  "model:",
  `  id: ${AGENT_POLICY.standardModel.id}`,
  `  effort: ${AGENT_POLICY.standardModel.effort}`,
  "system: |-",
  ...RAIFFY_SYSTEM.split("\n").map((line) => line ? `  ${line}` : ""),
  "mcp_servers: []",
  "tools:",
  ...AGENT_TOOLS.map((definition) => `  - ${JSON.stringify(definition, null, 2).replaceAll("\n", "\n    ")}`),
  "metadata:",
  "  template: raiffy-assistant",
  `  policy_version: ${AGENT_POLICY.version}`,
  "",
].join("\n");

const files: Record<string, string> = {
  "raiffy.agent.yaml": yaml,
  "model-policy.json": json(AGENT_POLICY),
  "memory-policy.json": json(MEMORY_POLICY),
  "jev.request.example.json": json(buildJevRequest({
    message: "A competitor offered me a cheaper personal loan. Can Raiffeisen improve my offer?",
    recentContext: "The customer is comparing personal loans. No verified competitor terms have been supplied.",
  })),
};
const check = process.argv.includes("--check");
if (!check) await mkdir(root, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  const path = `${root}/${name}`;
  if (check) {
    if (await readFile(path, "utf8") !== content) throw new Error(`${name} is out of date; run pnpm agent:build-setup`);
  } else await writeFile(path, content);
}
console.log(check ? "Agent setup matches its TypeScript sources." : "Built agent setup under agents/ (no remote resources created).");
