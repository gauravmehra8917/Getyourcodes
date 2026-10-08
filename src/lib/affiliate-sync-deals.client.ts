import { supabase } from "@/integrations/supabase/client";

export const IMPACT_DEALS_PREVIEW_FUNCTION = "affiliate-sync-preview-v2" as const;
export const IMPACT_DEALS_APPLY_FUNCTION = "affiliate-sync-apply-v2" as const;
export const IMPACT_DEALS_MUTATION_OPTIONS = { retry: false } as const;

export type ImpactDealsPreviewSummary = {
  status: "ready";
  evaluationTimestamp: string;
  deals: {
    normalized: number;
    selected: number;
    held: number;
    unresolved: number;
    existing: number;
    proposedCreate: number;
  };
  stores: { withSelectedOffers: number; qualified: number };
  identityIntegrity: { identityCollapseDetected: false };
};

export type ImpactDealsFailure = {
  status: "blocked" | "failed" | "indeterminate";
  message: string;
  stage?: string;
  reason?: string;
  rpcStage?: string;
  rpcReason?: string;
  blockerReasonCounts?: Record<string, number>;
};

export type ImpactDealsApplySuccess = {
  status: "committed" | "replayed_existing";
  scope: "deals";
  mode: "full";
  runId: string;
  evaluationTimestamp: string;
  refreshedPlan: true;
  createdStores: number;
  createdDeals: number;
  noopStores: number;
  noopDeals: number;
  counts: {
    expected: {
      stores: {
        create: number;
        noopExisting: number;
        blockedAmbiguous: number;
        noopUnmatched: number;
      };
      offers: { create: number; noopExisting: number; noopUnresolved: number; noopHeld?: number };
      writableStores: number;
      writableOffers: number;
      writableEntities: number;
    };
    actual: {
      storesCreated: number;
      storesNoopExisting: number;
      offersCreated: number;
      offersNoopExisting: number;
      ledgerRows: number;
    };
  };
  ledgerRows: number;
};

export type ImpactDealsPreviewResult = ImpactDealsPreviewSummary | ImpactDealsFailure;
export type ImpactDealsApplyResult = ImpactDealsApplySuccess | ImpactDealsFailure;
export type ImpactDealsPreviewInvoke = (
  functionName: typeof IMPACT_DEALS_PREVIEW_FUNCTION,
  options: { body: { integrationId: string; preview: true } },
) => Promise<{ data: unknown; error: unknown }>;
export type ImpactDealsApplyInvoke = (
  functionName: typeof IMPACT_DEALS_APPLY_FUNCTION,
  options: { body: { integrationId: string; execute: true; scope: "deals"; mode: "full" } },
) => Promise<{ data: unknown; error: unknown }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" && TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value))
  );
}

function parseNumbers<K extends string>(
  value: unknown,
  keys: readonly K[],
): Record<K, number> | null {
  if (!isRecord(value)) return null;
  const result = {} as Record<K, number>;
  for (const key of keys) {
    const count = value[key];
    if (!nonnegativeInteger(count)) return null;
    result[key] = count;
  }
  return result;
}

function failureMessage(
  status: ImpactDealsFailure["status"],
  reason?: string,
  rpcReason?: string,
): string {
  if (status === "indeterminate") {
    return "The final import outcome could not be confirmed. Do not retry immediately. Check Deals and Import History first.";
  }
  const reasons = [reason, rpcReason];
  if (reasons.includes("unauthorized") || reasons.includes("unauthenticated"))
    return "Administrator access is required.";
  if (reasons.includes("integration_disabled"))
    return "Enable this Impact integration before importing.";
  if (
    reasons.includes("provider_fetch_failed") ||
    reasons.includes("malformed_provider_response")
  ) {
    return "Impact could not be fully read. No Deals were imported.";
  }
  if (
    reasons.includes("identity_collapse_detected") ||
    reasons.includes("deals_only_invariant_failed")
  ) {
    return "The Deals safety check failed. No import was applied.";
  }
  if (status === "blocked" || reasons.includes("plan_blocked"))
    return "The Deals import was blocked by safety or catalog checks.";
  if (reasons.includes("provider_not_impact")) return "This action requires an Impact integration.";
  if (reasons.includes("invalid_integration_id"))
    return "The integration could not be identified. No Deals were imported.";
  if (reasons.includes("review_unavailable") || reasons.includes("malformed_preview")) {
    return "The Deals review could not be verified. No Deals were imported.";
  }
  return "The Deals operation could not be completed. No import was applied.";
}

function parseFailure(
  value: Record<string, unknown>,
  status: ImpactDealsFailure["status"],
): ImpactDealsFailure {
  const result: ImpactDealsFailure = { status, message: "" };
  for (const key of ["stage", "reason", "rpcStage", "rpcReason"] as const) {
    const code = value[key];
    if (typeof code === "string" && CODE_PATTERN.test(code)) result[key] = code;
  }
  if (isRecord(value.blockerReasonCounts)) {
    const entries = Object.entries(value.blockerReasonCounts)
      .slice(0, 50)
      .filter(
        (entry): entry is [string, number] =>
          CODE_PATTERN.test(entry[0]) && nonnegativeInteger(entry[1]),
      );
    if (entries.length) result.blockerReasonCounts = Object.fromEntries(entries);
  }
  result.message = failureMessage(status, result.reason, result.rpcReason);
  return result;
}

function failure(status: ImpactDealsFailure["status"], reason?: string): ImpactDealsFailure {
  return parseFailure({ reason }, status);
}

export function parseImpactDealsPreviewResponse(value: unknown): ImpactDealsPreviewResult | null {
  if (!isRecord(value)) return null;
  // Error envelopes take precedence over any planning fields.
  if (isRecord(value.error)) return parseFailure({ reason: value.error.code }, "failed");
  if (!isRecord(value.preview)) return null;
  const preview = value.preview;
  if (preview.provider !== "impact" || !timestamp(preview.evaluationTimestamp)) return null;
  if (!isRecord(preview.identityIntegrityDiagnostics)) return null;
  if (preview.identityIntegrityDiagnostics.identityCollapseDetected === true) {
    return failure("blocked", "identity_collapse_detected");
  }
  if (preview.identityIntegrityDiagnostics.identityCollapseDetected !== false) return null;
  if (!isRecord(preview.proposedActions) || !isRecord(preview.proposedActions.counts)) return null;
  const deals = parseNumbers(preview.proposedActions.counts.deals, [
    "normalized",
    "selected",
    "held",
    "unresolved",
    "existing",
    "proposedCreate",
  ] as const);
  const coverage = parseNumbers(preview.storeCoverage, [
    "storesWithSelectedOffers",
    "qualifiedStores",
  ] as const);
  if (!deals || !coverage) return null;
  if (
    deals.selected !== deals.existing + deals.proposedCreate ||
    deals.normalized !== deals.selected + deals.held + deals.unresolved
  )
    return null;
  // Construct a fresh allowlisted aggregate; never return the raw planning model.
  return {
    status: "ready",
    evaluationTimestamp: preview.evaluationTimestamp,
    deals,
    stores: {
      withSelectedOffers: coverage.storesWithSelectedOffers,
      qualified: coverage.qualifiedStores,
    },
    identityIntegrity: { identityCollapseDetected: false },
  };
}

export function parseImpactDealsApplyResponse(value: unknown): ImpactDealsApplyResult | null {
  if (!isRecord(value)) return null;
  if (value.status === "blocked" || value.status === "failed" || value.status === "indeterminate") {
    return parseFailure(value, value.status);
  }
  if (value.status !== "committed" && value.status !== "replayed_existing") return null;
  if (
    value.scope !== "deals" ||
    value.mode !== "full" ||
    value.refreshedPlan !== true ||
    typeof value.runId !== "string" ||
    !UUID_PATTERN.test(value.runId) ||
    !timestamp(value.evaluationTimestamp)
  )
    return null;
  const totals = parseNumbers(value, [
    "createdStores",
    "createdDeals",
    "noopStores",
    "noopDeals",
    "ledgerRows",
  ] as const);
  if (!totals || !isRecord(value.counts) || !isRecord(value.counts.expected)) return null;
  const expected = value.counts.expected;
  const stores = parseNumbers(expected.stores, [
    "create",
    "noopExisting",
    "blockedAmbiguous",
    "noopUnmatched",
  ] as const);
  const offers = parseNumbers(expected.offers, [
    "create",
    "noopExisting",
    "noopUnresolved",
  ] as const);
  const writable = parseNumbers(expected, [
    "writableStores",
    "writableOffers",
    "writableEntities",
  ] as const);
  const actual = parseNumbers(value.counts.actual, [
    "storesCreated",
    "storesNoopExisting",
    "offersCreated",
    "offersNoopExisting",
    "ledgerRows",
  ] as const);
  if (!stores || !offers || !writable || !actual || !isRecord(expected.offers)) return null;
  const noopHeld = expected.offers.noopHeld;
  if (noopHeld !== undefined && !nonnegativeInteger(noopHeld)) return null;
  if (
    totals.createdStores !== actual.storesCreated ||
    totals.createdDeals !== actual.offersCreated ||
    totals.noopStores !== actual.storesNoopExisting ||
    totals.noopDeals !== actual.offersNoopExisting ||
    totals.ledgerRows !== actual.ledgerRows ||
    totals.ledgerRows !==
      totals.createdStores + totals.noopStores + totals.createdDeals + totals.noopDeals ||
    totals.createdStores + totals.noopStores !== stores.create + stores.noopExisting ||
    totals.createdDeals + totals.noopDeals !== offers.create + offers.noopExisting ||
    totals.createdStores > stores.create ||
    totals.createdDeals > offers.create ||
    stores.blockedAmbiguous !== 0 ||
    writable.writableStores !== stores.create ||
    writable.writableOffers !== offers.create ||
    writable.writableEntities !== writable.writableStores + writable.writableOffers
  )
    return null;
  return {
    status: value.status,
    scope: "deals",
    mode: "full",
    runId: value.runId,
    evaluationTimestamp: value.evaluationTimestamp,
    refreshedPlan: true,
    ...totals,
    counts: {
      expected: {
        stores,
        offers: { ...offers, ...(noopHeld === undefined ? {} : { noopHeld }) },
        ...writable,
      },
      actual,
    },
  };
}

// Supabase non-2xx responses arrive in FunctionsHttpError.context. Read only a
// bounded error envelope and immediately reduce it; never keep/log raw bodies.
async function readHttpFailureBody(error: unknown): Promise<unknown> {
  if (
    !isRecord(error) ||
    error.name !== "FunctionsHttpError" ||
    !(error.context instanceof Response)
  )
    return null;
  const reader = error.context.clone().body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) {
        // A cloned Response is a tee: waiting for cancellation can wait on the
        // unread original branch. Cancel without blocking the safe fallback.
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function requestImpactDealsPreview(
  integrationId: string,
  invoke: ImpactDealsPreviewInvoke,
): Promise<ImpactDealsPreviewResult> {
  if (!UUID_PATTERN.test(integrationId)) return failure("failed", "invalid_integration_id");
  try {
    const { data, error } = await invoke(IMPACT_DEALS_PREVIEW_FUNCTION, {
      body: { integrationId, preview: true },
    });
    const parsed = parseImpactDealsPreviewResponse(data);
    if (parsed && parsed.status !== "ready") return parsed;
    if (error) {
      const rejected = parseImpactDealsPreviewResponse(await readHttpFailureBody(error));
      return rejected && rejected.status !== "ready"
        ? rejected
        : failure("failed", "review_unavailable");
    }
    return parsed ?? failure("failed", "malformed_preview");
  } catch {
    return failure("failed", "review_unavailable");
  }
}

export async function requestImpactDealsApply(
  integrationId: string,
  invoke: ImpactDealsApplyInvoke,
): Promise<ImpactDealsApplyResult> {
  if (!UUID_PATTERN.test(integrationId)) return failure("failed", "invalid_integration_id");
  try {
    const { data, error } = await invoke(IMPACT_DEALS_APPLY_FUNCTION, {
      body: { integrationId, execute: true, scope: "deals", mode: "full" },
    });
    const parsed = parseImpactDealsApplyResponse(data);
    if (parsed && parsed.status !== "committed" && parsed.status !== "replayed_existing")
      return parsed;
    if (error) {
      const rejected = parseImpactDealsApplyResponse(await readHttpFailureBody(error));
      return rejected && rejected.status !== "committed" && rejected.status !== "replayed_existing"
        ? rejected
        : failure("indeterminate");
    }
    return parsed ?? failure("indeterminate");
  } catch {
    return failure("indeterminate");
  }
}

export function reviewImpactDeals(integrationId: string): Promise<ImpactDealsPreviewResult> {
  return requestImpactDealsPreview(integrationId, (name, options) =>
    supabase.functions.invoke(name, options),
  );
}

export function importImpactDeals(integrationId: string): Promise<ImpactDealsApplyResult> {
  return requestImpactDealsApply(integrationId, (name, options) =>
    supabase.functions.invoke(name, options),
  );
}
