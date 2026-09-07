import {
  resolveImpactHostConfig,
} from "../_shared/affiliate-sync-v2-host/impact-configuration.ts";
import type {
  ImpactHostCredentialsV2,
  StoredIntegrationV2,
} from "../_shared/affiliate-sync-v2-host/types.ts";
import type { ResolvedCouponAdsAuditConfigV2 } from "./types.ts";

const ADS_PAGE_SIZE = 100;

function couponAdsInitialUrl(
  approvedBaseUrl: string,
  accountSid: string,
): string {
  const url = new URL(
    `/Mediapartners/${encodeURIComponent(accountSid)}/Ads`,
    approvedBaseUrl,
  );
  url.searchParams.set("Type", "COUPON");
  url.searchParams.set("Page", "1");
  url.searchParams.set("PageSize", String(ADS_PAGE_SIZE));
  return url.toString();
}

/**
 * Reuses the settled V2 Impact integration validation and Campaign endpoint,
 * while constructing the Ads resource entirely inside the trusted host.
 */
export function resolveCouponAdsAuditConfigV2(
  integration: StoredIntegrationV2,
  credentials: ImpactHostCredentialsV2,
): ResolvedCouponAdsAuditConfigV2 {
  const resolved = resolveImpactHostConfig(integration, credentials, null);
  return {
    baseUrl: resolved.baseUrl,
    adsInitialUrl: couponAdsInitialUrl(
      resolved.baseUrl,
      credentials.accountSid,
    ),
    campaignsInitialUrl: resolved.campaignsInitialUrl,
    continuationPolicy: resolved.continuationPolicy,
    requestTimeoutMs: resolved.requestTimeoutMs,
    campaignLimits: {
      ...resolved.limits,
      // A read-only evidence probe must never retry a Campaigns 429 response.
      maxAttempts: 1,
    },
    adsMaxAttemptsPerPage: resolved.limits.maxAttempts,
  };
}
