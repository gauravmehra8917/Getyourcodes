import type { AdsRecordProvenanceV2 } from "./ad-models.ts";

export type ImpactEnvelopeV2 = Record<string, unknown>;

export function isImpactRecordV2(
  value: unknown,
): value is ImpactEnvelopeV2 {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Optional provider presentation value. IDs use their own opaque parser. */
export function optionalImpactStringV2(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function pageCountMetadata(envelope: ImpactEnvelopeV2): {
  pagePresent: boolean;
  pageCountPresent: boolean;
  page: number | null;
  pageCount: number | null;
} {
  return {
    pagePresent: "@page" in envelope,
    pageCountPresent: "@numpages" in envelope,
    page: positiveInteger(envelope["@page"]),
    pageCount: positiveInteger(envelope["@numpages"]),
  };
}

function terminalPageProven(
  metadata: ReturnType<typeof pageCountMetadata>,
): boolean {
  const { page, pageCount } = metadata;
  return page !== null && pageCount !== null && page === pageCount;
}

function impossiblePageMetadata(
  metadata: ReturnType<typeof pageCountMetadata>,
): boolean {
  const { page, pageCount } = metadata;
  return page !== null && pageCount !== null && page > pageCount;
}

function absentContinuationIsTerminal(
  metadata: ReturnType<typeof pageCountMetadata>,
): boolean {
  if (!metadata.pagePresent || !metadata.pageCountPresent) return true;
  return terminalPageProven(metadata);
}

/**
 * Keeps Impact's continuation opaque. A missing continuation is terminal only
 * when available page-count metadata does not prove that pages remain. A
 * blank/null continuation still requires positive final-page proof.
 */
export function impactContinuationV2(
  envelope: ImpactEnvelopeV2,
): { ok: true; value: string | null } | { ok: false } {
  const metadata = pageCountMetadata(envelope);
  if (impossiblePageMetadata(metadata)) return { ok: false };
  if (!("@nextpageuri" in envelope)) {
    return absentContinuationIsTerminal(metadata)
      ? { ok: true, value: null }
      : { ok: false };
  }
  const value = envelope["@nextpageuri"];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return { ok: true, value: trimmed };
    return terminalPageProven(metadata)
      ? { ok: true, value: null }
      : { ok: false };
  }
  if (value === null && terminalPageProven(metadata)) {
    return { ok: true, value: null };
  }
  return { ok: false };
}

export function impactPageMetadataV2(envelope: ImpactEnvelopeV2): {
  providerPage: number | null;
  providerPageSize: number | null;
} {
  return {
    providerPage: positiveInteger(envelope["@page"]),
    providerPageSize: positiveInteger(envelope["@pagesize"]),
  };
}

export function impactRecordProvenanceV2(
  fetchSequence: number,
  recordIndex: number,
  metadata: ReturnType<typeof impactPageMetadataV2>,
): AdsRecordProvenanceV2 {
  return {
    fetchSequence,
    recordIndex,
    providerPage: metadata.providerPage,
    providerPageSize: metadata.providerPageSize,
  };
}
