import { describe, expect, it } from "vitest";
import { fuseRankings } from "./fusion";

describe("fuseRankings", () => {
  it("rewards candidates both retrievers agree on", () => {
    const fused = fuseRankings(["a", "b", "c"], ["c", "d", "a"]);
    expect(fused.map((c) => c.id)).toEqual(["a", "c", "b", "d"]);
    expect(fused[0]).toMatchObject({ id: "a", denseRank: 1, lexicalRank: 3 });
    expect(fused[3]).toMatchObject({ id: "d", lexicalRank: 2 });
    expect(fused[3]!.denseRank).toBeUndefined();
  });

  it("applies weights and boosts", () => {
    const lexicalHeavy = fuseRankings(["a", "b"], ["b", "a"], { lexicalWeight: 2 });
    expect(lexicalHeavy[0]!.id).toBe("b");
    const boosted = fuseRankings(["a", "b"], [], { boost: (id) => (id === "b" ? 1 : 0) });
    expect(boosted[0]!.id).toBe("b");
  });

  it("breaks ties deterministically, dense order first", () => {
    expect(fuseRankings(["a", "b"], ["b", "a"]).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("ignores repeated ids within one ranking", () => {
    const fused = fuseRankings(["a", "a", "b"], []);
    expect(fused.map((c) => c.id)).toEqual(["a", "b"]);
    expect(fused[0]!.denseRank).toBe(1);
  });
});
