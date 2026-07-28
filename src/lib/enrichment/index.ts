// Public entry point for the Offer Enrichment layer.

export { ENRICHMENT_KEY, readEnrichment } from "./types";
export type { EnrichmentStats, OfferEnrichment, StructuredTerms } from "./types";
export type { OfferEnricher, OfferEnrichmentCapable } from "./OfferEnricher";
export { supportsOfferEnrichment } from "./OfferEnricher";
export { ImpactOfferEnricher } from "./impact/ImpactOfferEnricher";
export type { ImpactEnrichmentSources } from "./impact/ImpactOfferEnricher";
