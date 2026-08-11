// Read-only Edge execution boundary for Affiliate Preview Import.
// It authenticates the caller, preloads plain data, and invokes the shared
// source pipeline. This module has no mutation API or persistence import.

import { createAuthenticatedEdgeClient, createPrivilegedEdgeClient } from "../_shared/edge-supabase.ts";
import {
  IntegrationEngine,
  NormalizerFactory,
  ProviderFactory,
  SyncContext,
  SyncEngine,
  executeRequest,
  prepareImportPreview,
  projectPreviewSyncRunReport,
  runHealthCheck,
  validateConfig,
} from "./import-boundary.ts";
import { loadPreviewReadModel } from "./read-model.ts";
import type { SyncEntityType } from "../../../src/lib/sync/SyncOptions.ts";
import type { ImportStrategy } from "../../../src/lib/sync/ImportOrchestration.ts";
import type { SyncRunReport } from "../../../src/lib/sync/SyncRunReport.ts";

type PreviewRequest = {
  integrationId?: unknown;
  preview?: unknown;
  entityTypes?: unknown;
  pageSize?: unknown;
  maxPages?: unknown;
  maxApiCalls?: unknown;
  consecutiveNoNewPages?: unknown;
  strategy?: unknown;
};

const ENTITY_TYPES: SyncEntityType[] = ["store", "coupon", "deal", "category"];
const STRATEGIES: ImportStrategy[] = ["incremental", "discover_new_offers", "refresh_existing_only", "full_sync"];

function response(body: unknown, status = 200, origin: string | null = null): Response {
  const siteUrl = Deno.env.get("SITE_URL");
  const allowedOrigin = siteUrl && origin === siteUrl ? origin : "null";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    },
  });
}

function positiveInteger(value: unknown, maximum: number, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

function parseRequest(input: PreviewRequest) {
  if (typeof input.integrationId !== "string" || !input.integrationId.trim()) throw new Error("integrationId is required");
  if (input.preview !== undefined && input.preview !== true) throw new Error("This endpoint supports preview: true only");
  let entityTypes: SyncEntityType[] | undefined;
  if (input.entityTypes !== undefined) {
    if (!Array.isArray(input.entityTypes) || input.entityTypes.some((value) => typeof value !== "string" || !ENTITY_TYPES.includes(value as SyncEntityType))) {
      throw new Error("entityTypes contains an unsupported entity");
    }
    entityTypes = input.entityTypes as SyncEntityType[];
  }
  let strategy: ImportStrategy | undefined;
  if (input.strategy !== undefined) {
    if (typeof input.strategy !== "string" || !STRATEGIES.includes(input.strategy as ImportStrategy)) throw new Error("strategy is unsupported");
    strategy = input.strategy as ImportStrategy;
  }
  return {
    integrationId: input.integrationId,
    entityTypes,
    pageSize: positiveInteger(input.pageSize, 500, "pageSize"),
    maxPages: positiveInteger(input.maxPages, 50, "maxPages"),
    maxApiCalls: positiveInteger(input.maxApiCalls, 2000, "maxApiCalls"),
    consecutiveNoNewPages: positiveInteger(input.consecutiveNoNewPages, 100, "consecutiveNoNewPages"),
    strategy,
  };
}

function configuredStrategy(value: string | null): ImportStrategy | undefined {
  return value && STRATEGIES.includes(value as ImportStrategy) ? value as ImportStrategy : undefined;
}

function errorReport(integrationId: string, durationMs: number, message: string): SyncRunReport {
  return {
    provider: "unknown", integrationId, preview: true, committed: false, durationMs,
    orchestration: null, syncErrors: [], syncWarnings: [], progress: null, planCounts: null,
    lifecycle: null, lifecycleDiagnostics: [], identityDiagnostics: null, statistics: null,
    validationErrors: [], skipped: [], conflicts: [], identity: [], presentation: [], logos: null,
    coverage: null, publishing: null, messages: [], error: message,
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return response({}, 204, origin);
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);
  const authorization = request.headers.get("Authorization") ?? "";
  const jwt = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!jwt) return response({ error: "Unauthorized" }, 401, origin);

  let parsed: ReturnType<typeof parseRequest>;
  try {
    parsed = parseRequest(await request.json() as PreviewRequest);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Invalid request" }, 400, origin);
  }

  try {
    const authenticated = createAuthenticatedEdgeClient(authorization);
    const { data: userData, error: userError } = await authenticated.auth.getUser(jwt);
    if (userError || !userData.user) return response({ error: "Unauthorized" }, 401, origin);

    const privileged = createPrivilegedEdgeClient();
    const { data: role, error: roleError } = await privileged.from("user_roles").select("id").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (roleError || !role) return response({ error: "Forbidden" }, 403, origin);

    const started = Date.now();
    try {
      const model = await loadPreviewReadModel(parsed.integrationId);
      const engine = IntegrationEngine.fromConfig(model.config, {
        validate: validateConfig,
        request: executeRequest,
        healthCheck: runHealthCheck,
      });
      const adapter = ProviderFactory.fromEngine(engine);
      await adapter.initialize();
      const normalizer = NormalizerFactory.for({ provider_name: model.config.providerName, provider_type: model.config.providerType });
      if (!normalizer) throw new Error(`No normalizer registered for provider "${model.config.providerName}"`);
      const synced = await new SyncEngine(new SyncContext({
        adapter,
        normalizer,
        options: {
          entityTypes: parsed.entityTypes,
          pageSize: parsed.pageSize ?? model.orchestration.pageSize ?? undefined,
          maxPages: parsed.maxPages ?? model.orchestration.maxPages,
          maxApiCalls: parsed.maxApiCalls ?? model.orchestration.maxApiCalls,
          consecutiveNoNewPages: parsed.consecutiveNoNewPages ?? model.orchestration.consecutiveNoNewPages ?? undefined,
          strategy: parsed.strategy ?? configuredStrategy(model.orchestration.strategy),
          existingProviderOfferIds: model.existingProviderOfferIds,
        },
      })).run();
      if (!synced.body) throw new Error(synced.error?.message ?? "Sync produced no result");

      const prepared = prepareImportPreview(synced.body, {
        existing: model.existing,
        policy: model.policy,
        policyContext: model.policyContext,
        inputWarnings: model.warnings,
        startedAt: new Date(started).toISOString(),
        startedAtMs: started,
      });
      if (!prepared.body) throw new Error(prepared.error?.message ?? "Preview preparation failed");
      const report = projectPreviewSyncRunReport(synced.body, prepared.body, Date.now() - started);
      report.preview = true;
      report.committed = false;
      if (report.statistics) { report.statistics.created = 0; report.statistics.updated = 0; }
      return response(report, 200, origin);
    } catch (error) {
      return response(errorReport(parsed.integrationId, 0, error instanceof Error ? error.message : String(error)), 200, origin);
    }
  } catch {
    return response({ error: "Unauthorized" }, 401, origin);
  }
});
