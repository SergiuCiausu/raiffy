import type { RawChunk, Segment, Track } from "./schemas";

/** Which data segments each track may read. Corporate is out of scope for both. */
export const TRACK_SEGMENTS: Record<Track, readonly Segment[]> = {
  personal: ["persoane fizice", "premium banking", "private banking"],
  business: ["IMM"],
};

export type Visibility = { visiblePersonal: boolean; visibleBusiness: boolean };

/** Product name -> segments it appears in, built from the product-page chunks. */
export function buildProductSegments(chunks: readonly RawChunk[]): Map<string, Set<Segment>> {
  const index = new Map<string, Set<Segment>>();
  for (const { metadata } of chunks) {
    if (metadata.source_type !== "product_page" || !metadata.product || !metadata.segment) continue;
    const segments = index.get(metadata.product) ?? new Set<Segment>();
    segments.add(metadata.segment);
    index.set(metadata.product, segments);
  }
  return index;
}

function visibilityOf(segments: Iterable<Segment>): Visibility {
  const list = [...segments];
  return {
    visiblePersonal: list.some((s) => TRACK_SEGMENTS.personal.includes(s)),
    visibleBusiness: list.some((s) => TRACK_SEGMENTS.business.includes(s)),
  };
}

/**
 * Product pages follow their own segment. PDFs carry no segment, so they follow the products that link to
 * them; a PDF whose linked products are unknown stays hidden rather than leaking across tracks.
 */
export function deriveVisibility(
  metadata: RawChunk["metadata"],
  productSegments: ReadonlyMap<string, ReadonlySet<Segment>>,
): Visibility {
  if (metadata.source_type === "product_page") {
    return visibilityOf(metadata.segment ? [metadata.segment] : []);
  }
  const segments: Segment[] = [];
  for (const name of metadata.linked_products ?? []) {
    segments.push(...(productSegments.get(name) ?? []));
  }
  return visibilityOf(segments);
}

/** The boolean index field that scopes a search to a track. */
export function visibilityField(track: Track): keyof Visibility {
  return track === "personal" ? "visiblePersonal" : "visibleBusiness";
}
