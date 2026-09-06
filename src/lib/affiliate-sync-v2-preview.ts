export const AFFILIATE_SYNC_PREVIEW_V2_FUNCTION = "affiliate-sync-preview-v2" as const;

export interface AffiliateSyncPreviewV2Request {
  integrationId: string;
  preview: true;
}

type ImpactStreamV2 = "promotions" | "campaigns";
type AdminV2PreviewStopReason =
  | "completed"
  | "page_limit"
  | "record_limit"
  | "continuation_loop"
  | "invalid_continuation"
  | "malformed_page"
  | "transport_error"
  | "provider_error"
  | "timeout"
  | "cancelled";

export type AdminV2PreviewCountMap = Readonly<Record<string, number>>;

export interface AdminV2PreviewStreamDiagnostics<TStream extends ImpactStreamV2> {
  stream: TStream;
  pagesFetched: number;
  rawRecordCount: number;
  acceptedRecordCount: number;
  quarantinedRecordCount: number;
  quarantineReasonCounts: AdminV2PreviewCountMap;
  stopReason: AdminV2PreviewStopReason | null;
}

export interface AdminV2PreviewDto {
  rawFetchDiagnostics: {
    promotions: AdminV2PreviewStreamDiagnostics<"promotions">;
    campaigns: AdminV2PreviewStreamDiagnostics<"campaigns">;
  };
  parserDiagnostics: {
    quarantinedRecords: number;
  };
  deduplicationDiagnostics: {
    acceptedInputRecords: number;
    uniquePromotions: number;
    duplicateRecordsRemoved: number;
    duplicatedIdentities: number;
    identitiesWithConflictingProviderFields: number;
  };
  merchantIdentityDiagnostics: {
    promotionsEvaluated: number;
    resolvedByCampaignId: number;
    resolvedByAdvertiserId: number;
    unmatchedTotal: number;
    matchMethodCounts: AdminV2PreviewCountMap;
    unresolvedReasonCounts: AdminV2PreviewCountMap;
  };
  normalizationDiagnostics: {
    couponsNormalized: number;
    dealsNormalized: number;
    offersUnresolvedFromA4: number;
    offersWithResolvedProviderStoreKey: number;
    storesNormalized: number;
  };
  storeMatchDiagnostics: {
    offersMatchedToExistingStore: number;
  };
  offerQualificationDiagnostics: {
    offersEvaluated: number;
    eligibleOffers: number;
    ineligibleOffers: number;
    ineligibleReasonCounts: AdminV2PreviewCountMap;
  };
  existingOfferIdentityDiagnostics: {
    existingPromotionIdentities: number;
    newPromotionIdentities: number;
  };
  storeCoverage: {
    campaignBackedStoresDiscovered: number;
    providerStoreKeysReferencedByPromotions: number;
    storesWithResolvedOffers: number;
    storesMatchedToExisting: number;
    newStoreCandidates: number;
    qualifiedStores: number;
  };
  identityIntegrityDiagnostics: {
    distinctResolvedProviderStoreKeys: number;
    normalizedProviderStoreKeys: number;
    matchedProviderStoreKeys: number;
    policyProviderStoreKeys: number;
    qualificationProviderStoreKeys: number;
    identityCollapseDetected: boolean;
  };
  publishingPolicy: {
    diagnostics: {
      couponsSelected: number;
      couponsHeld: number;
      dealsSelected: number;
      dealsHeld: number;
      storesCovered: number;
      holdReasonCounts: AdminV2PreviewCountMap;
    };
  };
  proposedActions: {
    counts: {
      stores: {
        discovered: number;
        matchedExisting: number;
        newCandidates: number;
        unmatchedAssociations: number;
        ambiguousSnapshot: number;
        qualified: number;
      };
      coupons: AdminV2PreviewOfferKindCounts;
      deals: AdminV2PreviewOfferKindCounts;
      offers: AdminV2PreviewOfferKindCounts & {
        duplicateRecordsRemoved: number;
        quarantined: number;
      };
    };
  };
}

export interface AdminV2PreviewOfferKindCounts {
  normalized: number;
  selected: number;
  held: number;
  unresolved: number;
  existing: number;
  proposedCreate: number;
}

export interface AdminV2PreviewHostResponse {
  host: {
    version: "v2-a8a";
    readOnly: true;
    integrationId: string;
  };
  preview: AdminV2PreviewDto;
}

export type AffiliateSyncPreviewV2Invoke = (
  functionName: typeof AFFILIATE_SYNC_PREVIEW_V2_FUNCTION,
  options: { body: AffiliateSyncPreviewV2Request },
) => Promise<{ data: unknown; error: unknown }>;

export type AffiliateSyncPreviewV2ClientErrorCode =
  | "invalid_integration_id"
  | "invoke_failed"
  | "invalid_response";

export class AffiliateSyncPreviewV2ClientError extends Error {
  readonly code: AffiliateSyncPreviewV2ClientErrorCode;

  constructor(code: AffiliateSyncPreviewV2ClientErrorCode) {
    const message =
      code === "invalid_integration_id"
        ? "A valid integration ID is required."
        : code === "invoke_failed"
          ? "V2 preview could not be completed."
          : "V2 preview returned an invalid response.";
    super(message);
    this.name = "AffiliateSyncPreviewV2ClientError";
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonnegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function selectCountFields(
  value: unknown,
  fields: readonly string[],
): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const selected: Record<string, number> = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) return null;
    const count = value[field];
    if (!nonnegativeInteger(count)) return null;
    selected[field] = count;
  }
  return selected;
}

function exactCountMap(value: unknown, fields: readonly string[]): AdminV2PreviewCountMap | null {
  if (!isRecord(value) || !hasExactKeys(value, fields)) return null;
  return selectCountFields(value, fields);
}

function isStopReason(value: unknown): value is AdminV2PreviewStopReason | null {
  switch (value) {
    case null:
    case "completed":
    case "page_limit":
    case "record_limit":
    case "continuation_loop":
    case "invalid_continuation":
    case "malformed_page":
    case "transport_error":
    case "provider_error":
    case "timeout":
    case "cancelled":
      return true;
    default:
      return false;
  }
}

const QUARANTINE_REASONS = [
  "malformed_record",
  "missing_promotion_id",
  "missing_campaign_id",
] as const;
const MATCH_METHODS = [
  "campaign_id",
  "advertiser_id",
  "explicit_provider_relation",
  "unmatched",
] as const;
const UNRESOLVED_REASONS = [
  "unknown_campaign_id",
  "campaign_advertiser_conflict",
  "unknown_advertiser_id",
  "ambiguous_advertiser_id",
  "missing_merchant_identity",
] as const;
const INELIGIBLE_REASONS = [
  "unresolved_store",
  "not_started",
  "expired",
  "invalid_date",
  "invalid_date_range",
  "missing_title",
] as const;
const HOLD_REASONS = [...INELIGIBLE_REASONS, "over_coupon_limit", "over_deal_limit"] as const;
const OFFER_KIND_FIELDS = [
  "normalized",
  "selected",
  "held",
  "unresolved",
  "existing",
  "proposedCreate",
] as const;

function parseStream<TStream extends ImpactStreamV2>(
  value: unknown,
  expectedStream: TStream,
): AdminV2PreviewStreamDiagnostics<TStream> | null {
  if (
    !isRecord(value) ||
    !Object.prototype.hasOwnProperty.call(value, "stream") ||
    !Object.prototype.hasOwnProperty.call(value, "stopReason") ||
    value.stream !== expectedStream ||
    !isStopReason(value.stopReason)
  ) {
    return null;
  }
  const counts = selectCountFields(value, [
    "pagesFetched",
    "rawRecordCount",
    "acceptedRecordCount",
    "quarantinedRecordCount",
  ]);
  const quarantineReasonCounts = exactCountMap(value.quarantineReasonCounts, QUARANTINE_REASONS);
  if (!counts || !quarantineReasonCounts) return null;
  return {
    stream: expectedStream,
    pagesFetched: counts.pagesFetched,
    rawRecordCount: counts.rawRecordCount,
    acceptedRecordCount: counts.acceptedRecordCount,
    quarantinedRecordCount: counts.quarantinedRecordCount,
    quarantineReasonCounts,
    stopReason: value.stopReason,
  };
}

function parseOfferKindCounts(value: unknown): AdminV2PreviewOfferKindCounts | null {
  const counts = selectCountFields(value, OFFER_KIND_FIELDS);
  if (!counts) return null;
  return {
    normalized: counts.normalized,
    selected: counts.selected,
    held: counts.held,
    unresolved: counts.unresolved,
    existing: counts.existing,
    proposedCreate: counts.proposedCreate,
  };
}

function parseAdminPreview(value: unknown): AdminV2PreviewDto | null {
  if (!isRecord(value)) return null;
  const rawFetch = isRecord(value.rawFetchDiagnostics) ? value.rawFetchDiagnostics : null;
  const promotions = parseStream(rawFetch?.promotions, "promotions");
  const campaigns = parseStream(rawFetch?.campaigns, "campaigns");
  const parser = selectCountFields(value.parserDiagnostics, ["quarantinedRecords"]);
  const dedupe = selectCountFields(value.deduplicationDiagnostics, [
    "acceptedInputRecords",
    "uniquePromotions",
    "duplicateRecordsRemoved",
    "duplicatedIdentities",
    "identitiesWithConflictingProviderFields",
  ]);

  const merchantRaw = isRecord(value.merchantIdentityDiagnostics)
    ? value.merchantIdentityDiagnostics
    : null;
  const merchant = selectCountFields(merchantRaw, [
    "promotionsEvaluated",
    "resolvedByCampaignId",
    "resolvedByAdvertiserId",
    "unmatchedTotal",
  ]);
  const matchMethodCounts = exactCountMap(merchantRaw?.matchMethodCounts, MATCH_METHODS);
  const unresolvedReasonCounts = exactCountMap(
    merchantRaw?.unresolvedReasonCounts,
    UNRESOLVED_REASONS,
  );

  const normalization = selectCountFields(value.normalizationDiagnostics, [
    "couponsNormalized",
    "dealsNormalized",
    "offersUnresolvedFromA4",
    "offersWithResolvedProviderStoreKey",
    "storesNormalized",
  ]);
  const storeMatch = selectCountFields(value.storeMatchDiagnostics, [
    "offersMatchedToExistingStore",
  ]);

  const qualificationRaw = isRecord(value.offerQualificationDiagnostics)
    ? value.offerQualificationDiagnostics
    : null;
  const qualification = selectCountFields(qualificationRaw, [
    "offersEvaluated",
    "eligibleOffers",
    "ineligibleOffers",
  ]);
  const ineligibleReasonCounts = exactCountMap(
    qualificationRaw?.ineligibleReasonCounts,
    INELIGIBLE_REASONS,
  );

  const existingIdentity = selectCountFields(value.existingOfferIdentityDiagnostics, [
    "existingPromotionIdentities",
    "newPromotionIdentities",
  ]);
  const coverage = selectCountFields(value.storeCoverage, [
    "campaignBackedStoresDiscovered",
    "providerStoreKeysReferencedByPromotions",
    "storesWithResolvedOffers",
    "storesMatchedToExisting",
    "newStoreCandidates",
    "qualifiedStores",
  ]);

  const integrityRaw = isRecord(value.identityIntegrityDiagnostics)
    ? value.identityIntegrityDiagnostics
    : null;
  const integrity = selectCountFields(integrityRaw, [
    "distinctResolvedProviderStoreKeys",
    "normalizedProviderStoreKeys",
    "matchedProviderStoreKeys",
    "policyProviderStoreKeys",
    "qualificationProviderStoreKeys",
  ]);
  const identityCollapseDetected = integrityRaw?.identityCollapseDetected;

  const publishingRaw =
    isRecord(value.publishingPolicy) && isRecord(value.publishingPolicy.diagnostics)
      ? value.publishingPolicy.diagnostics
      : null;
  const publishing = selectCountFields(publishingRaw, [
    "couponsSelected",
    "couponsHeld",
    "dealsSelected",
    "dealsHeld",
    "storesCovered",
  ]);
  const holdReasonCounts = exactCountMap(publishingRaw?.holdReasonCounts, HOLD_REASONS);

  const proposedRaw =
    isRecord(value.proposedActions) && isRecord(value.proposedActions.counts)
      ? value.proposedActions.counts
      : null;
  const proposedStores = selectCountFields(proposedRaw?.stores, [
    "discovered",
    "matchedExisting",
    "newCandidates",
    "unmatchedAssociations",
    "ambiguousSnapshot",
    "qualified",
  ]);
  const proposedCoupons = parseOfferKindCounts(proposedRaw?.coupons);
  const proposedDeals = parseOfferKindCounts(proposedRaw?.deals);
  const proposedOffers = selectCountFields(proposedRaw?.offers, [
    ...OFFER_KIND_FIELDS,
    "duplicateRecordsRemoved",
    "quarantined",
  ]);

  if (
    !promotions ||
    !campaigns ||
    !parser ||
    !dedupe ||
    !merchant ||
    !matchMethodCounts ||
    !unresolvedReasonCounts ||
    !normalization ||
    !storeMatch ||
    !qualification ||
    !ineligibleReasonCounts ||
    !existingIdentity ||
    !coverage ||
    !integrity ||
    typeof identityCollapseDetected !== "boolean" ||
    !publishing ||
    !holdReasonCounts ||
    !proposedStores ||
    !proposedCoupons ||
    !proposedDeals ||
    !proposedOffers
  ) {
    return null;
  }

  return {
    rawFetchDiagnostics: { promotions, campaigns },
    parserDiagnostics: { quarantinedRecords: parser.quarantinedRecords },
    deduplicationDiagnostics: {
      acceptedInputRecords: dedupe.acceptedInputRecords,
      uniquePromotions: dedupe.uniquePromotions,
      duplicateRecordsRemoved: dedupe.duplicateRecordsRemoved,
      duplicatedIdentities: dedupe.duplicatedIdentities,
      identitiesWithConflictingProviderFields: dedupe.identitiesWithConflictingProviderFields,
    },
    merchantIdentityDiagnostics: {
      promotionsEvaluated: merchant.promotionsEvaluated,
      resolvedByCampaignId: merchant.resolvedByCampaignId,
      resolvedByAdvertiserId: merchant.resolvedByAdvertiserId,
      unmatchedTotal: merchant.unmatchedTotal,
      matchMethodCounts,
      unresolvedReasonCounts,
    },
    normalizationDiagnostics: {
      couponsNormalized: normalization.couponsNormalized,
      dealsNormalized: normalization.dealsNormalized,
      offersUnresolvedFromA4: normalization.offersUnresolvedFromA4,
      offersWithResolvedProviderStoreKey: normalization.offersWithResolvedProviderStoreKey,
      storesNormalized: normalization.storesNormalized,
    },
    storeMatchDiagnostics: {
      offersMatchedToExistingStore: storeMatch.offersMatchedToExistingStore,
    },
    offerQualificationDiagnostics: {
      offersEvaluated: qualification.offersEvaluated,
      eligibleOffers: qualification.eligibleOffers,
      ineligibleOffers: qualification.ineligibleOffers,
      ineligibleReasonCounts,
    },
    existingOfferIdentityDiagnostics: {
      existingPromotionIdentities: existingIdentity.existingPromotionIdentities,
      newPromotionIdentities: existingIdentity.newPromotionIdentities,
    },
    storeCoverage: {
      campaignBackedStoresDiscovered: coverage.campaignBackedStoresDiscovered,
      providerStoreKeysReferencedByPromotions: coverage.providerStoreKeysReferencedByPromotions,
      storesWithResolvedOffers: coverage.storesWithResolvedOffers,
      storesMatchedToExisting: coverage.storesMatchedToExisting,
      newStoreCandidates: coverage.newStoreCandidates,
      qualifiedStores: coverage.qualifiedStores,
    },
    identityIntegrityDiagnostics: {
      distinctResolvedProviderStoreKeys: integrity.distinctResolvedProviderStoreKeys,
      normalizedProviderStoreKeys: integrity.normalizedProviderStoreKeys,
      matchedProviderStoreKeys: integrity.matchedProviderStoreKeys,
      policyProviderStoreKeys: integrity.policyProviderStoreKeys,
      qualificationProviderStoreKeys: integrity.qualificationProviderStoreKeys,
      identityCollapseDetected,
    },
    publishingPolicy: {
      diagnostics: {
        couponsSelected: publishing.couponsSelected,
        couponsHeld: publishing.couponsHeld,
        dealsSelected: publishing.dealsSelected,
        dealsHeld: publishing.dealsHeld,
        storesCovered: publishing.storesCovered,
        holdReasonCounts,
      },
    },
    proposedActions: {
      counts: {
        stores: {
          discovered: proposedStores.discovered,
          matchedExisting: proposedStores.matchedExisting,
          newCandidates: proposedStores.newCandidates,
          unmatchedAssociations: proposedStores.unmatchedAssociations,
          ambiguousSnapshot: proposedStores.ambiguousSnapshot,
          qualified: proposedStores.qualified,
        },
        coupons: proposedCoupons,
        deals: proposedDeals,
        offers: {
          normalized: proposedOffers.normalized,
          selected: proposedOffers.selected,
          held: proposedOffers.held,
          unresolved: proposedOffers.unresolved,
          existing: proposedOffers.existing,
          proposedCreate: proposedOffers.proposedCreate,
          duplicateRecordsRemoved: proposedOffers.duplicateRecordsRemoved,
          quarantined: proposedOffers.quarantined,
        },
      },
    },
  };
}

export function parseAffiliateSyncPreviewV2HostResponse(
  value: unknown,
  requestedIntegrationId: string,
): AdminV2PreviewHostResponse {
  if (!isRecord(value) || !hasExactKeys(value, ["host", "preview"]) || !isRecord(value.host)) {
    throw new AffiliateSyncPreviewV2ClientError("invalid_response");
  }
  const preview = parseAdminPreview(value.preview);
  if (
    !hasExactKeys(value.host, ["version", "readOnly", "integrationId"]) ||
    value.host.version !== "v2-a8a" ||
    value.host.readOnly !== true ||
    value.host.integrationId !== requestedIntegrationId ||
    !preview
  ) {
    throw new AffiliateSyncPreviewV2ClientError("invalid_response");
  }
  return {
    host: {
      version: value.host.version,
      readOnly: value.host.readOnly,
      integrationId: value.host.integrationId,
    },
    preview,
  };
}

export async function requestAffiliateSyncPreviewV2(
  integrationId: string,
  invoke: AffiliateSyncPreviewV2Invoke,
): Promise<AdminV2PreviewHostResponse> {
  if (!UUID_PATTERN.test(integrationId)) {
    throw new AffiliateSyncPreviewV2ClientError("invalid_integration_id");
  }

  const body: AffiliateSyncPreviewV2Request = { integrationId, preview: true };
  let result: Awaited<ReturnType<AffiliateSyncPreviewV2Invoke>>;
  try {
    result = await invoke(AFFILIATE_SYNC_PREVIEW_V2_FUNCTION, { body });
  } catch {
    throw new AffiliateSyncPreviewV2ClientError("invoke_failed");
  }
  if (result.error !== null && result.error !== undefined) {
    throw new AffiliateSyncPreviewV2ClientError("invoke_failed");
  }
  return parseAffiliateSyncPreviewV2HostResponse(result.data, integrationId);
}

export interface AffiliateSyncPreviewV2Metric {
  label: string;
  value: number | string | boolean | null;
  tone?: "ok" | "warn" | "bad";
}

export interface AffiliateSyncPreviewV2Section {
  title: string;
  metrics: AffiliateSyncPreviewV2Metric[];
}

export type AdminV2PreviewOperatorSeverity = "blocker" | "diagnostics" | "clean";

export interface AdminV2PreviewOperatorStatus {
  severity: AdminV2PreviewOperatorSeverity;
  title: string;
  tone: "bad" | "warn" | "ok";
}

/** Uses only settled V2 blocker/diagnostic counters; policy holds are intentionally excluded. */
export function getAdminV2PreviewOperatorStatus(
  preview: AdminV2PreviewDto,
): AdminV2PreviewOperatorStatus {
  if (
    preview.identityIntegrityDiagnostics.identityCollapseDetected ||
    preview.proposedActions.counts.stores.ambiguousSnapshot > 0
  ) {
    return {
      severity: "blocker",
      title: "V2 preview contains a persistence blocker",
      tone: "bad",
    };
  }
  if (
    preview.proposedActions.counts.offers.unresolved > 0 ||
    preview.proposedActions.counts.offers.quarantined > 0 ||
    preview.deduplicationDiagnostics.identitiesWithConflictingProviderFields > 0
  ) {
    return {
      severity: "diagnostics",
      title: "V2 preview completed with diagnostics",
      tone: "warn",
    };
  }
  return { severity: "clean", title: "V2 preview completed", tone: "ok" };
}

function countSummary(counts: Record<string, number>): string {
  const nonzero = Object.entries(counts).filter(([, count]) => count > 0);
  return nonzero.length === 0
    ? "None"
    : nonzero.map(([reason, count]) => `${reason.replaceAll("_", " ")}: ${count}`).join("; ");
}

/** Projects only V2-native diagnostics into display rows; no V1 report is involved. */
export function buildAffiliateSyncPreviewV2Sections(
  response: AdminV2PreviewHostResponse,
): AffiliateSyncPreviewV2Section[] {
  const preview = response.preview;
  const promotions = preview.rawFetchDiagnostics.promotions;
  const campaigns = preview.rawFetchDiagnostics.campaigns;
  const parser = preview.parserDiagnostics;
  const dedupe = preview.deduplicationDiagnostics;
  const merchant = preview.merchantIdentityDiagnostics;
  const normalization = preview.normalizationDiagnostics;
  const storeMatch = preview.storeMatchDiagnostics;
  const qualification = preview.offerQualificationDiagnostics;
  const existingIdentity = preview.existingOfferIdentityDiagnostics;
  const integrity = preview.identityIntegrityDiagnostics;
  const publishing = preview.publishingPolicy.diagnostics;
  const coverage = preview.storeCoverage;
  const counts = preview.proposedActions.counts;

  const offerMetrics = (kind: "Coupons" | "Deals", values: typeof counts.coupons) => ({
    title: `Proposed actions — ${kind.toLowerCase()}`,
    metrics: [
      { label: "Normalized", value: values.normalized },
      { label: "Selected", value: values.selected },
      { label: "Held", value: values.held, tone: values.held > 0 ? ("warn" as const) : undefined },
      {
        label: "Unresolved",
        value: values.unresolved,
        tone: values.unresolved > 0 ? ("warn" as const) : undefined,
      },
      { label: "Existing", value: values.existing },
      { label: "Proposed create", value: values.proposedCreate, tone: "ok" as const },
    ],
  });

  return [
    {
      title: "Provider fetch",
      metrics: [
        { label: "Promotions pages fetched", value: promotions.pagesFetched },
        { label: "Promotions raw", value: promotions.rawRecordCount },
        { label: "Promotions accepted", value: promotions.acceptedRecordCount },
        {
          label: "Promotions quarantined",
          value: promotions.quarantinedRecordCount,
          tone: promotions.quarantinedRecordCount > 0 ? "warn" : undefined,
        },
        {
          label: "Promotions quarantine reasons",
          value: countSummary(promotions.quarantineReasonCounts),
        },
        { label: "Promotions stop reason", value: promotions.stopReason },
        { label: "Campaigns pages fetched", value: campaigns.pagesFetched },
        { label: "Campaigns raw", value: campaigns.rawRecordCount },
        { label: "Campaigns accepted", value: campaigns.acceptedRecordCount },
        {
          label: "Campaigns quarantined",
          value: campaigns.quarantinedRecordCount,
          tone: campaigns.quarantinedRecordCount > 0 ? "warn" : undefined,
        },
        {
          label: "Campaigns quarantine reasons",
          value: countSummary(campaigns.quarantineReasonCounts),
        },
        { label: "Campaigns stop reason", value: campaigns.stopReason },
        { label: "Parser quarantined total", value: parser.quarantinedRecords },
      ],
    },
    {
      title: "Promotion identity and deduplication",
      metrics: [
        { label: "Accepted promotion records", value: dedupe.acceptedInputRecords },
        { label: "Unique promotions", value: dedupe.uniquePromotions },
        { label: "Duplicate records removed", value: dedupe.duplicateRecordsRemoved },
        { label: "Duplicated identities", value: dedupe.duplicatedIdentities },
        {
          label: "Identities with conflicting provider fields",
          value: dedupe.identitiesWithConflictingProviderFields,
          tone: dedupe.identitiesWithConflictingProviderFields > 0 ? "warn" : undefined,
        },
      ],
    },
    {
      title: "Merchant resolution",
      metrics: [
        { label: "Promotions evaluated", value: merchant.promotionsEvaluated },
        { label: "Resolved by campaign ID", value: merchant.resolvedByCampaignId },
        { label: "Resolved by advertiser ID", value: merchant.resolvedByAdvertiserId },
        {
          label: "Unmatched",
          value: merchant.unmatchedTotal,
          tone: merchant.unmatchedTotal > 0 ? "warn" : undefined,
        },
        { label: "Resolution methods", value: countSummary(merchant.matchMethodCounts) },
        { label: "Unresolved reasons", value: countSummary(merchant.unresolvedReasonCounts) },
      ],
    },
    {
      title: "Normalization",
      metrics: [
        { label: "Normalized stores", value: normalization.storesNormalized },
        { label: "Normalized coupons", value: normalization.couponsNormalized },
        { label: "Normalized deals", value: normalization.dealsNormalized },
        { label: "Resolved offers", value: normalization.offersWithResolvedProviderStoreKey },
        {
          label: "Unresolved offers",
          value: normalization.offersUnresolvedFromA4,
          tone: normalization.offersUnresolvedFromA4 > 0 ? "warn" : undefined,
        },
        {
          label: "Offers matched to existing store",
          value: storeMatch.offersMatchedToExistingStore,
        },
        {
          label: "Existing promotion identities",
          value: existingIdentity.existingPromotionIdentities,
        },
        { label: "New promotion identities", value: existingIdentity.newPromotionIdentities },
      ],
    },
    {
      title: "Identity integrity",
      metrics: [
        {
          label: "Distinct resolved provider-store keys",
          value: integrity.distinctResolvedProviderStoreKeys,
        },
        { label: "Normalized provider-store keys", value: integrity.normalizedProviderStoreKeys },
        { label: "Matched provider-store keys", value: integrity.matchedProviderStoreKeys },
        { label: "Policy provider-store keys", value: integrity.policyProviderStoreKeys },
        {
          label: "Qualification provider-store keys",
          value: integrity.qualificationProviderStoreKeys,
        },
        {
          label: "Identity collapse detected",
          value: integrity.identityCollapseDetected ? "Detected" : "None",
          tone: integrity.identityCollapseDetected ? "bad" : "ok",
        },
      ],
    },
    {
      title: "Publishing policy",
      metrics: [
        { label: "Offers evaluated", value: qualification.offersEvaluated },
        { label: "Content eligible", value: qualification.eligibleOffers },
        {
          label: "Content ineligible",
          value: qualification.ineligibleOffers,
          tone: qualification.ineligibleOffers > 0 ? "warn" : undefined,
        },
        {
          label: "Ineligibility reasons",
          value: countSummary(qualification.ineligibleReasonCounts),
        },
        { label: "Selected coupons", value: publishing.couponsSelected, tone: "ok" },
        { label: "Selected deals", value: publishing.dealsSelected, tone: "ok" },
        {
          label: "Held coupons",
          value: publishing.couponsHeld,
          tone: publishing.couponsHeld > 0 ? "warn" : undefined,
        },
        {
          label: "Held deals",
          value: publishing.dealsHeld,
          tone: publishing.dealsHeld > 0 ? "warn" : undefined,
        },
        { label: "Stores covered", value: publishing.storesCovered },
        { label: "Hold reasons", value: countSummary(publishing.holdReasonCounts) },
      ],
    },
    {
      title: "Store qualification",
      metrics: [
        {
          label: "Campaign-backed stores discovered",
          value: coverage.campaignBackedStoresDiscovered,
        },
        {
          label: "Resolved provider-store keys",
          value: coverage.providerStoreKeysReferencedByPromotions,
        },
        { label: "Stores with resolved offers", value: coverage.storesWithResolvedOffers },
        { label: "Matched existing stores", value: coverage.storesMatchedToExisting },
        { label: "New store candidates", value: coverage.newStoreCandidates },
        { label: "Qualified stores", value: coverage.qualifiedStores, tone: "ok" },
      ],
    },
    {
      title: "Proposed actions — stores",
      metrics: [
        { label: "Discovered", value: counts.stores.discovered },
        { label: "Matched existing", value: counts.stores.matchedExisting },
        { label: "New candidates", value: counts.stores.newCandidates, tone: "ok" },
        {
          label: "Unmatched associations",
          value: counts.stores.unmatchedAssociations,
          tone: counts.stores.unmatchedAssociations > 0 ? "warn" : undefined,
        },
        {
          label: "Ambiguous snapshot",
          value: counts.stores.ambiguousSnapshot,
          tone: counts.stores.ambiguousSnapshot > 0 ? "bad" : undefined,
        },
        { label: "Qualified", value: counts.stores.qualified },
      ],
    },
    offerMetrics("Coupons", counts.coupons),
    offerMetrics("Deals", counts.deals),
    {
      title: "Proposed actions — all offers",
      metrics: [
        { label: "Normalized", value: counts.offers.normalized },
        { label: "Selected", value: counts.offers.selected },
        {
          label: "Held",
          value: counts.offers.held,
          tone: counts.offers.held > 0 ? "warn" : undefined,
        },
        {
          label: "Unresolved",
          value: counts.offers.unresolved,
          tone: counts.offers.unresolved > 0 ? "warn" : undefined,
        },
        { label: "Existing", value: counts.offers.existing },
        { label: "Proposed create", value: counts.offers.proposedCreate, tone: "ok" },
        { label: "Duplicate records removed", value: counts.offers.duplicateRecordsRemoved },
        {
          label: "Quarantined",
          value: counts.offers.quarantined,
          tone: counts.offers.quarantined > 0 ? "warn" : undefined,
        },
      ],
    },
  ];
}
