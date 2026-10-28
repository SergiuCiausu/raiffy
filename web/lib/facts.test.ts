import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { interleave, parseFacts } from "./facts";

const MD = `# Title

## Money basics

| # | Did you know… | Tag |
| --- | --- | --- |
| 1 | …that interest compounds? Small amounts grow. | General |
| 2 | …that a rule applies here | RO |

## Credit

| # | Did you know… | Tag |
| --- | --- | --- |
| 3 | …that DAE includes fees? | General |
`;

describe("parseFacts", () => {
  it("splits topics on ## headings and rows into facts", () => {
    const t = parseFacts(MD);
    expect(t.map((x) => x.name)).toEqual(["Money basics", "Credit"]);
    expect(t[0]!.facts).toHaveLength(2);
    expect(t[1]!.facts[0]).toMatchObject({ id: 3, topic: 1, tag: "GENERAL" });
  });
  it("splits a headline from its supporting sentence at the first '? '", () => {
    const f = parseFacts(MD)[0]!.facts[0]!;
    expect(f.headline).toBe("…that interest compounds?");
    expect(f.support).toBe("Small amounts grow.");
  });
  it("keeps facts without a question as a headline only", () => {
    expect(parseFacts(MD)[0]!.facts[1]).toMatchObject({ headline: "…that a rule applies here", support: "", tag: "RO" });
  });
  it("parses the real content file: 150 facts in 10 topics", () => {
    const md = readFileSync(join(__dirname, "..", "..", "swipe-cards", "raiffy-150-did-you-know-finance-posts.md"), "utf8");
    const t = parseFacts(md);
    expect(t).toHaveLength(10);
    expect(t.flatMap((x) => x.facts)).toHaveLength(150);
  });
});

describe("interleave", () => {
  it("alternates topics so consecutive cards vary", () => {
    expect(interleave(parseFacts(MD)).map((f) => f.id)).toEqual([1, 3, 2]);
  });
});
