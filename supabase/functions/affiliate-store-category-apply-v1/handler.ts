import { fetchCategoryCampaigns } from "../_shared/affiliate-store-category-v1/campaign-client.ts";
import { selectCategoryCanary } from "./canary-selection.ts";
import { UUID_PATTERN } from "../_shared/affiliate-store-category-v1/taxonomy.ts";
import {
  assertImpactProvider,
  parseImpactHostCredentials,
} from "../_shared/affiliate-sync-v2-host/impact-configuration.ts";
import { resolveImpactAdsHostConfigV2 } from "../affiliate-sync-ads-preview-v2/impact-ads-configuration.ts";
import {
  CATEGORY_CANARY_VERSION,
  CATALOG_ROW_LIMIT,
  CAMPAIGN_RECORD_LIMIT,
  RESPONSE_BYTE_LIMIT,
} from "./types.ts";
import type { CategoryCanaryDependencies } from "./types.ts";

const LOCAL_ORIGINS = new Set([
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
]);
const ERRORS = {
  origin_not_allowed: "This origin is not allowed.",
  method_not_allowed: "This endpoint accepts POST requests only.",
  unauthenticated: "Authentication is required.",
  unauthorized: "Administrator access is required.",
  invalid_request: "The category canary request is invalid.",
  integration_not_found: "The integration was not found.",
  integration_disabled: "The integration is disabled.",
  invalid_integration_config: "The stored Impact configuration is invalid.",
  credentials_unavailable: "Impact credentials are unavailable.",
  catalog_read_failed: "Category facts could not be read safely.",
  campaign_fetch_failed: "Bounded Campaign evidence could not be completed.",
  internal_error: "The category canary could not be completed.",
} as const;

function allowedOrigin(origin: string | null, siteUrl: string | null): boolean {
  if (!origin || origin === "null") return false;
  if (siteUrl === null) return LOCAL_ORIGINS.has(origin);
  try {
    const site = new URL(siteUrl);
    return (
      ["https:", "http:"].includes(site.protocol) &&
      (origin === site.origin || LOCAL_ORIGINS.has(origin))
    );
  } catch {
    return false;
  }
}

async function boundedRequestBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new Error("invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024) {
        await reader.cancel().catch(() => undefined);
        throw new Error("invalid_request");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_request");
  }
  return parsed as Record<string, unknown>;
}

export function createCategoryCanaryHandler(deps: CategoryCanaryDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const allowed = allowedOrigin(origin, deps.siteUrl);
    const respond = (body: unknown, status: number) =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": allowed && origin ? origin : "null",
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          Vary: "Origin",
        },
      });
    const fail = (code: keyof typeof ERRORS, status: number) =>
      respond(
        {
          host: { version: CATEGORY_CANARY_VERSION, mode: "canary" },
          error: { code, message: ERRORS[code] },
        },
        status,
      );
    if (!allowed) return fail("origin_not_allowed", 403);
    if (request.method === "OPTIONS") return respond(null, 204);
    if (request.method !== "POST") return fail("method_not_allowed", 405);
    const authorization = request.headers.get("Authorization") ?? "";
    const jwt = authorization.match(/^Bearer ([^\s]+)$/)?.[1];
    if (!jwt) return fail("unauthenticated", 401);
    let user;
    try {
      user = await deps.verifyUser(authorization, jwt);
    } catch {
      return fail("unauthenticated", 401);
    }
    if (!user || !UUID_PATTERN.test(user.id)) return fail("unauthenticated", 401);
    let source;
    try {
      source = deps.createDataSource();
      if (!(await source.hasAdminRole(user.id))) return fail("unauthorized", 403);
    } catch {
      return fail("unauthorized", 403);
    }
    let integrationId: string;
    try {
      const body = await boundedRequestBody(request);
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).sort().join(",") !== "apply,integrationId,mode" ||
        body.apply !== true ||
        body.mode !== "canary" ||
        typeof body.integrationId !== "string" ||
        !UUID_PATTERN.test(body.integrationId)
      )
        return fail("invalid_request", 400);
      integrationId = body.integrationId.toLowerCase();
    } catch {
      return fail("invalid_request", 400);
    }
    let integration;
    try {
      integration = await source.readIntegration(integrationId);
    } catch {
      return fail("internal_error", 500);
    }
    if (!integration) return fail("integration_not_found", 404);
    if (!UUID_PATTERN.test(integration.id) || integration.id.toLowerCase() !== integrationId) {
      return fail("invalid_integration_config", 422);
    }
    if (!integration.isEnabled) return fail("integration_disabled", 409);
    try {
      assertImpactProvider(integration.providerName);
    } catch {
      return fail("invalid_integration_config", 422);
    }
    let stores, categoryIds, mappings;
    try {
      stores = await source.readStores();
      categoryIds = await source.readCategoryIds();
      mappings = await source.readMappings();
      if ([stores, categoryIds, mappings].some((rows) => rows.length > CATALOG_ROW_LIMIT)) {
        return fail("catalog_read_failed", 500);
      }
    } catch {
      return fail("catalog_read_failed", 500);
    }
    let credentials;
    try {
      const ciphertext = await source.readCredentialCiphertext(integrationId);
      if (!ciphertext) return fail("credentials_unavailable", 422);
      credentials = parseImpactHostCredentials(await deps.decryptCredentialEnvelope(ciphertext));
    } catch {
      return fail("credentials_unavailable", 422);
    }
    let config;
    try {
      // Reuse only the established safe configuration helper; no Ads fetch/apply.
      config = resolveImpactAdsHostConfigV2(
        {
          ...integration,
          pageSize: Math.min(100, Math.max(1, integration.pageSize)),
          maxPages: Math.min(10, Math.max(1, integration.maxPages ?? 10)),
          timeoutSeconds: Math.min(15, Math.max(1, integration.timeoutSeconds)),
        },
        credentials,
      );
    } catch {
      return fail("invalid_integration_config", 422);
    }
    try {
      const fetched = await fetchCategoryCampaigns(
        {
          transport: deps.createImpactTransport(credentials, config.baseUrl),
          continuationPolicy: config.continuationPolicy,
          requestTimeoutMs: Math.min(15_000, config.requestTimeoutMs),
          limits: {
            ...config.campaignLimits,
            maxPages: Math.min(10, config.campaignLimits.maxPages),
            maxPhysicalRequests: Math.min(10, config.campaignLimits.maxPhysicalRequests),
            maxRecords: CAMPAIGN_RECORD_LIMIT,
            maxResponseBytes: RESPONSE_BYTE_LIMIT,
          },
        },
        config.campaignsInitialUrl,
        request.signal,
      );
      // Incomplete evidence must never look like an actionable canary.
      if (!fetched.diagnostics.complete || fetched.diagnostics.stopReason !== "completed") {
        return fail("campaign_fetch_failed", 502);
      }
      const { selected, assignable } = selectCategoryCanary({
        campaigns: fetched.records,
        stores,
        categoryIds,
        mappings,
      });
      const summary = (
        status: "assigned" | "noop" | "blocked",
        assigned: 0 | 1,
        alreadyCategorized: 0 | 1,
        remainingAssignable: number,
        httpStatus = 200,
      ) =>
        respond(
          {
            host: { version: CATEGORY_CANARY_VERSION, mode: "canary" },
            result: { status, assigned, alreadyCategorized, remainingAssignable },
          },
          httpStatus,
        );
      if (!selected) return summary("noop", 0, 0, 0);
      // One fresh, server-derived assignment. No retry or second-canary fallback.
      try {
        const result = await source.applyCanary(selected);
        if (result.status === "assigned") return summary("assigned", 1, 0, assignable - 1);
        if (result.status === "noop_existing_category")
          return summary("noop", 0, 1, assignable - 1);
        return summary("blocked", 0, 0, assignable);
      } catch {
        // Transport failure may have an unknown commit outcome; never retry it here.
        return summary("blocked", 0, 0, assignable, 502);
      }
    } catch {
      return fail("campaign_fetch_failed", 502);
    }
  };
}
