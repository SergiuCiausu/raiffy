import { describe, expect, it } from "vitest";
import { itemKey, listTitle, parseAnswer, segmentCites, splitItem, withoutShown, type Block, type List, type Run } from "./markup";

/** Runs as compact strings: <b>bold</b>, <i>italic</i>, plain */
const show = (runs: Run[]) => runs.map((r) => {
  const t = r.italic ? `<i>${r.text}</i>` : r.text;
  return r.bold ? `<b>${t}</b>` : t;
}).join("");
const para = (b: Block | undefined) => { expect(b?.kind).toBe("p"); return (b as Extract<Block, { kind: "p" }>).lines.map(show); };
const list = (b: Block | undefined) => { expect(b?.kind).toBe("list"); return b as List; };

describe("inline styles", () => {
  it("renders bold and italic in both spellings, and nested", () => {
    expect(para(parseAnswer("A **bold** and __strong__ word").blocks[0])).toEqual(["A <b>bold</b> and <b>strong</b> word"]);
    expect(para(parseAnswer("An *italic* and _emphasised_ word").blocks[0])).toEqual(["An <i>italic</i> and <i>emphasised</i> word"]);
    expect(para(parseAnswer("**all *of* it**").blocks[0])).toEqual(["<b>all </b><b><i>of</i></b><b> it</b>"]);
  });

  it("leaves markers that don't open or close a span as text", () => {
    for (const s of ["2*3*4 = 24", "snake_case_name", "an ** orphan", "**unclosed", "a * b", "5 * 6 * 7"]) {
      expect(parseAnswer(s).plain).toBe(s);
    }
  });

  it("honours backslash escapes", () => {
    expect(parseAnswer("\\*not italic\\*").plain).toBe("*not italic*");
  });

  it("drops strikethrough markers and link targets, never rendering a model URL", () => {
    expect(parseAnswer("~~old~~ new").plain).toBe("old new");
    const runs = (parseAnswer("See [the page](https://evil.example/x) now").blocks[0] as Extract<Block, { kind: "p" }>).lines[0]!;
    expect(runs.map((r) => r.text).join("")).toBe("See the page now");
    expect(JSON.stringify(runs)).not.toContain("evil.example");
  });

  it("keeps HTML as literal text", () => {
    expect(parseAnswer("<img src=x onerror=alert(1)> <u>under</u>").plain).toBe("<img src=x onerror=alert(1)> <u>under</u>");
  });
});

describe("blocks", () => {
  it("splits paragraphs on blank lines and keeps single line breaks inside one", () => {
    const { blocks } = parseAnswer("First line\nsecond line\n\nNext paragraph");
    expect(para(blocks[0])).toEqual(["First line", "second line"]);
    expect(para(blocks[1])).toEqual(["Next paragraph"]);
  });

  it("builds bullet and numbered lists, with wrapped lines and one nested level", () => {
    const { blocks } = parseAnswer("Conditions:\n- **Tax:** withheld\n  at maturity\n- Renewal\n  - same term\n\n3. Step three\n4) Step four");
    expect(para(blocks[0])).toEqual(["Conditions:"]);
    const bullets = list(blocks[1]);
    expect(bullets.ordered).toBe(false);
    expect(bullets.items.map((i) => i.lines.map(show))).toEqual([["<b>Tax:</b> withheld", "at maturity"], ["Renewal"]]);
    expect(bullets.items[1]!.sub!.items.map((i) => i.lines.map(show))).toEqual([["same term"]]);
    const steps = list(blocks[2]);
    expect([steps.ordered, steps.start, steps.items.length]).toEqual([true, 3, 2]);
  });

  it("keeps one list across blank lines between items", () => {
    const { blocks } = parseAnswer("- one\n\n- two");
    expect(blocks).toHaveLength(1);
    expect(list(blocks[0]).items).toHaveLength(2);
  });

  it("does not read bold or italic at the start of a line as a bullet", () => {
    expect(para(parseAnswer("**Tax:** none").blocks[0])).toEqual(["<b>Tax:</b> none"]);
    expect(para(parseAnswer("*Note* this").blocks[0])).toEqual(["<i>Note</i> this"]);
  });

  it("turns headings into bold lines", () => {
    const { blocks } = parseAnswer("## What to check\nThe rate");
    expect(para(blocks[0])).toEqual(["<b>What to check</b>"]);
    expect(para(blocks[1])).toEqual(["The rate"]);
  });
});

describe("visible text and citations", () => {
  it("indexes only visible characters, so the reveal never shows a marker", () => {
    const parsed = parseAnswer("- **Tax:** paid\n- Renewal");
    expect(parsed.plain).toBe("Tax: paid\nRenewal");
    expect(parsed.plain).not.toContain("*");
  });

  it("places each citation at its segment's end, even across markers and bold spans", () => {
    const segments = [
      { text: "- **Minimum:** 500 lei.", sourceIds: ["s1"] },
      { text: " **Top-ups** any time.\n- **Tax", sourceIds: ["s2"] },
      { text: ":** withheld.", sourceIds: ["s1"] },
    ];
    const text = segments.map((s) => s.text).join("");
    const parsed = parseAnswer(text, segmentCites(segments));
    const placed = (parsed.blocks[0] as List).items.flatMap((i) => i.lines.flat()).flatMap((r) => r.cites.map((c) => `${r.text.slice(0, c.pos)}|${c.ids}`));
    // s1 after "500 lei.", s2 inside the bold "Tax:" where its segment stops, s1 again at the very end
    expect(placed).toEqual([" 500 lei.|s1", "Tax|s2", " withheld.|s1"]);
  });

  it("ignores segments without sources", () => {
    const parsed = parseAnswer("Hello.", [{ at: 6, ids: [] }]);
    expect((parsed.blocks[0] as Extract<Block, { kind: "p" }>).lines[0]![0]!.cites).toEqual([]);
  });
});

describe("list cards", () => {
  const blocksOf = (s: string) => parseAnswer(s).blocks;

  it("takes a short label ending in a colon as the card title", () => {
    const blocks = blocksOf("Conditions to check:\n- **Tax:** withheld\n- **Renewal:** automatic");
    expect(listTitle(blocks[0])).toMatchObject({ title: "Conditions to check" });
  });

  it("keeps sentences, cited lines and long lines in the body", () => {
    expect(listTitle(blocksOf("A term deposit locks money away.")[0])).toBeNull();
    expect(listTitle(parseAnswer("Check these:", [{ at: 12, ids: ["s1"] }]).blocks[0])).toBeNull();
    expect(listTitle(blocksOf(`${"x".repeat(70)}:`)[0])).toBeNull();
    expect(listTitle(blocksOf("- one\n- two")[0])).toBeNull();
  });

  it("splits a bold lead into the label and the rest into the description", () => {
    const item = (list(blocksOf("- **Minimum and top-ups:** 500 lei to open.\n  Top-ups any time.\n- **Tax**\n- plain item")[0]).items);
    const a = splitItem(item[0]!.lines);
    expect(a.label!.map((r) => r.text).join("")).toBe("Minimum and top-ups");
    expect(a.body.map(show)).toEqual([" 500 lei to open.", "Top-ups any time."]);
    expect(splitItem(item[1]!.lines)).toMatchObject({ label: null });
    expect(splitItem(item[2]!.lines).label).toBeNull();
  });

  it("does not change the parsed runs it copies from", () => {
    const parsed = parseAnswer("- **Tax:** withheld");
    const lines = list(parsed.blocks[0]).items[0]!.lines;
    splitItem(lines);
    expect(lines[0]![0]!.text).toBe("Tax:");
  });
});

describe("items an answer card already shows", () => {
  it("drops matched items, keeps the rest, and drops an emptied list with its title line", () => {
    const { blocks } = parseAnswer("The card has two fees:\n- **Administration:** 2.5 lei\n- **ATM:** 5 lei\n- **Contactless:** free\n\nDocuments:\n- ID card\n- Payslip\n\nAnything else?");
    const out = withoutShown(blocks, ["Administration", "atm", "ID card", "Payslip"]);
    expect(out.map((b) => b.kind)).toEqual(["p", "list", "p"]);
    expect(list(out[1]).items.map((it) => itemKey(it.lines))).toEqual(["contactless"]);
  });

  it("leaves the answer alone when no card names match", () => {
    const { blocks } = parseAnswer("- **Tax:** withheld\n- **Renewal:** automatic");
    expect(withoutShown(blocks, ["Interest"])).toEqual(blocks);
    expect(withoutShown(blocks, [])).toBe(blocks);
  });
});
