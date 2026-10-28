import { fuseRankings } from "./fusion";
import type { QueryPlan } from "./query";
import type { RagChunkDoc, SearchHit } from "./schemas";

export type StoredChunk = Omit<RagChunkDoc, "embedding" | "searchText"> & { _id: string };

export type RankOptions = {
  k: number;
  /** Score added to a candidate whose section the query plan prefers. Small: it reorders near-ties only. */
  sectionBoost?: number;
};

/**
 * Fuse the vector and keyword rankings (ids, best first) and return the top `k` hits.
 * `docs` must contain every id in either ranking.
 */
export function rankHits(
  denseIds: readonly string[],
  lexicalIds: readonly string[],
  docs: ReadonlyMap<string, StoredChunk>,
  plan: QueryPlan,
  { k, sectionBoost = 0.004 }: RankOptions,
): SearchHit[] {
  const boost = (id: string) => {
    const doc = docs.get(id);
    if (!doc) return 0;
    const sectionMatch = plan.preferredSections.includes(doc.sectionType);
    const docMatch = plan.preferredDocType !== undefined && doc.docType === plan.preferredDocType;
    return (sectionMatch ? sectionBoost : 0) + (docMatch ? sectionBoost : 0);
  };
  return fuseRankings(denseIds, lexicalIds, { boost })
    .filter((candidate) => docs.has(candidate.id))
    .slice(0, k)
    .map((candidate) => {
      const { _id, ...doc } = docs.get(candidate.id)!;
      return {
        ...doc,
        score: candidate.score,
        ...(candidate.denseRank ? { denseRank: candidate.denseRank } : {}),
        ...(candidate.lexicalRank ? { lexicalRank: candidate.lexicalRank } : {}),
      };
    });
}
