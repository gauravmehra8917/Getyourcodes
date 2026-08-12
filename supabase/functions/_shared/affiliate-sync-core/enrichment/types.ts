// Offer Enrichment layer — provider-independent shapes.
//
// Enrichment never creates entities and never changes identity: it only
// attaches extra, already-available provider data to a raw offer record
// under a reserved key, before normalization runs.

import type { DiscountType } from "../normalizers/types.ts";

/** Reserved key attached to a raw provider record by an enricher. */
export const ENRICHMENT_KEY = "__enrichment" as const;

/** Terms parsed into discrete fields. All optional — never invented. */
export interface StructuredTerms {
  minimumPurchase?: number | null;
  maximumSavings?: number | null;
  purchaseLimit?: number | null;
  scope?: string | null;
  currency?: string | null;
  text?: string | null;
}

/** Additional offer data merged in before normalization. */
export interface OfferEnrichment {
  description?: string | null;
  /** Preferred affiliate tracking url (ad-level beats campaign-level). */
  trackingUrl?: string | null;
  trackingUrlSource?: "ad" | "campaign" | null;
  landingPageUrl?: string | null;
  /** Only used when the promotion itself carries no code. */
  code?: string | null;
  discountType?: DiscountType | null;
  discountValue?: number | null;
  currency?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  terms?: StructuredTerms | null;
  shippingRegions?: string[];
  advertiserName?: string | null;
  country?: string | null;
  deeplinkDomains?: string[];
  /** Diagnostics: how the enrichment record was matched. */
  matchedBy?: string | null;
  sourceId?: string | null;
}

export interface EnrichmentStats {
  offers: number;
  enriched: number;
  adRecords: number;
  campaignRecords: number;
}

/** Reads the enrichment payload previously attached to a raw record. */
export function readEnrichment(raw: unknown): OfferEnrichment | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>)[ENRICHMENT_KEY];
  return v && typeof v === "object" ? (v as OfferEnrichment) : null;
}
