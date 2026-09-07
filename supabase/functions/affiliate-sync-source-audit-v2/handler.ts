import { ImpactClientV2 } from "../_shared/affiliate-sync-v2/ImpactClientV2.ts";
import type { ImpactStreamFetchResultV2 } from "../_shared/affiliate-sync-v2/ImpactClientV2.ts";
import type { ImpactTransport } from "../_shared/affiliate-sync-v2/contracts.ts";
import type { RawImpactCampaignV2 } from "../_shared/affiliate-sync-v2/models.ts";
import {
  assertImpactProvider,
  HostConfigurationError,
  parseImpactHostCredentials,
} from "../_shared/affiliate-sync-v2-host/impact-configuration.ts";
import {
  buildCampaignAdvertiserIndexV2,
  COUPON_ADS_RATE_REMAINING_FLOOR,
  ImpactCouponAdsAuditClient,
} from "./ImpactCouponAdsAuditClient.ts";
import { resolveCouponAdsAuditConfigV2 } from "./impact-audit-configuration.ts";
import type {
  CouponAdsCoverageAuditV2,
  CouponAdsCoverageHostResponseV2,
  ImpactAuditTransportV2,
  ResolvedCouponAdsAuditConfigV2,
  SourceAuditV2ErrorCode,
  SourceAuditV2ErrorResponse,
  SourceAuditV2HostDependencies,
  SourceAuditV2RequestBody,
} from "./types.ts";
import type { ImpactHostCredentialsV2 } from "../_shared/affiliate-sync-v2-host/types.ts";
import { COUPON_ADS_AUDIT_MODE, SOURCE_AUDIT_VERSION_V2 } from "./types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_AUDIT_ORIGINS = new Set([
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
]);
const ALLOWED_HEADERS = "authorization, apikey, content-type, x-client-info";
const ALLOWED_METHODS = "POST, OPTIONS";

const ERROR_MESSAGES: Record<SourceAuditV2ErrorCode, string> = {
  origin_not_allowed: "This origin is not allowed.",
  method_not_allowed: "This endpoint accepts POST requests only.",
  invalid_request: "The source-audit request is invalid.",
  unauthenticated: "Authentication is required.",
  unauthorized: "Administrator access is required.",
  integration_not_found: "The requested integration was not found.",
  integration_disabled: "The requested integration is disabled.",
  provider_not_impact:
    "The requested integration is not an Impact integration.",
  credentials_unavailable: "Impact credentials are unavailable.",
  invalid_integration_config: "The stored Impact configuration is invalid.",
  campaign_fetch_failed: "Impact Campaign evidence could not be completed.",
  provider_fetch_failed: "Impact coupon Ads evidence could not be completed.",
  internal_error: "The source audit could not be completed.",
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
  if (siteUrl === null) return LOCAL_AUDIT_ORIGINS.has(origin);
  const siteOrigin = normalizedSiteOrigin(siteUrl);
  if (siteOrigin === null) return false;
  return origin === siteOrigin || LOCAL_AUDIT_ORIGINS.has(origin);
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
  body: CouponAdsCoverageHostResponseV2 | SourceAuditV2ErrorResponse | null,
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
  code: SourceAuditV2ErrorCode,
  status: number,
  origin: string | null,
  allowed: boolean,
): Response {
  return jsonResponse(
    {
      host: { version: SOURCE_AUDIT_VERSION_V2, readOnly: true },
      error: { code, message: ERROR_MESSAGES[code] },
    },
    status,
    origin,
    allowed,
  );
}

function strictBearer(authorization: string): string | null {
  const match = authorization.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
}

function exactRequest(value: unknown): {
  integrationId: string;
  audit: typeof COUPON_ADS_AUDIT_MODE;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2 || keys[0] !== "audit" || keys[1] !== "integrationId"
  ) return null;
  const body = value as SourceAuditV2RequestBody;
  if (
    typeof body.integrationId !== "string" ||
    !UUID_PATTERN.test(body.integrationId) ||
    body.audit !== COUPON_ADS_AUDIT_MODE
  ) return null;
  return {
    integrationId: body.integrationId.toLowerCase(),
    audit: COUPON_ADS_AUDIT_MODE,
  };
}

function configurationFailure(
  error: HostConfigurationError,
  origin: string | null,
): Response {
  return failed(error.code, 422, origin, true);
}

function rateFloorReached(transport: ImpactAuditTransportV2): boolean {
  const remaining = transport.readRateSnapshot().remaining;
  return remaining !== null && remaining <= COUPON_ADS_RATE_REMAINING_FLOOR;
}

function campaignRateGuardedTransport(
  transport: ImpactAuditTransportV2,
): ImpactTransport {
  return {
    execute(request) {
      if (rateFloorReached(transport)) {
        return Promise.resolve({
          kind: "transport_error",
          errorCode: "rate_limit_threshold",
        });
      }
      return transport.execute(request);
    },
    wait(delayMs, signal) {
      return transport.wait(delayMs, signal);
    },
  };
}

export function createAffiliateSyncSourceAuditV2Handler(
  dependencies: SourceAuditV2HostDependencies,
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
      SourceAuditV2HostDependencies["createDataSource"]
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

    let resolved: ResolvedCouponAdsAuditConfigV2;
    try {
      resolved = resolveCouponAdsAuditConfigV2(integration, credentials);
    } catch (error) {
      return error instanceof HostConfigurationError
        ? configurationFailure(error, origin)
        : failed("invalid_integration_config", 422, origin, true);
    }

    let transport: ImpactAuditTransportV2;
    try {
      transport = dependencies.createImpactTransport(
        credentials,
        resolved.baseUrl,
      );
    } catch {
      return failed("provider_fetch_failed", 502, origin, true);
    }

    let campaignResult: ImpactStreamFetchResultV2<RawImpactCampaignV2>;
    try {
      campaignResult = await new ImpactClientV2({
        transport: campaignRateGuardedTransport(transport),
        continuationPolicy: resolved.continuationPolicy,
        limits: resolved.campaignLimits,
        requestTimeoutMs: resolved.requestTimeoutMs,
      }).fetchCampaigns(resolved.campaignsInitialUrl, request.signal);
    } catch {
      return failed("campaign_fetch_failed", 502, origin, true);
    }
    if (
      campaignResult.diagnostics.stopReason !== "completed" ||
      campaignResult.diagnostics.parseFailureReason !== null
    ) return failed("campaign_fetch_failed", 502, origin, true);
    if (rateFloorReached(transport)) {
      return failed("campaign_fetch_failed", 502, origin, true);
    }

    transport.resetRateSnapshot();
    let audit: CouponAdsCoverageAuditV2;
    try {
      audit = await new ImpactCouponAdsAuditClient({
        transport,
        continuationPolicy: resolved.continuationPolicy,
        requestTimeoutMs: resolved.requestTimeoutMs,
        maxAttemptsPerPage: resolved.adsMaxAttemptsPerPage,
      }).audit(
        resolved.adsInitialUrl,
        buildCampaignAdvertiserIndexV2(campaignResult.records),
        request.signal,
      );
    } catch {
      return failed("provider_fetch_failed", 502, origin, true);
    }

    const response: CouponAdsCoverageHostResponseV2 = {
      host: {
        version: SOURCE_AUDIT_VERSION_V2,
        readOnly: true,
        integrationId: parsed.integrationId,
        audit: COUPON_ADS_AUDIT_MODE,
      },
      audit,
    };
    return jsonResponse(response, 200, origin, true);
  };
}
