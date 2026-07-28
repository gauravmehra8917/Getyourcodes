// Provider-independent normalizer contract + shared base implementation.
//
// A Normalizer converts raw provider payloads into canonical models.
// It never performs HTTP, never touches the database, and never throws:
// every method returns a StandardResponse.

import type { StandardResponse } from "@/lib/integration-engine/types";
import { logDebug } from "@/lib/integration-engine/logger.server";
import type {
  CanonicalCategory,
  CanonicalCoupon,
  CanonicalDeal,
  CanonicalStore,
  EntityKind,
  Metadata,
  NormalizationBatch,
  NormalizationIssue,
} from "./types";

export interface NormalizerContext {
  /** Integration row id, when normalizing data fetched through the engine. */
  integrationId?: string;
  /** Optional provider store id to attach to coupons/deals lacking one. */
  providerStoreId?: string;
  /**
   * Optional map of provider store/advertiser/campaign id -> tracking url,
   * used as a fallback when a promotion carries no link of its own.
   */
  storeTrackingUrls?: Record<string, string>;
}

export interface Normalizer {
  readonly provider: string;

  normalizeStore(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalStore>;
  normalizeCoupon(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalCoupon>;
  normalizeDeal(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalDeal>;
  normalizeCategory(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalCategory>;

  normalizeStores(raw: unknown, ctx?: NormalizerContext): StandardResponse<NormalizationBatch<CanonicalStore>>;
  normalizeCoupons(raw: unknown, ctx?: NormalizerContext): StandardResponse<NormalizationBatch<CanonicalCoupon>>;
  normalizeDeals(raw: unknown, ctx?: NormalizerContext): StandardResponse<NormalizationBatch<CanonicalDeal>>;
  normalizeCategories(raw: unknown, ctx?: NormalizerContext): StandardResponse<NormalizationBatch<CanonicalCategory>>;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Read the first present, non-empty key (case-insensitive) from a record. */
export function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) lower.set(k.toLowerCase(), v);
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asIsoDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter((x): x is string => !!x);
  const s = asString(v);
  if (!s) return [];
  return s
    .split(/[,|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Everything from `raw` that wasn't consumed by canonical fields. */
export function buildMetadata(raw: Record<string, unknown>, consumed: string[]): Metadata {
  const used = new Set(consumed.map((k) => k.toLowerCase()));
  const meta: Metadata = {};
  for (const [k, v] of Object.entries(raw)) {
    if (used.has(k.toLowerCase())) continue;
    if (v === undefined) continue;
    meta[k] = v;
  }
  return meta;
}

/** Unwrap an array from a raw payload, a StandardResponse, or an envelope. */
export function toRecordArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return [];
  if ("body" in raw && (Array.isArray(raw.body) || isRecord(raw.body))) {
    return toRecordArray(raw.body);
  }
  for (const v of Object.values(raw)) if (Array.isArray(v)) return v;
  return [];
}

// ── Response builders ───────────────────────────────────────────────────────

function meta(provider: string, integrationId?: string) {
  return {
    integrationId: integrationId ?? "",
    method: "GET" as const,
    url: `normalizer://${provider}`,
    at: new Date().toISOString(),
  };
}

export function normalizerOk<T>(
  provider: string,
  body: T,
  durationMs: number,
  integrationId?: string,
): StandardResponse<T> {
  return {
    success: true,
    status: 200,
    latencyMs: durationMs,
    headers: {},
    body,
    error: null,
    retryCount: 0,
    meta: meta(provider, integrationId),
  };
}

export function normalizerFail<T>(
  provider: string,
  message: string,
  durationMs = 0,
  integrationId?: string,
): StandardResponse<T> {
  return {
    success: false,
    status: 0,
    latencyMs: durationMs,
    headers: {},
    body: null,
    error: { class: "validation_error", message },
    retryCount: 0,
    meta: meta(provider, integrationId),
  };
}

/** Compact, credential-free normalization log line. */
export function logNormalization(entry: {
  provider: string;
  entity: EntityKind;
  received: number;
  normalized: number;
  skipped: number;
  durationMs: number;
}) {
  // eslint-disable-next-line no-console
  console.log(`[normalizer] ${JSON.stringify(entry)}`);
  logDebug("normalize", { ...entry });
}

// ── Base class ──────────────────────────────────────────────────────────────

export abstract class BaseNormalizer implements Normalizer {
  abstract readonly provider: string;

  abstract normalizeStore(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalStore>;
  abstract normalizeCoupon(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalCoupon>;
  abstract normalizeDeal(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalDeal>;
  abstract normalizeCategory(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalCategory>;

  /** Shared bulk driver: never throws, collects per-record issues. */
  protected bulk<T>(
    entity: EntityKind,
    raw: unknown,
    ctx: NormalizerContext | undefined,
    one: (record: unknown, ctx?: NormalizerContext) => StandardResponse<T>,
  ): StandardResponse<NormalizationBatch<T>> {
    const started = Date.now();
    const records = toRecordArray(raw);
    const items: T[] = [];
    const issues: NormalizationIssue[] = [];

    records.forEach((record, index) => {
      try {
        const res = one(record, ctx);
        if (res.success && res.body) items.push(res.body);
        else issues.push({ index, reason: res.error?.message ?? "unknown normalization failure" });
      } catch (err) {
        issues.push({ index, reason: err instanceof Error ? err.message : String(err) });
      }
    });

    const durationMs = Date.now() - started;
    const batch: NormalizationBatch<T> = {
      items,
      received: records.length,
      normalized: items.length,
      skipped: issues.length,
      issues,
      durationMs,
    };

    logNormalization({
      provider: this.provider,
      entity,
      received: batch.received,
      normalized: batch.normalized,
      skipped: batch.skipped,
      durationMs,
    });

    return normalizerOk(this.provider, batch, durationMs, ctx?.integrationId);
  }

  normalizeStores(raw: unknown, ctx?: NormalizerContext) {
    return this.bulk<CanonicalStore>("store", raw, ctx, (r, c) => this.normalizeStore(r, c));
  }
  normalizeCoupons(raw: unknown, ctx?: NormalizerContext) {
    return this.bulk<CanonicalCoupon>("coupon", raw, ctx, (r, c) => this.normalizeCoupon(r, c));
  }
  normalizeDeals(raw: unknown, ctx?: NormalizerContext) {
    return this.bulk<CanonicalDeal>("deal", raw, ctx, (r, c) => this.normalizeDeal(r, c));
  }
  normalizeCategories(raw: unknown, ctx?: NormalizerContext) {
    return this.bulk<CanonicalCategory>("category", raw, ctx, (r, c) => this.normalizeCategory(r, c));
  }
}
