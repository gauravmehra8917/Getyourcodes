import { toOpaqueProviderId } from "../_shared/affiliate-sync-v2/models.ts";
import type { CouponCodeShapeV2 } from "./types.ts";

type ImpactEnvelope = Record<string, unknown>;

export interface RawImpactCouponAdV2 {
  adId: string;
  campaignId: string | null;
  campaignName: string | null;
  advertiserId: string | null;
  advertiserName: string | null;
  dealId: string | null;
  dealState: string | null;
  dealDefaultPromoCodeShape: CouponCodeShapeV2;
  codeShape: CouponCodeShapeV2;
  trackingLink: string | null;
  landingPageUrl: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface ImpactAdsQuarantineCountsV2 {
  malformed_record: number;
  missing_ad_id: number;
}

export type ImpactAdsParseFailureReasonV2 =
  | "invalid_json"
  | "envelope_not_object"
  | "missing_collection"
  | "collection_not_array"
  | "invalid_nextpageuri";

export interface ParsedImpactAdsPageV2 {
  ok: true;
  records: RawImpactCouponAdV2[];
  rawRecordCount: number;
  quarantineCounts: ImpactAdsQuarantineCountsV2;
  providerPage: string | null;
  providerPageSize: string | null;
  nextContinuationUri: string | null;
}

export interface ImpactAdsPageParseFailureV2 {
  ok: false;
  reason: ImpactAdsParseFailureReasonV2;
}

export type ImpactAdsPageParseResultV2 =
  | ParsedImpactAdsPageV2
  | ImpactAdsPageParseFailureV2;

function isRecord(value: unknown): value is ImpactEnvelope {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function metadataText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
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

function terminalPageProven(envelope: ImpactEnvelope): boolean {
  const page = positiveInteger(envelope["@page"]);
  const numPages = positiveInteger(envelope["@numpages"]);
  return page !== null && numPages !== null && page === numPages;
}

function continuationOf(
  envelope: ImpactEnvelope,
): { ok: true; value: string | null } | { ok: false } {
  if (!("@nextpageuri" in envelope)) return { ok: true, value: null };
  const continuation = envelope["@nextpageuri"];
  if (typeof continuation === "string") {
    const trimmed = continuation.trim();
    if (trimmed) return { ok: true, value: trimmed };
    return terminalPageProven(envelope)
      ? { ok: true, value: null }
      : { ok: false };
  }
  if (continuation === null && terminalPageProven(envelope)) {
    return { ok: true, value: null };
  }
  return { ok: false };
}

function codeShape(
  record: ImpactEnvelope,
  property: "Code" | "DealDefaultPromoCode",
): CouponCodeShapeV2 {
  if (!Object.prototype.hasOwnProperty.call(record, property)) return "missing";
  const value = record[property];
  if (value === null) return "null";
  if (typeof value === "string") {
    return value.trim() ? "nonemptyString" : "emptyOrWhitespaceString";
  }
  return "otherShape";
}

function adOf(record: ImpactEnvelope, adId: string): RawImpactCouponAdV2 {
  return {
    adId,
    campaignId: toOpaqueProviderId(record.CampaignId),
    campaignName: optionalText(record.CampaignName),
    advertiserId: toOpaqueProviderId(record.AdvertiserId),
    advertiserName: optionalText(record.AdvertiserName),
    dealId: toOpaqueProviderId(record.DealId),
    dealState: optionalText(record.DealState),
    dealDefaultPromoCodeShape: codeShape(record, "DealDefaultPromoCode"),
    codeShape: codeShape(record, "Code"),
    trackingLink: optionalText(record.TrackingLink),
    landingPageUrl: optionalText(record.LandingPageUrl),
    startDate: optionalText(record.StartDate),
    endDate: optionalText(record.EndDate),
  };
}

/** Strict root `Ads` envelope parser. It never retains code values or raw rows. */
export class ImpactAdsPageParser {
  static parse(bodyText: string): ImpactAdsPageParseResultV2 {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    if (!isRecord(parsed)) {
      return { ok: false, reason: "envelope_not_object" };
    }
    if (!("Ads" in parsed)) {
      return { ok: false, reason: "missing_collection" };
    }
    if (!Array.isArray(parsed.Ads)) {
      return { ok: false, reason: "collection_not_array" };
    }
    const continuation = continuationOf(parsed);
    if (!continuation.ok) {
      return { ok: false, reason: "invalid_nextpageuri" };
    }

    const records: RawImpactCouponAdV2[] = [];
    const quarantineCounts: ImpactAdsQuarantineCountsV2 = {
      malformed_record: 0,
      missing_ad_id: 0,
    };
    for (const value of parsed.Ads) {
      if (!isRecord(value)) {
        quarantineCounts.malformed_record += 1;
        continue;
      }
      const adId = toOpaqueProviderId(value.Id);
      if (adId === null) {
        quarantineCounts.missing_ad_id += 1;
        continue;
      }
      records.push(adOf(value, adId));
    }

    return {
      ok: true,
      records,
      rawRecordCount: parsed.Ads.length,
      quarantineCounts,
      providerPage: metadataText(parsed["@page"]),
      providerPageSize: metadataText(parsed["@pagesize"]),
      nextContinuationUri: continuation.value,
    };
  }
}
