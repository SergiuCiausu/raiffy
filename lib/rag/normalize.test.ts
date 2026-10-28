import { describe, expect, it } from "vitest";
import { foldDiacritics, MAX_SEARCH_TERMS, queryTerms, tokenize, toSearchText } from "./normalize";

describe("foldDiacritics", () => {
  it("strips Romanian diacritics in both the comma-below and cedilla forms", () => {
    expect(foldDiacritics("Dobândă și ȚARĂ, Îți, ştim, ţară")).toBe("dobanda si tara, iti, stim, tara");
  });
});

describe("toSearchText", () => {
  it("folds and collapses whitespace", () => {
    expect(toSearchText("  Depozite la termen\n în LEI \t ")).toBe("depozite la termen in lei");
  });
});

describe("tokenize", () => {
  it("keeps words and numbers, drops punctuation", () => {
    expect(tokenize("DAE 32,40% (card)")).toEqual(["dae", "32", "40", "card"]);
  });
});

describe("queryTerms", () => {
  it("drops Romanian and English stopwords and duplicates", () => {
    expect(queryTerms("Ce dobândă are depozitul la termen pe 3 luni în lei?")).toEqual([
      "dobanda", "depozitul", "termen", "3", "luni", "lei",
    ]);
    expect(queryTerms("What is the APR of the APR card?")).toEqual(["apr", "card"]);
  });

  it("caps the number of terms", () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    expect(queryTerms(long)).toHaveLength(MAX_SEARCH_TERMS);
    expect(queryTerms(long, 3)).toEqual(["word0", "word1", "word2"]);
  });
});
