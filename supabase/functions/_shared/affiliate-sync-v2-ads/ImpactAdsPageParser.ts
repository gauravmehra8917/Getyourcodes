import {
  type AdCodeClassV2,
  type RawImpactAdV2,
  toOpaqueAdProviderIdV2,
} from "./ad-models.ts";
import type {
  ImpactAdsParseFailureReasonV2,
  ImpactAdsQuarantineReasonCountsV2,
} from "./ads-diagnostics.ts";
import {
  impactContinuationV2,
  impactPageMetadataV2,
  impactRecordProvenanceV2,
  isImpactRecordV2,
  optionalImpactStringV2,
} from "./impact-page-parsing.ts";

export interface ParsedImpactAdsPageV2 {
  ok: true;
  records: RawImpactAdV2[];
  rawRecordCount: number;
  quarantineReasonCounts: ImpactAdsQuarantineReasonCountsV2;
  providerPage: number | null;
  providerPageSize: number | null;
  nextContinuationUri: string | null;
}

export interface ImpactAdsPageParseFailureV2 {
  ok: false;
  reason: ImpactAdsParseFailureReasonV2;
}

export type ImpactAdsPageParseResultV2 =
  | ParsedImpactAdsPageV2
  | ImpactAdsPageParseFailureV2;

function codeClass(value: unknown): AdCodeClassV2 {
  return typeof value === "string" && value.trim().length > 0
    ? "code_bearing"
    : "no_code";
}

function adOf(
  record: Record<string, unknown>,
  adId: string,
  fetchSequence: number,
  recordIndex: number,
  metadata: { providerPage: number | null; providerPageSize: number | null },
): RawImpactAdV2 {
  return {
    providerOfferKey: { provider: "impact", namespace: "ad", id: adId },
    campaignId: toOpaqueAdProviderIdV2(record.CampaignId),
    advertiserId: toOpaqueAdProviderIdV2(record.AdvertiserId),
    dealId: toOpaqueAdProviderIdV2(record.DealId),
    // `Name` is the exact provider Ad title carrier. No identity fallback uses it.
    title: optionalImpactStringV2(record.Name),
    description: optionalImpactStringV2(record.Description),
    trackingUrl: optionalImpactStringV2(record.TrackingLink),
    landingPageUrl: optionalImpactStringV2(record.LandingPageUrl),
    startDate: optionalImpactStringV2(record.StartDate),
    endDate: optionalImpactStringV2(record.EndDate),
    codeClass: codeClass(record.DealDefaultPromoCode),
    provenance: impactRecordProvenanceV2(
      fetchSequence,
      recordIndex,
      metadata,
    ),
  };
}

/** Strict root-`Ads` parser. It never reads or retains Impact `Code`. */
export class ImpactAdsPageParser {
  static parse(
    bodyText: string,
    input: { fetchSequence: number },
  ): ImpactAdsPageParseResultV2 {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    if (!isImpactRecordV2(parsed)) {
      return { ok: false, reason: "envelope_not_object" };
    }
    if (!("Ads" in parsed)) {
      return { ok: false, reason: "missing_collection" };
    }
    if (!Array.isArray(parsed.Ads)) {
      return { ok: false, reason: "collection_not_array" };
    }
    const continuation = impactContinuationV2(parsed);
    if (!continuation.ok) {
      return { ok: false, reason: "invalid_nextpageuri" };
    }

    const metadata = impactPageMetadataV2(parsed);
    const records: RawImpactAdV2[] = [];
    const quarantineReasonCounts: ImpactAdsQuarantineReasonCountsV2 = {
      malformed_record: 0,
      missing_ad_id: 0,
      missing_campaign_id: 0,
    };
    parsed.Ads.forEach((value, recordIndex) => {
      if (!isImpactRecordV2(value)) {
        quarantineReasonCounts.malformed_record += 1;
        return;
      }
      const adId = toOpaqueAdProviderIdV2(value.Id);
      if (adId === null) {
        quarantineReasonCounts.missing_ad_id += 1;
        return;
      }
      records.push(
        adOf(value, adId, input.fetchSequence, recordIndex, metadata),
      );
    });

    return {
      ok: true,
      records,
      rawRecordCount: parsed.Ads.length,
      quarantineReasonCounts,
      ...metadata,
      nextContinuationUri: continuation.value,
    };
  }
}
