import {
  impactContinuationV2,
  impactPageMetadataV2,
  isImpactRecordV2,
} from "../affiliate-sync-v2-ads/impact-page-parsing.ts";
import {
  fetchBoundedImpactCollectionV2,
  isExactInitialCampaignsRequestV2,
} from "../affiliate-sync-v2-ads/impact-bounded-client.ts";
import type { ImpactAdsCampaignClientOptionsV2 } from "../affiliate-sync-v2-ads/ImpactAdsCampaignClient.ts";
import { extractCampaignCategories } from "./taxonomy.ts";

/** Isolated taxonomy projection: unrestricted Campaign payloads never escape. */
export function parseCategoryCampaignPage(bodyText: string) {
  let envelope: unknown;
  try {
    envelope = JSON.parse(bodyText);
  } catch {
    return { ok: false as const, reason: "invalid_json" as const };
  }
  if (!isImpactRecordV2(envelope))
    return { ok: false as const, reason: "envelope_not_object" as const };
  if (!("Campaigns" in envelope))
    return { ok: false as const, reason: "missing_collection" as const };
  if (!Array.isArray(envelope.Campaigns))
    return { ok: false as const, reason: "collection_not_array" as const };
  const continuation = impactContinuationV2(envelope);
  if (!continuation.ok) return { ok: false as const, reason: "invalid_nextpageuri" as const };
  return {
    ok: true as const,
    records: envelope.Campaigns.map(extractCampaignCategories),
    rawRecordCount: envelope.Campaigns.length,
    quarantineReasonCounts: { malformed_record: 0, missing_ad_id: 0, missing_campaign_id: 0 },
    ...impactPageMetadataV2(envelope),
    nextContinuationUri: continuation.value,
  };
}

export function fetchCategoryCampaigns(
  options: ImpactAdsCampaignClientOptionsV2,
  initialUrl: string,
  signal?: AbortSignal,
) {
  return fetchBoundedImpactCollectionV2(
    initialUrl,
    {
      ...options,
      stream: "campaigns",
      parse: parseCategoryCampaignPage,
      exactInitialRequest: isExactInitialCampaignsRequestV2,
    },
    signal,
  );
}
