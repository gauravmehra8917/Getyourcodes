// Offer Enricher contract. An adapter may expose an enricher; the Sync Engine
// applies it to raw offer pages before handing them to the normalizer.

import type { EnrichmentStats } from "./types.ts";

export interface OfferEnricher {
  readonly provider: string;
  /** Returns the same records, each optionally carrying an enrichment payload. */
  enrichOffers(records: unknown[]): Promise<unknown[]>;
  stats(): EnrichmentStats;
}

export interface OfferEnrichmentCapable {
  createOfferEnricher(): OfferEnricher | null;
}

export function supportsOfferEnrichment(x: unknown): x is OfferEnrichmentCapable {
  return typeof (x as OfferEnrichmentCapable)?.createOfferEnricher === "function";
}
