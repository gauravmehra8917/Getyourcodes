import type {
  ImpactTransportResult,
} from "../_shared/affiliate-sync-v2/contracts.ts";
import type { ImpactContinuationPolicy } from "../_shared/affiliate-sync-v2/impact-url-safety.ts";
import { validateImpactContinuation } from "../_shared/affiliate-sync-v2/impact-url-safety.ts";
import type { RawImpactCampaignV2 } from "../_shared/affiliate-sync-v2/models.ts";
import { AUDIT_MAX_RESPONSE_BYTES } from "./ImpactAuditTransportHost.ts";
import {
  ImpactAdsPageParser,
  type RawImpactCouponAdV2,
} from "./ImpactAdsPageParser.ts";
import type {
  CampaignAdvertiserIndexV2,
  CouponAdsAuditStopReasonV2,
  CouponAdsCoverageAuditV2,
  CouponCodeShapeCountsV2,
  CouponCodeShapeV2,
  ImpactAuditTransportV2,
} from "./types.ts";

export const COUPON_ADS_PAGE_SIZE = 100;
export const COUPON_ADS_MAX_PAGES = 25;
export const COUPON_ADS_MAX_PHYSICAL_REQUESTS = 35;
export const COUPON_ADS_RATE_REMAINING_FLOOR = 10;

const RETRYABLE_STATUSES = new Set([408, 425, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRY_AFTER_MS = 60_000;

interface ImpactCouponAdsAuditClientOptionsV2 {
  transport: ImpactAuditTransportV2;
  continuationPolicy: ImpactContinuationPolicy;
  requestTimeoutMs: number;
  maxAttemptsPerPage: number;
}

interface ScopedRequestSignal {
  signal: AbortSignal;
  isTimedOut(): boolean;
  isCallerCancelled(): boolean;
  cleanup(): void;
}

type PageRequestOutcome =
  | { ok: true; bodyText: string }
  | { ok: false; stopReason: CouponAdsAuditStopReasonV2 };

interface MutableAuditState {
  pagesFetched: number;
  physicalRequests: number;
  rawRecords: number;
  acceptedRecords: number;
  quarantinedRecords: number;
  missingAdId: number;
  missingCampaignId: number;
  missingAdvertiserId: number;
  campaignAdvertiserCrossCheckAvailable: number;
  campaignAdvertiserConflicts: number;
  withDealId: number;
  withoutDealId: number;
  withTrackingLink: number;
  withLandingPageUrl: number;
  withStartDate: number;
  withEndDate: number;
  code: CouponCodeShapeCountsV2;
  dealDefaultPromoCode: CouponCodeShapeCountsV2;
  adIds: Set<string>;
  campaignIds: Set<string>;
  advertiserIds: Set<string>;
  campaignIdsFound: Set<string>;
  campaignIdsMissing: Set<string>;
  dealAds: Map<string, Set<string>>;
}

function scopedSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): ScopedRequestSignal {
  const controller = new AbortController();
  let timedOut = false;
  let callerCancelled = callerSignal?.aborted === true;
  const onAbort = () => {
    callerCancelled = true;
    controller.abort();
  };
  if (callerSignal) {
    callerSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(0, timeoutMs));
  if (callerCancelled) controller.abort();
  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    isCallerCancelled: () => callerCancelled,
    cleanup: () => {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener("abort", onAbort);
    },
  };
}

function emptyShapeCounts(): CouponCodeShapeCountsV2 {
  return {
    missing: 0,
    null: 0,
    emptyOrWhitespaceString: 0,
    nonemptyString: 0,
    otherShape: 0,
  };
}

function emptyState(): MutableAuditState {
  return {
    pagesFetched: 0,
    physicalRequests: 0,
    rawRecords: 0,
    acceptedRecords: 0,
    quarantinedRecords: 0,
    missingAdId: 0,
    missingCampaignId: 0,
    missingAdvertiserId: 0,
    campaignAdvertiserCrossCheckAvailable: 0,
    campaignAdvertiserConflicts: 0,
    withDealId: 0,
    withoutDealId: 0,
    withTrackingLink: 0,
    withLandingPageUrl: 0,
    withStartDate: 0,
    withEndDate: 0,
    code: emptyShapeCounts(),
    dealDefaultPromoCode: emptyShapeCounts(),
    adIds: new Set(),
    campaignIds: new Set(),
    advertiserIds: new Set(),
    campaignIdsFound: new Set(),
    campaignIdsMissing: new Set(),
    dealAds: new Map(),
  };
}

function observeShape(
  counts: CouponCodeShapeCountsV2,
  shape: CouponCodeShapeV2,
): void {
  counts[shape] += 1;
}

function observeAd(
  state: MutableAuditState,
  ad: RawImpactCouponAdV2,
  campaigns: CampaignAdvertiserIndexV2,
): void {
  state.adIds.add(ad.adId);
  if (ad.campaignId === null) {
    state.missingCampaignId += 1;
  } else {
    state.campaignIds.add(ad.campaignId);
    const campaignAdvertisers = campaigns.get(ad.campaignId);
    if (campaignAdvertisers === undefined) {
      state.campaignIdsMissing.add(ad.campaignId);
    } else {
      state.campaignIdsFound.add(ad.campaignId);
      if (ad.advertiserId !== null && campaignAdvertisers.size > 0) {
        state.campaignAdvertiserCrossCheckAvailable += 1;
        if (
          campaignAdvertisers.size !== 1 ||
          !campaignAdvertisers.has(ad.advertiserId)
        ) {
          state.campaignAdvertiserConflicts += 1;
        }
      }
    }
  }
  if (ad.advertiserId === null) state.missingAdvertiserId += 1;
  else state.advertiserIds.add(ad.advertiserId);

  if (ad.dealId === null) {
    state.withoutDealId += 1;
  } else {
    state.withDealId += 1;
    let adIds = state.dealAds.get(ad.dealId);
    if (!adIds) {
      adIds = new Set<string>();
      state.dealAds.set(ad.dealId, adIds);
    }
    adIds.add(ad.adId);
  }
  if (ad.trackingLink !== null) state.withTrackingLink += 1;
  if (ad.landingPageUrl !== null) state.withLandingPageUrl += 1;
  if (ad.startDate !== null) state.withStartDate += 1;
  if (ad.endDate !== null) state.withEndDate += 1;
  observeShape(state.code, ad.codeShape);
  observeShape(state.dealDefaultPromoCode, ad.dealDefaultPromoCodeShape);
}

function responseByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function exactInitialAdsRequest(
  value: string,
  policy: ImpactContinuationPolicy,
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const accountSids = policy.accountSidPathSegments ?? [];
  if (accountSids.length !== 1) return false;
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return "";
    }
  });
  if (
    segments.length !== 3 || segments[0] !== "Mediapartners" ||
    segments[1] !== accountSids[0] || segments[2] !== "Ads"
  ) return false;
  const entries = [...url.searchParams.entries()];
  return entries.length === 3 &&
    url.searchParams.getAll("Type").length === 1 &&
    url.searchParams.get("Type") === "COUPON" &&
    url.searchParams.getAll("Page").length === 1 &&
    url.searchParams.get("Page") === "1" &&
    url.searchParams.getAll("PageSize").length === 1 &&
    url.searchParams.get("PageSize") === String(COUPON_ADS_PAGE_SIZE);
}

function finalAudit(
  state: MutableAuditState,
  stopReason: CouponAdsAuditStopReasonV2,
  transport: ImpactAuditTransportV2,
): CouponAdsCoverageAuditV2 {
  let dealIdsWithOneAd = 0;
  let dealIdsWithMultipleAds = 0;
  let maxAdsPerDeal = 0;
  for (const adIds of state.dealAds.values()) {
    if (adIds.size === 1) dealIdsWithOneAd += 1;
    else if (adIds.size > 1) dealIdsWithMultipleAds += 1;
    maxAdsPerDeal = Math.max(maxAdsPerDeal, adIds.size);
  }
  const distinctCampaignIds = state.campaignIds.size;
  const distinctAdvertiserIds = state.advertiserIds.size;
  return {
    complete: stopReason === "completed",
    stopReason,
    pagesFetched: state.pagesFetched,
    physicalRequests: state.physicalRequests,
    rawRecords: state.rawRecords,
    acceptedRecords: state.acceptedRecords,
    quarantinedRecords: state.quarantinedRecords,
    identity: {
      distinctAdIds: state.adIds.size,
      missingAdId: state.missingAdId,
      duplicateAdIdRecords: state.acceptedRecords - state.adIds.size,
      distinctCampaignIds,
      missingCampaignId: state.missingCampaignId,
      campaignIdsFoundInCampaignIndex: state.campaignIdsFound.size,
      campaignIdsMissingFromCampaignIndex: state.campaignIdsMissing.size,
      distinctAdvertiserIds,
      missingAdvertiserId: state.missingAdvertiserId,
      campaignAdvertiserCrossCheckAvailable:
        state.campaignAdvertiserCrossCheckAvailable,
      campaignAdvertiserConflicts: state.campaignAdvertiserConflicts,
    },
    merchantCoverage: { distinctCampaignIds, distinctAdvertiserIds },
    offerShape: {
      withDealId: state.withDealId,
      distinctDealIds: state.dealAds.size,
      withoutDealId: state.withoutDealId,
      withTrackingLink: state.withTrackingLink,
      withLandingPageUrl: state.withLandingPageUrl,
      withStartDate: state.withStartDate,
      withEndDate: state.withEndDate,
      dealDefaultPromoCode: { ...state.dealDefaultPromoCode },
      code: { ...state.code },
    },
    dealCardinality: {
      dealIdsWithOneAd,
      dealIdsWithMultipleAds,
      maxAdsPerDeal,
    },
    rate: transport.readRateSnapshot(),
  };
}

export function buildCampaignAdvertiserIndexV2(
  campaigns: readonly RawImpactCampaignV2[],
): CampaignAdvertiserIndexV2 {
  const index = new Map<string, Set<string>>();
  for (const campaign of campaigns) {
    if (campaign.campaignId === null) continue;
    let advertisers = index.get(campaign.campaignId);
    if (!advertisers) {
      advertisers = new Set<string>();
      index.set(campaign.campaignId, advertisers);
    }
    if (campaign.advertiserId !== null) advertisers.add(campaign.advertiserId);
  }
  return index;
}

/** Ads-only retrieval and aggregate analysis. No raw record leaves this class. */
export class ImpactCouponAdsAuditClient {
  private readonly options: ImpactCouponAdsAuditClientOptionsV2;

  constructor(options: ImpactCouponAdsAuditClientOptionsV2) {
    this.options = options;
  }

  private backoffDelay(
    response: Extract<ImpactTransportResult, { kind: "response" }>,
    attempt: number,
  ): number {
    if (response.retryAfterMs !== null) {
      return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, response.retryAfterMs));
    }
    return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** (attempt - 1)));
  }

  private async requestPage(
    state: MutableAuditState,
    url: string,
    credentialDisposition: "attach_if_same_origin" | "omit",
    signal: AbortSignal | undefined,
  ): Promise<PageRequestOutcome> {
    let attempts = 0;
    while (attempts < this.options.maxAttemptsPerPage) {
      if (signal?.aborted) return { ok: false, stopReason: "cancelled" };
      if (state.physicalRequests >= COUPON_ADS_MAX_PHYSICAL_REQUESTS) {
        return { ok: false, stopReason: "physical_request_limit" };
      }
      attempts += 1;
      state.physicalRequests += 1;
      const scoped = scopedSignal(signal, this.options.requestTimeoutMs);
      let result: ImpactTransportResult;
      try {
        result = await this.options.transport.execute({
          method: "GET",
          url,
          credentialDisposition,
          redirect: "error",
          signal: scoped.signal,
        });
      } catch {
        scoped.cleanup();
        return {
          ok: false,
          stopReason: signal?.aborted ? "cancelled" : "transport_error",
        };
      }
      const timedOut = scoped.isTimedOut();
      const callerCancelled = scoped.isCallerCancelled();
      scoped.cleanup();
      const responseSizeExceeded = this.options.transport
        .consumeResponseSizeLimitExceeded();
      if (responseSizeExceeded) {
        return { ok: false, stopReason: "response_size_limit" };
      }
      if (callerCancelled) return { ok: false, stopReason: "cancelled" };
      if (timedOut) return { ok: false, stopReason: "timeout" };
      if (result.kind !== "response") {
        if (result.kind === "timeout") {
          return { ok: false, stopReason: "timeout" };
        }
        if (result.kind === "aborted") {
          return { ok: false, stopReason: "cancelled" };
        }
        return { ok: false, stopReason: "transport_error" };
      }
      if (result.status >= 200 && result.status < 300) {
        return { ok: true, bodyText: result.bodyText };
      }
      if (result.status === 429) {
        return { ok: false, stopReason: "rate_limited" };
      }
      if (
        !RETRYABLE_STATUSES.has(result.status) ||
        attempts >= this.options.maxAttemptsPerPage
      ) return { ok: false, stopReason: "provider_error" };
      const remaining = this.options.transport.readRateSnapshot().remaining;
      if (
        remaining !== null && remaining <= COUPON_ADS_RATE_REMAINING_FLOOR
      ) return { ok: false, stopReason: "rate_limit_threshold" };
      if (state.physicalRequests >= COUPON_ADS_MAX_PHYSICAL_REQUESTS) {
        return { ok: false, stopReason: "physical_request_limit" };
      }
      try {
        await this.options.transport.wait(
          this.backoffDelay(result, attempts),
          signal,
        );
      } catch {
        return {
          ok: false,
          stopReason: signal?.aborted ? "cancelled" : "transport_error",
        };
      }
    }
    return { ok: false, stopReason: "provider_error" };
  }

  async audit(
    initialUrl: string,
    campaigns: CampaignAdvertiserIndexV2,
    signal?: AbortSignal,
  ): Promise<CouponAdsCoverageAuditV2> {
    const state = emptyState();
    const initial = validateImpactContinuation(
      initialUrl,
      this.options.continuationPolicy,
    );
    if (
      !initial.ok ||
      !exactInitialAdsRequest(initialUrl, this.options.continuationPolicy)
    ) {
      return finalAudit(state, "invalid_continuation", this.options.transport);
    }
    let current = {
      url: initial.url,
      credentialDisposition: initial.credentialDisposition,
    };
    const seen = new Set([initial.url]);

    while (true) {
      const requested = await this.requestPage(
        state,
        current.url,
        current.credentialDisposition,
        signal,
      );
      if (!requested.ok) {
        return finalAudit(state, requested.stopReason, this.options.transport);
      }
      state.pagesFetched += 1;
      if (responseByteLength(requested.bodyText) > AUDIT_MAX_RESPONSE_BYTES) {
        return finalAudit(state, "response_size_limit", this.options.transport);
      }
      const parsed = ImpactAdsPageParser.parse(requested.bodyText);
      if (!parsed.ok) {
        return finalAudit(state, "malformed_page", this.options.transport);
      }
      state.rawRecords += parsed.rawRecordCount;
      state.acceptedRecords += parsed.records.length;
      state.missingAdId += parsed.quarantineCounts.missing_ad_id;
      state.quarantinedRecords += parsed.quarantineCounts.malformed_record +
        parsed.quarantineCounts.missing_ad_id;
      for (const ad of parsed.records) observeAd(state, ad, campaigns);

      if (parsed.nextContinuationUri === null) {
        return finalAudit(state, "completed", this.options.transport);
      }
      const continuation = validateImpactContinuation(
        parsed.nextContinuationUri,
        this.options.continuationPolicy,
      );
      if (!continuation.ok) {
        return finalAudit(
          state,
          "invalid_continuation",
          this.options.transport,
        );
      }
      if (seen.has(continuation.url)) {
        return finalAudit(state, "continuation_loop", this.options.transport);
      }
      seen.add(continuation.url);
      if (state.pagesFetched >= COUPON_ADS_MAX_PAGES) {
        return finalAudit(state, "page_limit", this.options.transport);
      }
      const remaining = this.options.transport.readRateSnapshot().remaining;
      if (
        remaining !== null && remaining <= COUPON_ADS_RATE_REMAINING_FLOOR
      ) {
        return finalAudit(
          state,
          "rate_limit_threshold",
          this.options.transport,
        );
      }
      if (state.physicalRequests >= COUPON_ADS_MAX_PHYSICAL_REQUESTS) {
        return finalAudit(
          state,
          "physical_request_limit",
          this.options.transport,
        );
      }
      current = {
        url: continuation.url,
        credentialDisposition: continuation.credentialDisposition,
      };
    }
  }
}
