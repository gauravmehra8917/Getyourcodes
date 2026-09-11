import {
  DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2,
} from "../_shared/affiliate-sync-v2-ads/index.ts";
import {
  assertImpactProvider,
  HostConfigurationError,
} from "../_shared/affiliate-sync-v2-host/impact-configuration.ts";
import type {
  ImpactHostCredentialsV2,
  StoredIntegrationV2,
} from "../_shared/affiliate-sync-v2-host/types.ts";
import type { ResolvedImpactAdsApplyHostConfigV2 } from "./types.ts";

const DEFAULT_CAMPAIGNS_ENDPOINT = "/Mediapartners/{AccountSID}/Campaigns";
const CAMPAIGN_DEFAULT_PAGE_SIZE = 100;
const CAMPAIGN_DEFAULT_MAX_PAGES = 50;
const CAMPAIGN_MAX_PAGES = 500;
const CAMPAIGN_MAX_RECORDS = 250_000;
const MAX_ATTEMPTS = 21;

function positiveInteger(
  value: number | null,
  fallback: number,
  maximum: number,
): number {
  return value !== null && Number.isInteger(value) && value > 0 &&
      value <= maximum
    ? value
    : fallback;
}

function nonnegativeInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function approvedBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HostConfigurationError("invalid_integration_config");
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.search ||
    url.hash || url.pathname !== "/"
  ) {
    throw new HostConfigurationError("invalid_integration_config");
  }
  return url;
}

function nonemptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function configuredCampaignEndpoint(
  endpoints: Record<string, unknown>,
): string {
  for (const key of ["campaigns", "stores", "advertisers"] as const) {
    if (!(key in endpoints)) continue;
    const raw = endpoints[key];
    if (raw !== null && raw !== undefined && typeof raw !== "string") {
      throw new HostConfigurationError("invalid_integration_config");
    }
    const value = nonemptyText(raw);
    if (value) return value;
  }
  return DEFAULT_CAMPAIGNS_ENDPOINT;
}

function stripGetPrefix(value: string): string {
  const match = value.match(/^([A-Za-z]+)\s+(\S.*)$/);
  if (!match) return value;
  if (match[1]!.toUpperCase() !== "GET") {
    throw new HostConfigurationError("invalid_integration_config");
  }
  return match[2]!.trim();
}

function campaignsUrl(
  endpoints: Record<string, unknown>,
  base: URL,
  accountSid: string,
  pageSize: number,
): string {
  const endpoint = stripGetPrefix(configuredCampaignEndpoint(endpoints));
  const placeholders = [...endpoint.matchAll(/\{([^}]+)\}/g)].map((match) =>
    match[1]
  );
  if (
    !placeholders.includes("AccountSID") ||
    placeholders.some((name) => name !== "AccountSID")
  ) {
    throw new HostConfigurationError("invalid_integration_config");
  }
  let url: URL;
  try {
    url = new URL(
      endpoint.replaceAll("{AccountSID}", encodeURIComponent(accountSid)),
      base,
    );
  } catch {
    throw new HostConfigurationError("invalid_integration_config");
  }
  if (
    url.protocol !== "https:" || url.origin !== base.origin || url.username ||
    url.password || url.hash
  ) {
    throw new HostConfigurationError("invalid_integration_config");
  }
  let segments: string[];
  try {
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new HostConfigurationError("invalid_integration_config");
  }
  if (
    segments.length !== 3 || segments[0] !== "Mediapartners" ||
    segments[1] !== accountSid || segments[2] !== "Campaigns"
  ) {
    throw new HostConfigurationError("invalid_integration_config");
  }
  if (!url.searchParams.has("Page")) url.searchParams.set("Page", "1");
  if (!url.searchParams.has("PageSize")) {
    url.searchParams.set("PageSize", String(pageSize));
  }
  const pages = [...url.searchParams.entries()].filter(([key]) =>
    key.toLowerCase() === "page"
  );
  const sizes = [...url.searchParams.entries()].filter(([key]) =>
    key.toLowerCase() === "pagesize"
  );
  if (
    pages.length !== 1 || pages[0]?.[0] !== "Page" || pages[0]?.[1] !== "1" ||
    sizes.length !== 1 || sizes[0]?.[0] !== "PageSize" ||
    sizes[0]?.[1] !== String(pageSize)
  ) {
    throw new HostConfigurationError("invalid_integration_config");
  }
  return url.toString();
}

function adsUrl(base: URL, accountSid: string): string {
  const url = new URL(
    `/Mediapartners/${encodeURIComponent(accountSid)}/Ads`,
    base,
  );
  url.searchParams.set("Type", "COUPON");
  url.searchParams.set("Page", "1");
  url.searchParams.set(
    "PageSize",
    String(DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2.pageSize),
  );
  return url.toString();
}

/** Resolves only the proven global Coupon Ads and exact Campaign endpoints. */
export function resolveImpactAdsApplyHostConfigV2(
  integration: StoredIntegrationV2,
  credentials: ImpactHostCredentialsV2,
): ResolvedImpactAdsApplyHostConfigV2 {
  assertImpactProvider(integration.providerName);
  if (integration.authenticationType.trim().toLowerCase() !== "basic") {
    throw new HostConfigurationError("invalid_integration_config");
  }
  const base = approvedBaseUrl(integration.baseUrl);
  const campaignPageSize = positiveInteger(
    integration.pageSize,
    CAMPAIGN_DEFAULT_PAGE_SIZE,
    500,
  );
  const campaignMaxPages = positiveInteger(
    integration.maxPages,
    CAMPAIGN_DEFAULT_MAX_PAGES,
    CAMPAIGN_MAX_PAGES,
  );
  const adsAttempts = Math.min(
    MAX_ATTEMPTS,
    nonnegativeInteger(integration.retryAttempts, 0) + 1,
  );
  return {
    baseUrl: base.origin,
    adsInitialUrl: adsUrl(base, credentials.accountSid),
    campaignsInitialUrl: campaignsUrl(
      integration.endpointConfiguration,
      base,
      credentials.accountSid,
      campaignPageSize,
    ),
    continuationPolicy: {
      approvedBaseUrl: base.origin,
      allowedOrigins: [base.origin],
      accountSidPathSegments: [credentials.accountSid],
    },
    requestTimeoutMs: Math.min(
      600_000,
      Math.max(
        1_000,
        positiveInteger(integration.timeoutSeconds, 30, 600) * 1_000,
      ),
    ),
    campaignLimits: {
      pageSize: campaignPageSize,
      maxPages: campaignMaxPages,
      maxRecords: Math.min(
        CAMPAIGN_MAX_RECORDS,
        campaignPageSize * campaignMaxPages,
      ),
      maxPhysicalRequests: campaignMaxPages,
      maxResponseBytes: DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2.maxResponseBytes,
      maxAttemptsPerPage: 1,
      baseBackoffMs: DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2.baseBackoffMs,
      maxBackoffMs: DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2.maxBackoffMs,
      maxRetryAfterMs: DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2.maxRetryAfterMs,
      rateRemainingFloor: DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2.rateRemainingFloor,
    },
    adsLimits: {
      ...DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2,
      maxAttemptsPerPage: adsAttempts,
    },
  };
}
