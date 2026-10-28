import type { Bank, PublicCollection, RawChunk, ScopeFlags, Segment, Track } from "./schemas";
import { PUBLIC_COLLECTIONS, scopeField, TRACKS } from "./schemas";

/** Which data segments each track may read. Corporate is out of scope for both. */
export const TRACK_SEGMENTS: Record<Track, readonly Segment[]> = {
  personal: ["persoane fizice", "premium banking", "private banking"],
  business: ["IMM", "micro", "business", "business (micro, IMM, corporate)"],
};

export type Visibility = Record<Track, boolean>;

const productKey = (bank: Bank, product: string) => `${bank}|${product}`;

/** (bank, product name) -> segments it appears in, built from the product-page chunks. */
export function buildProductSegments(chunks: readonly RawChunk[]): Map<string, Set<Segment>> {
  const index = new Map<string, Set<Segment>>();
  for (const { metadata } of chunks) {
    if (metadata.source_type !== "product_page" || !metadata.product || !metadata.segment) continue;
    const key = productKey(metadata.bank, metadata.product);
    const segments = index.get(key) ?? new Set<Segment>();
    segments.add(metadata.segment);
    index.set(key, segments);
  }
  return index;
}

function visibilityOf(segments: Iterable<Segment>): Visibility {
  const list = [...segments];
  return {
    personal: list.some((s) => TRACK_SEGMENTS.personal.includes(s)),
    business: list.some((s) => TRACK_SEGMENTS.business.includes(s)),
  };
}

/**
 * Product pages follow their own segment. PDFs carry no segment, so they follow the products of the same bank that
 * link to them; a PDF whose linked products are unknown stays hidden rather than leaking across tracks.
 */
export function deriveVisibility(
  metadata: RawChunk["metadata"],
  productSegments: ReadonlyMap<string, ReadonlySet<Segment>>,
): Visibility {
  if (metadata.source_type === "product_page") return visibilityOf(metadata.segment ? [metadata.segment] : []);
  const segments: Segment[] = [];
  for (const name of metadata.linked_products ?? []) {
    segments.push(...(productSegments.get(productKey(metadata.bank, name)) ?? []));
  }
  return visibilityOf(segments);
}

/** Raiffeisen content is the bank's own; ING and BCR are competitors; Raiffeisen FAQs are also banking help. */
export function collectionsOf(metadata: RawChunk["metadata"]): PublicCollection[] {
  if (metadata.status === "withdrawn") return [];
  if (metadata.bank !== "raiffeisen") return ["competitor_docs"];
  return metadata.section_type === "faq" ? ["bank_product_docs", "banking_help"] : ["bank_product_docs"];
}

/** Every (track, collection) a chunk belongs to, as the boolean filter fields stored in Convex. */
export function deriveScopeFlags(
  metadata: RawChunk["metadata"],
  productSegments: ReadonlyMap<string, ReadonlySet<Segment>>,
): ScopeFlags {
  const visibility = deriveVisibility(metadata, productSegments);
  const collections = collectionsOf(metadata);
  const flags = {} as ScopeFlags;
  for (const track of TRACKS) {
    for (const collection of PUBLIC_COLLECTIONS) {
      flags[scopeField(track, collection)] = visibility[track] && collections.includes(collection);
    }
  }
  return flags;
}
