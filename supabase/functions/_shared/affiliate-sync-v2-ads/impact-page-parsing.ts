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

function terminalPageProven(envelope: ImpactEnvelopeV2): boolean {
  const page = positiveInteger(envelope["@page"]);
  const pageCount = positiveInteger(envelope["@numpages"]);
  return page !== null && pageCount !== null && page === pageCount;
}

/**
 * Keeps Impact's continuation opaque. Blank/null is terminal only when the
 * provider's positive page metadata proves this is the final page.
 */
export function impactContinuationV2(
  envelope: ImpactEnvelopeV2,
): { ok: true; value: string | null } | { ok: false } {
  if (!("@nextpageuri" in envelope)) return { ok: true, value: null };
  const value = envelope["@nextpageuri"];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return { ok: true, value: trimmed };
    return terminalPageProven(envelope)
      ? { ok: true, value: null }
      : { ok: false };
  }
  if (value === null && terminalPageProven(envelope)) {
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
