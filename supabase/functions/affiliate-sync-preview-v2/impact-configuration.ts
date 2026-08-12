import type {
  ImpactHostCredentialsV2,
  ResolvedImpactHostConfigV2,
  StoredIntegrationV2,
  StoredPublishingPolicyV2,
} from "./types.ts";

const DEFAULT_PROMOTIONS_ENDPOINT = "/Mediapartners/{AccountSID}/Promotions";
const DEFAULT_CAMPAIGNS_ENDPOINT = "/Mediapartners/{AccountSID}/Campaigns";

export class HostConfigurationError extends Error {
  readonly code:
    | "provider_not_impact"
    | "credentials_unavailable"
    | "invalid_integration_config";

  constructor(code: HostConfigurationError["code"]) {
    super(code);
    this.name = "HostConfigurationError";
    this.code = code;
  }
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function exactCredentialValue(
  parsed: Record<string, unknown>,
  primary: string,
  compatible: string,
): string | null {
  const first = nonEmptyText(parsed[primary]);
  const second = nonEmptyText(parsed[compatible]);
  if (first && second && first !== second) {
    throw new HostConfigurationError("credentials_unavailable");
  }
  return first ?? second;
}

export function parseImpactHostCredentials(
  plaintext: string,
): ImpactHostCredentialsV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new HostConfigurationError("credentials_unavailable");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HostConfigurationError("credentials_unavailable");
  }
  const record = parsed as Record<string, unknown>;
  const accountSid = exactCredentialValue(record, "accountSid", "username");
  const authToken = exactCredentialValue(record, "authToken", "password");
  if (!accountSid || !authToken) {
    throw new HostConfigurationError("credentials_unavailable");
  }
  return { accountSid, authToken };
}

export function assertImpactProvider(value: string): void {
  if (
    !["impact", "impact.com", "impact radius"].includes(
      value.trim().toLowerCase(),
    )
  ) {
    throw new HostConfigurationError("provider_not_impact");
  }
}

function nonNegativeInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

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

function endpointValue(
  endpoints: Record<string, unknown>,
  keys: readonly string[],
  fallback: string,
): string {
  for (const key of keys) {
    if (!(key in endpoints)) continue;
    if (
      endpoints[key] !== null && endpoints[key] !== undefined &&
      typeof endpoints[key] !== "string"
    ) throw new HostConfigurationError("invalid_integration_config");
    const value = nonEmptyText(endpoints[key]);
    if (value) return value;
  }
  return fallback;
}

function stripGetPrefix(value: string): string {
  const match = value.match(/^([A-Za-z]+)\s+(\S.*)$/);
  if (!match) return value;
  if (match[1]!.toUpperCase() !== "GET") {
    throw new HostConfigurationError("invalid_integration_config");
  }
  return match[2]!.trim();
}

function resolveEndpoint(
  rawEndpoint: string,
  base: URL,
  accountSid: string,
  pageSize: number,
  collection: "Promotions" | "Campaigns",
): string {
  const endpoint = stripGetPrefix(rawEndpoint);
  const placeholders = [...endpoint.matchAll(/\{([^}]+)\}/g)].map((match) =>
    match[1]
  );
  if (
    !placeholders.includes("AccountSID") ||
    placeholders.some((name) => name !== "AccountSID")
  ) {
    throw new HostConfigurationError("invalid_integration_config");
  }
  const resolved = endpoint.replaceAll(
    "{AccountSID}",
    encodeURIComponent(accountSid),
  );
  let url: URL;
  try {
    url = new URL(resolved, base);
  } catch {
    throw new HostConfigurationError("invalid_integration_config");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    url.hash
  ) throw new HostConfigurationError("invalid_integration_config");
  const pathSegments = url.pathname.split("/").filter(Boolean).map(
    (segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw new HostConfigurationError("invalid_integration_config");
      }
    },
  );
  if (
    pathSegments.length !== 3 ||
    pathSegments[0] !== "Mediapartners" ||
    pathSegments[1] !== accountSid ||
    pathSegments[2] !== collection
  ) throw new HostConfigurationError("invalid_integration_config");
  if (!url.searchParams.has("Page")) url.searchParams.set("Page", "1");
  if (!url.searchParams.has("PageSize")) {
    url.searchParams.set("PageSize", String(pageSize));
  }
  return url.toString();
}

function approvedBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HostConfigurationError("invalid_integration_config");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) throw new HostConfigurationError("invalid_integration_config");
  return url;
}

function policyConfig(policy: StoredPublishingPolicyV2 | null): {
  publishingPolicyConfig: ResolvedImpactHostConfigV2["publishingPolicyConfig"];
  storeQualificationConfig:
    ResolvedImpactHostConfigV2["storeQualificationConfig"];
} {
  if (!policy || !policy.enabled) {
    return {
      publishingPolicyConfig: { maxCouponsPerStore: 0, maxDealsPerStore: 0 },
      storeQualificationConfig: {
        minimumSelectedCoupons: 0,
        minimumSelectedDeals: 0,
        minimumTotalSelectedOffers: 0,
      },
    };
  }
  return {
    publishingPolicyConfig: {
      maxCouponsPerStore: nonNegativeInteger(policy.maximumCouponsPerStore, 0),
      maxDealsPerStore: nonNegativeInteger(policy.maximumDealsPerStore, 0),
    },
    storeQualificationConfig: {
      minimumSelectedCoupons: nonNegativeInteger(
        policy.minimumCouponsPerStore,
        0,
      ),
      minimumSelectedDeals: nonNegativeInteger(policy.minimumDealsPerStore, 0),
      // The stored V1 policy has no independent total-minimum field.
      minimumTotalSelectedOffers: 0,
    },
  };
}

export function resolveImpactHostConfig(
  integration: StoredIntegrationV2,
  credentials: ImpactHostCredentialsV2,
  policy: StoredPublishingPolicyV2 | null,
): ResolvedImpactHostConfigV2 {
  assertImpactProvider(integration.providerName);
  if (integration.authenticationType.trim().toLowerCase() !== "basic") {
    throw new HostConfigurationError("invalid_integration_config");
  }
  const base = approvedBaseUrl(integration.baseUrl);
  const pageSize = positiveInteger(integration.pageSize, 100, 500);
  const configuredPages = positiveInteger(integration.maxPages, 50, 500);
  const attempts = Math.min(
    21,
    nonNegativeInteger(integration.retryAttempts, 0) + 1,
  );
  const promotions = endpointValue(
    integration.endpointConfiguration,
    ["promotions", "deals", "coupons"],
    DEFAULT_PROMOTIONS_ENDPOINT,
  );
  const campaigns = endpointValue(
    integration.endpointConfiguration,
    ["campaigns", "stores", "advertisers"],
    DEFAULT_CAMPAIGNS_ENDPOINT,
  );
  const configs = policyConfig(policy);
  return {
    baseUrl: base.origin,
    promotionsInitialUrl: resolveEndpoint(
      promotions,
      base,
      credentials.accountSid,
      pageSize,
      "Promotions",
    ),
    campaignsInitialUrl: resolveEndpoint(
      campaigns,
      base,
      credentials.accountSid,
      pageSize,
      "Campaigns",
    ),
    continuationPolicy: {
      approvedBaseUrl: base.origin,
      allowedOrigins: [base.origin],
      accountSidPathSegments: [credentials.accountSid],
    },
    limits: {
      maxPages: configuredPages,
      maxRecords: Math.min(250_000, pageSize * configuredPages),
      maxResponseBytes: 5 * 1024 * 1024,
      maxAttempts: attempts,
      baseBackoffMs: 500,
      maxBackoffMs: 30_000,
      maxRetryAfterMs: 60_000,
    },
    requestTimeoutMs: Math.min(
      600_000,
      Math.max(
        1_000,
        positiveInteger(integration.timeoutSeconds, 30, 600) * 1_000,
      ),
    ),
    ...configs,
  };
}
