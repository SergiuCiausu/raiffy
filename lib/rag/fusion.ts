/** One candidate list from a retriever, best first. */
export type Ranking = readonly string[];

export type FusionOptions = {
  /** Reciprocal-rank constant; 60 is the usual default. */
  k?: number;
  denseWeight?: number;
  lexicalWeight?: number;
  /** Extra score for a candidate the query plan prefers (e.g. a fee table for a cost question). */
  boost?: (id: string) => number;
};

export type FusedCandidate = {
  id: string;
  score: number;
  denseRank?: number;
  lexicalRank?: number;
};

/**
 * Reciprocal rank fusion of a dense (vector) and a lexical (keyword) ranking.
 * Ties keep the dense order first, then the lexical order, so the result is deterministic.
 */
export function fuseRankings(dense: Ranking, lexical: Ranking, options: FusionOptions = {}): FusedCandidate[] {
  const { k = 60, denseWeight = 1, lexicalWeight = 1, boost } = options;
  const byId = new Map<string, FusedCandidate & { order: number }>();
  const add = (ranking: Ranking, weight: number, field: "denseRank" | "lexicalRank") => {
    ranking.forEach((id, index) => {
      const rank = index + 1;
      const entry = byId.get(id) ?? { id, score: 0, order: byId.size };
      if (entry[field] !== undefined) return;
      entry[field] = rank;
      entry.score += weight / (k + rank);
      byId.set(id, entry);
    });
  };
  add(dense, denseWeight, "denseRank");
  add(lexical, lexicalWeight, "lexicalRank");
  const fused = [...byId.values()].map((entry) => ({ ...entry, score: entry.score + (boost?.(entry.id) ?? 0) }));
  fused.sort((a, b) => b.score - a.score || a.order - b.order);
  return fused.map(({ order: _order, ...candidate }) => candidate);
}
