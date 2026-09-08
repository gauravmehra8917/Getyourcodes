import {
  AdsPreviewPlanner,
  type AdsPreviewPlanResultV2,
  type AdsShadowPolicyConfigV2,
  type ExistingAdsCatalogSnapshotV2,
  ImpactAdsCampaignClient,
  ImpactAdsClient,
  type ImpactAdsFetchResultV2,
  type ImpactAdsTransportV2,
  type ImpactCampaignFetchResultForAdsV2,
} from "../_shared/affiliate-sync-v2-ads/index.ts";
import {
  assertImpactProvider,
  HostConfigurationError,
  parseImpactHostCredentials,
} from "../_shared/affiliate-sync-v2-host/impact-configuration.ts";
import type { ImpactHostCredentialsV2 } from "../_shared/affiliate-sync-v2-host/types.ts";
import {
  mapExistingAdsCatalogSnapshotV2,
  resolveAdsShadowPolicyConfigV2,
} from "./catalog-snapshot.ts";
import { resolveImpactAdsHostConfigV2 } from "./impact-ads-configuration.ts";
import type {
  AdsPreviewV2ErrorCode,
  AdsPreviewV2ErrorResponse,
  AdsPreviewV2HostDependencies,
  AdsPreviewV2RequestBody,
  AffiliateSyncAdsPreviewHostResponseV2,
  ResolvedImpactAdsHostConfigV2,
} from "./types.ts";
import { ADS_PREVIEW_HOST_VERSION_V2 } from "./types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_ADS_PREVIEW_ORIGINS = new Set([
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
]);
const ALLOWED_HEADERS = "authorization, apikey, content-type, x-client-info";
const ALLOWED_METHODS = "POST, OPTIONS";

const ERROR_MESSAGES: Record<AdsPreviewV2ErrorCode, string> = {
  origin_not_allowed: "This origin is not allowed.",
  method_not_allowed: "This endpoint accepts POST requests only.",
  invalid_request: "The Ads preview request is invalid.",
  unauthenticated: "Authentication is required.",
  unauthorized: "Administrator access is required.",
  integration_not_found: "The requested integration was not found.",
  integration_disabled: "The requested integration is disabled.",
  provider_not_impact:
    "The requested integration is not an Impact integration.",
  credentials_unavailable: "Impact credentials are unavailable.",
  invalid_integration_config: "The stored Impact configuration is invalid.",
  policy_read_failed: "The publishing policy could not be read safely.",
  catalog_snapshot_failed: "The store snapshot could not be read safely.",
  campaign_fetch_failed: "Impact Campaign evidence could not be completed.",
  provider_fetch_failed: "Impact Coupon Ads could not be fetched.",
  preview_plan_failed: "The Ads preview could not be planned safely.",
  internal_error: "The Ads preview could not be completed.",
};

function normalizedSiteOrigin(siteUrl: string | null): string | null {
  if (siteUrl === null) return null;
  try {
    const url = new URL(siteUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin === "null"
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function approvedOrigin(
  origin: string | null,
  siteUrl: string | null,
): boolean {
  if (!origin || origin === "null") return false;
  if (siteUrl === null) return LOCAL_ADS_PREVIEW_ORIGINS.has(origin);
  const siteOrigin = normalizedSiteOrigin(siteUrl);
  if (siteOrigin === null) return false;
  return origin === siteOrigin || LOCAL_ADS_PREVIEW_ORIGINS.has(origin);
}

function corsHeaders(origin: string | null, allowed: boolean): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed && origin ? origin : "null",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    Vary: "Origin",
  };
}

function jsonResponse(
  body:
    | AffiliateSyncAdsPreviewHostResponseV2
    | AdsPreviewV2ErrorResponse
    | null,
  status: number,
  origin: string | null,
  allowed: boolean,
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, allowed),
  });
}

function failed(
  code: AdsPreviewV2ErrorCode,
  status: number,
  origin: string | null,
  allowed: boolean,
): Response {
  return jsonResponse(
    {
      host: { version: ADS_PREVIEW_HOST_VERSION_V2, readOnly: true },
      error: { code, message: ERROR_MESSAGES[code] },
    },
    status,
    origin,
    allowed,
  );
}

function strictBearer(authorization: string): string | null {
  return authorization.match(/^Bearer ([^\s]+)$/)?.[1] ?? null;
}

function exactRequest(value: unknown): { integrationId: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2 || keys[0] !== "integrationId" || keys[1] !== "preview"
  ) return null;
  const body = value as AdsPreviewV2RequestBody;
  if (
    typeof body.integrationId !== "string" ||
    !UUID_PATTERN.test(body.integrationId) || body.preview !== true
  ) return null;
  return { integrationId: body.integrationId.toLowerCase() };
}

function configurationFailure(
  error: HostConfigurationError,
  origin: string | null,
): Response {
  return failed(error.code, 422, origin, true);
}

function exactEvaluationTimestamp(value: string): string | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === value ? value : null;
}

function campaignsAreTrustworthy(
  result: ImpactCampaignFetchResultForAdsV2,
): boolean {
  return result.diagnostics.complete &&
    result.diagnostics.stopReason === "completed" &&
    result.diagnostics.parseFailureReason === null &&
    result.diagnostics.quarantinedRecords === 0;
}

export function createAffiliateSyncAdsPreviewV2Handler(
  dependencies: AdsPreviewV2HostDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const originAllowed = approvedOrigin(origin, dependencies.siteUrl);
    if (!originAllowed) {
      return failed("origin_not_allowed", 403, origin, false);
    }
    if (request.method === "OPTIONS") {
      return jsonResponse(null, 204, origin, true);
    }
    if (request.method !== "POST") {
      return failed("method_not_allowed", 405, origin, true);
    }

    const authorization = request.headers.get("Authorization") ?? "";
    const jwt = strictBearer(authorization);
    if (jwt === null) return failed("unauthenticated", 401, origin, true);

    let user: { id: string } | null;
    try {
      user = await dependencies.verifyUser(authorization, jwt);
    } catch {
      return failed("unauthenticated", 401, origin, true);
    }
    if (!user || !UUID_PATTERN.test(user.id)) {
      return failed("unauthenticated", 401, origin, true);
    }

    let dataSource: ReturnType<
      AdsPreviewV2HostDependencies["createDataSource"]
    >;
    try {
      dataSource = dependencies.createDataSource();
      if (!await dataSource.hasAdminRole(user.id)) {
        return failed("unauthorized", 403, origin, true);
      }
    } catch {
      return failed("unauthorized", 403, origin, true);
    }

    let parsed: ReturnType<typeof exactRequest>;
    try {
      parsed = exactRequest(await request.json());
    } catch {
      parsed = null;
    }
    if (parsed === null) return failed("invalid_request", 400, origin, true);

    let integration: Awaited<ReturnType<typeof dataSource.readIntegration>>;
    try {
      integration = await dataSource.readIntegration(parsed.integrationId);
    } catch {
      return failed("internal_error", 500, origin, true);
    }
    if (integration === null) {
      return failed("integration_not_found", 404, origin, true);
    }
    if (
      !UUID_PATTERN.test(integration.id) ||
      integration.id.toLowerCase() !== parsed.integrationId
    ) return failed("invalid_integration_config", 422, origin, true);
    if (!integration.isEnabled) {
      return failed("integration_disabled", 409, origin, true);
    }
    try {
      assertImpactProvider(integration.providerName);
    } catch (error) {
      return error instanceof HostConfigurationError
        ? configurationFailure(error, origin)
        : failed("internal_error", 500, origin, true);
    }

    let policyRow: Awaited<ReturnType<typeof dataSource.readPublishingPolicy>>;
    try {
      policyRow = await dataSource.readPublishingPolicy(
        integration.publishingPolicyId,
      );
    } catch {
      return failed("policy_read_failed", 500, origin, true);
    }
    let policyConfig: AdsShadowPolicyConfigV2;
    try {
      policyConfig = resolveAdsShadowPolicyConfigV2(policyRow);
    } catch {
      return failed("policy_read_failed", 422, origin, true);
    }

    let existingCatalogSnapshot: ExistingAdsCatalogSnapshotV2;
    try {
      existingCatalogSnapshot = mapExistingAdsCatalogSnapshotV2(
        await dataSource.readImpactStoreIdentityRows(),
      );
    } catch {
      return failed("catalog_snapshot_failed", 500, origin, true);
    }

    const evaluationTimestamp = exactEvaluationTimestamp(dependencies.now());
    if (evaluationTimestamp === null) {
      return failed("internal_error", 500, origin, true);
    }

    let credentials: ImpactHostCredentialsV2;
    try {
      const ciphertext = await dataSource.readCredentialCiphertext(
        integration.id,
      );
      if (ciphertext === null) {
        throw new HostConfigurationError("credentials_unavailable");
      }
      credentials = parseImpactHostCredentials(
        await dependencies.decryptCredentialEnvelope(ciphertext),
      );
    } catch (error) {
      return error instanceof HostConfigurationError
        ? configurationFailure(error, origin)
        : failed("credentials_unavailable", 422, origin, true);
    }

    let resolved: ResolvedImpactAdsHostConfigV2;
    try {
      resolved = resolveImpactAdsHostConfigV2(integration, credentials);
    } catch (error) {
      return error instanceof HostConfigurationError
        ? configurationFailure(error, origin)
        : failed("invalid_integration_config", 422, origin, true);
    }

    let transport: ImpactAdsTransportV2;
    try {
      transport = dependencies.createImpactTransport(
        credentials,
        resolved.baseUrl,
      );
    } catch {
      return failed("provider_fetch_failed", 502, origin, true);
    }

    let campaignFetch: ImpactCampaignFetchResultForAdsV2;
    try {
      campaignFetch = await new ImpactAdsCampaignClient({
        transport,
        continuationPolicy: resolved.continuationPolicy,
        requestTimeoutMs: resolved.requestTimeoutMs,
        limits: resolved.campaignLimits,
      }).fetch(resolved.campaignsInitialUrl, request.signal);
    } catch {
      return failed("campaign_fetch_failed", 502, origin, true);
    }

    let adsFetch: ImpactAdsFetchResultV2 | null = null;
    if (campaignsAreTrustworthy(campaignFetch)) {
      try {
        adsFetch = await new ImpactAdsClient({
          transport,
          continuationPolicy: resolved.continuationPolicy,
          requestTimeoutMs: resolved.requestTimeoutMs,
          limits: resolved.adsLimits,
        }).fetch(resolved.adsInitialUrl, request.signal);
      } catch {
        return failed("provider_fetch_failed", 502, origin, true);
      }
    }

    let result: AdsPreviewPlanResultV2;
    try {
      result = AdsPreviewPlanner.plan({
        campaignFetch,
        adsFetch,
        existingCatalogSnapshot,
        policyConfig,
        evaluationTimestamp,
      });
    } catch {
      return failed("preview_plan_failed", 502, origin, true);
    }

    return jsonResponse(
      {
        host: {
          version: ADS_PREVIEW_HOST_VERSION_V2,
          readOnly: true,
          integrationId: parsed.integrationId,
          existingOfferMatching: "not_evaluated",
        },
        result,
      },
      200,
      origin,
      true,
    );
  };
}
