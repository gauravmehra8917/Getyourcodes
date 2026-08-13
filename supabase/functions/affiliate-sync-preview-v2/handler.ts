import {
  ImpactFetchOrchestrator,
  type ImpactProviderFetchResultV2,
  PreviewPlanner,
} from "../_shared/affiliate-sync-v2/index.ts";
import { loadExistingCatalogSnapshotV2 } from "./catalog-snapshot.ts";
import {
  assertImpactProvider,
  HostConfigurationError,
  parseImpactHostCredentials,
  resolveImpactHostConfig,
} from "./impact-configuration.ts";
import type {
  AffiliateSyncPreviewV2HostResponse,
  PreviewV2ErrorCode,
  PreviewV2ErrorResponse,
  PreviewV2HostDependencies,
  PreviewV2RequestBody,
} from "./types.ts";

const VERSION = "v2-a8a" as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_A8B_CORS_ORIGINS = new Set([
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
]);

const ERROR_MESSAGES: Record<PreviewV2ErrorCode, string> = {
  method_not_allowed: "This endpoint accepts POST requests only.",
  invalid_request: "The preview request is invalid.",
  unauthenticated: "Authentication is required.",
  unauthorized: "Administrator access is required.",
  integration_not_found: "The requested integration was not found.",
  integration_disabled: "The requested integration is disabled.",
  provider_not_impact:
    "The requested integration is not an Impact integration.",
  credentials_unavailable: "Impact credentials are unavailable.",
  invalid_integration_config: "The stored Impact configuration is invalid.",
  catalog_snapshot_failed: "The existing catalog snapshot could not be loaded.",
  provider_fetch_failed: "Impact preview retrieval did not complete.",
  malformed_provider_response: "Impact returned a malformed response.",
  internal_error: "The preview could not be completed.",
};

function corsHeaders(
  origin: string | null,
  siteUrl: string | null,
): HeadersInit {
  let siteOrigin: string | null = null;
  if (siteUrl) {
    try {
      siteOrigin = new URL(siteUrl).origin;
    } catch {
      siteOrigin = null;
    }
  }
  const allowedOrigin =
    origin && (origin === siteOrigin || LOCAL_A8B_CORS_ORIGINS.has(origin))
      ? origin
      : "null";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
  siteUrl: string | null,
  sensitiveValues: readonly string[] = [],
): Response {
  const secrets = sensitiveValues.filter(Boolean);
  const serialized = JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value !== "string") return value;
    return secrets.reduce(
      (redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"),
      value,
    );
  });
  return new Response(status === 204 ? null : serialized, {
    status,
    headers: corsHeaders(origin, siteUrl),
  });
}

function errorResponse(
  code: PreviewV2ErrorCode,
  status: number,
  origin: string | null,
  siteUrl: string | null,
): Response {
  const body: PreviewV2ErrorResponse = {
    host: { version: VERSION, readOnly: true },
    error: { code, message: ERROR_MESSAGES[code] },
  };
  return jsonResponse(body, status, origin, siteUrl);
}

function bearerToken(authorization: string): string | null {
  if (!authorization.startsWith("Bearer ")) return null;
  const jwt = authorization.slice("Bearer ".length).trim();
  return jwt || null;
}

function parseRequestBody(
  value: unknown,
): { integrationId: string; preview: true } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as PreviewV2RequestBody;
  if (
    Object.keys(value).some((key) =>
      key !== "integrationId" && key !== "preview"
    )
  ) return null;
  if (
    typeof body.integrationId !== "string" || !UUID.test(body.integrationId)
  ) return null;
  if (body.preview !== true) return null;
  return { integrationId: body.integrationId, preview: true };
}

function incompleteFetchError(
  result: ImpactProviderFetchResultV2,
): PreviewV2ErrorCode | null {
  const reasons = [
    result.fetchDiagnostics.promotions.stopReason,
    result.fetchDiagnostics.campaigns.stopReason,
  ];
  if (reasons.every((reason) => reason === "completed")) return null;
  return reasons.includes("malformed_page")
    ? "malformed_provider_response"
    : "provider_fetch_failed";
}

function configErrorResponse(
  error: HostConfigurationError,
  origin: string | null,
  siteUrl: string | null,
): Response {
  if (error.code === "provider_not_impact") {
    return errorResponse(error.code, 422, origin, siteUrl);
  }
  if (error.code === "credentials_unavailable") {
    return errorResponse(error.code, 422, origin, siteUrl);
  }
  return errorResponse(error.code, 422, origin, siteUrl);
}

export function createAffiliateSyncPreviewV2Handler(
  dependencies: PreviewV2HostDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return jsonResponse({}, 204, origin, dependencies.siteUrl);
    }
    if (request.method !== "POST") {
      return errorResponse(
        "method_not_allowed",
        405,
        origin,
        dependencies.siteUrl,
      );
    }

    const authorization = request.headers.get("Authorization") ?? "";
    const jwt = bearerToken(authorization);
    if (!jwt) {
      return errorResponse(
        "unauthenticated",
        401,
        origin,
        dependencies.siteUrl,
      );
    }

    let user: { id: string } | null;
    try {
      user = await dependencies.verifyUser(authorization, jwt);
    } catch {
      return errorResponse(
        "unauthenticated",
        401,
        origin,
        dependencies.siteUrl,
      );
    }
    if (!user) {
      return errorResponse(
        "unauthenticated",
        401,
        origin,
        dependencies.siteUrl,
      );
    }

    let dataSource: ReturnType<PreviewV2HostDependencies["createDataSource"]>;
    try {
      dataSource = dependencies.createDataSource();
      if (!await dataSource.hasAdminRole(user.id)) {
        return errorResponse("unauthorized", 403, origin, dependencies.siteUrl);
      }
    } catch {
      return errorResponse("internal_error", 500, origin, dependencies.siteUrl);
    }

    let parsed: ReturnType<typeof parseRequestBody>;
    try {
      parsed = parseRequestBody(await request.json());
    } catch {
      parsed = null;
    }
    if (!parsed) {
      return errorResponse(
        "invalid_request",
        400,
        origin,
        dependencies.siteUrl,
      );
    }

    let integration: Awaited<ReturnType<typeof dataSource.readIntegration>>;
    try {
      integration = await dataSource.readIntegration(parsed.integrationId);
    } catch {
      return errorResponse("internal_error", 500, origin, dependencies.siteUrl);
    }
    if (!integration) {
      return errorResponse(
        "integration_not_found",
        404,
        origin,
        dependencies.siteUrl,
      );
    }
    if (!integration.isEnabled) {
      return errorResponse(
        "integration_disabled",
        409,
        origin,
        dependencies.siteUrl,
      );
    }
    try {
      assertImpactProvider(integration.providerName);
    } catch (error) {
      return error instanceof HostConfigurationError
        ? configErrorResponse(error, origin, dependencies.siteUrl)
        : errorResponse("internal_error", 500, origin, dependencies.siteUrl);
    }

    let credentials;
    try {
      const ciphertext = await dataSource.readCredentialCiphertext(
        integration.id,
      );
      if (!ciphertext) {
        throw new HostConfigurationError("credentials_unavailable");
      }
      credentials = parseImpactHostCredentials(
        await dependencies.decryptCredentialEnvelope(ciphertext),
      );
    } catch (error) {
      return error instanceof HostConfigurationError
        ? configErrorResponse(error, origin, dependencies.siteUrl)
        : errorResponse(
          "credentials_unavailable",
          422,
          origin,
          dependencies.siteUrl,
        );
    }

    let resolved;
    try {
      const policy = await dataSource.readPublishingPolicy(
        integration.publishingPolicyId,
      );
      resolved = resolveImpactHostConfig(integration, credentials, policy);
    } catch (error) {
      return error instanceof HostConfigurationError
        ? configErrorResponse(error, origin, dependencies.siteUrl)
        : errorResponse(
          "invalid_integration_config",
          422,
          origin,
          dependencies.siteUrl,
        );
    }

    let snapshot;
    try {
      snapshot = await loadExistingCatalogSnapshotV2(dataSource);
    } catch {
      return errorResponse(
        "catalog_snapshot_failed",
        500,
        origin,
        dependencies.siteUrl,
      );
    }

    let fetched: ImpactProviderFetchResultV2;
    try {
      const transport = dependencies.createImpactTransport(
        credentials,
        resolved.baseUrl,
      );
      fetched = await ImpactFetchOrchestrator.retrieve({
        transport,
        promotionsInitialUrl: resolved.promotionsInitialUrl,
        campaignsInitialUrl: resolved.campaignsInitialUrl,
        continuationPolicy: resolved.continuationPolicy,
        limits: resolved.limits,
        requestTimeoutMs: resolved.requestTimeoutMs,
        signal: request.signal,
      });
    } catch {
      return errorResponse(
        "provider_fetch_failed",
        502,
        origin,
        dependencies.siteUrl,
      );
    }
    const fetchError = incompleteFetchError(fetched);
    if (fetchError) {
      return errorResponse(fetchError, 502, origin, dependencies.siteUrl);
    }

    try {
      const preview = PreviewPlanner.plan({
        acceptedPromotions: fetched.acceptedPromotions,
        acceptedCampaigns: fetched.acceptedCampaigns,
        fetchDiagnostics: fetched.fetchDiagnostics,
        quarantinedRecords: fetched.quarantinedRecords,
        existingCatalogSnapshot: snapshot,
        publishingPolicyConfig: resolved.publishingPolicyConfig,
        storeQualificationConfig: resolved.storeQualificationConfig,
        evaluationTimestamp: dependencies.now().toISOString(),
      });
      const body: AffiliateSyncPreviewV2HostResponse = {
        host: {
          version: VERSION,
          readOnly: true,
          integrationId: integration.id,
        },
        preview,
      };
      return jsonResponse(
        body,
        200,
        origin,
        dependencies.siteUrl,
        [credentials.accountSid, credentials.authToken],
      );
    } catch {
      return errorResponse(
        "malformed_provider_response",
        502,
        origin,
        dependencies.siteUrl,
      );
    }
  };
}
