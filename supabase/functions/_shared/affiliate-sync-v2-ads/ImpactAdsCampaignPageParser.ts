import {
  type RawImpactCampaignForAdsV2,
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

export interface ParsedImpactAdsCampaignPageV2 {
  ok: true;
  records: RawImpactCampaignForAdsV2[];
  rawRecordCount: number;
  quarantineReasonCounts: ImpactAdsQuarantineReasonCountsV2;
  providerPage: number | null;
  providerPageSize: number | null;
  nextContinuationUri: string | null;
}

export interface ImpactAdsCampaignPageParseFailureV2 {
  ok: false;
  reason: ImpactAdsParseFailureReasonV2;
}

export type ImpactAdsCampaignPageParseResultV2 =
  | ParsedImpactAdsCampaignPageV2
  | ImpactAdsCampaignPageParseFailureV2;

function firstText(
  record: Record<string, unknown>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = optionalImpactStringV2(record[name]);
    if (value !== null) return value;
  }
  return null;
}

/** Dedicated Campaign parser for the Ads pipeline; no Promotions code is loaded. */
export class ImpactAdsCampaignPageParser {
  static parse(
    bodyText: string,
    input: { fetchSequence: number },
  ): ImpactAdsCampaignPageParseResultV2 {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    if (!isImpactRecordV2(parsed)) {
      return { ok: false, reason: "envelope_not_object" };
    }
    if (!("Campaigns" in parsed)) {
      return { ok: false, reason: "missing_collection" };
    }
    if (!Array.isArray(parsed.Campaigns)) {
      return { ok: false, reason: "collection_not_array" };
    }
    const continuation = impactContinuationV2(parsed);
    if (!continuation.ok) {
      return { ok: false, reason: "invalid_nextpageuri" };
    }

    const metadata = impactPageMetadataV2(parsed);
    const records: RawImpactCampaignForAdsV2[] = [];
    const quarantineReasonCounts: ImpactAdsQuarantineReasonCountsV2 = {
      malformed_record: 0,
      missing_ad_id: 0,
      missing_campaign_id: 0,
    };
    parsed.Campaigns.forEach((value, recordIndex) => {
      if (!isImpactRecordV2(value)) {
        quarantineReasonCounts.malformed_record += 1;
        return;
      }
      const campaignId = toOpaqueAdProviderIdV2(value.CampaignId);
      if (campaignId === null) {
        quarantineReasonCounts.missing_campaign_id += 1;
        return;
      }
      records.push({
        campaignId,
        advertiserId: toOpaqueAdProviderIdV2(value.AdvertiserId),
        campaignName: firstText(value, [
          "CampaignName",
          "Name",
          "AdvertiserName",
        ]),
        destinationUrl: firstText(value, [
          "CampaignUrl",
          "AdvertiserUrl",
          "LandingPageUrl",
          "Url",
        ]),
        trackingUrl: firstText(value, ["TrackingLink", "TrackingUrl"]),
        provenance: impactRecordProvenanceV2(
          input.fetchSequence,
          recordIndex,
          metadata,
        ),
      });
    });

    return {
      ok: true,
      records,
      rawRecordCount: parsed.Campaigns.length,
      quarantineReasonCounts,
      ...metadata,
      nextContinuationUri: continuation.value,
    };
  }
}
