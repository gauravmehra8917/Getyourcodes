// Impact (impact.com) Media Partner API adapter.
//
// All HTTP, auth, retries, logging and response standardisation are handled
// by the Integration Engine — this file only knows *which* endpoints to call
// and how to pull the record array out of Impact's envelope. No normalization.

import { BaseProviderAdapter } from "../BaseProviderAdapter";
import { ImpactOfferEnricher, type OfferEnricher } from "@/lib/enrichment";
import { logDebug } from "@/lib/integration-engine/logger.server";
import type { HealthResult } from "@/lib/integration-engine/health-check.server";
import type {
  ErrorClass,
  HttpRequestOptions,
  StandardResponse,
} from "@/lib/integration-engine/types";
import type {
  FetchOptions,
  ProviderCoupon,
  ProviderDeal,
  ProviderPagination,
  ProviderResult,
  ProviderStore,
} from "../ProviderAdapter";

/** Impact wraps collections in an envelope, e.g. { Campaigns: [...], "@page": 1 }. */
type ImpactEnvelope = Record<string, unknown>;

const ENVELOPE_KEYS: Record<string, string[]> = {
  campaigns: ["Campaigns"],
  promotions: ["Promotions", "Ads"],
  catalogs: ["Catalogs"],
  ads: ["Ads", "Promotions"],
};

function extractRecords(body: unknown, keys: string[]): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const env = body as ImpactEnvelope;
  for (const k of keys) {
    const v = env[k];
    if (Array.isArray(v)) return v;
  }
  // Fall back to the first array-valued property in the envelope.
  for (const v of Object.values(env)) if (Array.isArray(v)) return v;
  return [];
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return undefined;
}

function pageFromUri(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const uri = new URL(value, "https://impact.invalid");
    for (const [key, page] of uri.searchParams) {
      if (key.toLowerCase() === "page") return asPositiveInteger(page);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Map Impact's documented envelope metadata into the provider-neutral contract. */
export function extractImpactPagination(body: unknown): ProviderPagination | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const env = body as ImpactEnvelope;
  const page = asPositiveInteger(env["@page"] ?? env.Page);
  const pageCount = asPositiveInteger(env["@numpages"] ?? env.NumPages);
  const nextPage = pageFromUri(env["@nextpageuri"] ?? env.NextPageUri) ??
    asPositiveInteger(env["@nextpage"] ?? env.NextPage);

  if (!page && !pageCount && !nextPage) return undefined;
  if (page && pageCount) {
    const hasNextPage = page < pageCount;
    return { hasNextPage, nextPage: hasNextPage ? (nextPage ?? page + 1) : null };
  }
  if (nextPage) return { hasNextPage: true, nextPage };
  return { hasNextPage: false, nextPage: null };
}

function friendlyError(cls: ErrorClass | undefined, status: number, fallback: string): string {
  switch (cls) {
    case "authentication_error":
      return "Impact rejected the credentials (check Account SID / Auth Token)";
    case "authorization_error":
      return "Impact denied access to this resource (permission denied)";
    case "rate_limited":
      return "Impact rate limit reached — retry later";
    case "server_error":
      return `Impact server error (HTTP ${status})`;
    case "timeout":
      return "Impact request timed out";
    case "network_error":
      return "Could not reach Impact";
    default:
      if (status === 404) return "Impact endpoint not found (check the configured path)";
      return fallback;
  }
}

export class ImpactAdapter extends BaseProviderAdapter {
  readonly providerKey = "impact";

  /** Endpoint keys as stored on the integration, with sane Impact defaults. */
  private endpointFor(key: "health" | "campaigns" | "promotions" | "catalogs" | "ads"): string {
    const cfg = this.getConfig();
    const e = cfg.endpoints ?? {};
    const pick = (...names: string[]) => {
      for (const n of names) {
        const v = (e[n] ?? "").trim();
        if (v) return v;
      }
      return "";
    };
    switch (key) {
      case "health":
        return pick("health") || "/Mediapartners/{AccountSID}";
      case "campaigns":
        return pick("campaigns", "stores", "advertisers") || "/Mediapartners/{AccountSID}/Campaigns";
      case "promotions":
        return (
          pick("promotions", "deals", "coupons") || "/Mediapartners/{AccountSID}/Promotions"
        );
      case "catalogs":
        return pick("catalogs") || "/Mediapartners/{AccountSID}/Catalogs";
      case "ads":
        return pick("ads") || "/Mediapartners/{AccountSID}/Ads";
    }
  }

  private errorResponse<T>(message: string, cls: ErrorClass = "validation_error"): StandardResponse<T> {
    const cfg = this.getConfig();
    return {
      success: false,
      status: 0,
      latencyMs: 0,
      headers: {},
      body: null,
      error: { class: cls, message },
      retryCount: 0,
      meta: {
        integrationId: cfg.id,
        method: "GET",
        url: cfg.baseUrl,
        at: new Date().toISOString(),
      },
    };
  }

  /** Single place where every Impact collection call goes through the engine. */
  private async call<T>(
    label: string,
    path: string,
    opts?: FetchOptions,
    extra?: HttpRequestOptions,
  ): Promise<StandardResponse<T>> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (opts?.page != null) query.Page = opts.page;
    if (opts?.pageSize != null) query.PageSize = opts.pageSize;
    for (const [k, v] of Object.entries(opts ?? {})) {
      if (k === "page" || k === "pageSize" || k === "since") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") query[k] = v;
    }

    const res = await this.engine.request<T>({
      method: "GET",
      path,
      query,
      ...extra,
    });

    if (!res.success) {
      res.error = {
        class: res.error?.class ?? "unknown_error",
        message: friendlyError(res.error?.class, res.status, res.error?.message ?? "Impact request failed"),
      };
    }

    logDebug("impact", {
      provider: this.providerKey,
      endpoint: path,
      status: res.status,
      latencyMs: res.latencyMs,
      records: Array.isArray(res.body)
        ? res.body.length
        : extractRecords(res.body, ENVELOPE_KEYS[label] ?? []).length,
      outcome: res.success ? "success" : "failure",
    });

    return res;
  }

  /** Wrap a raw collection call so the body is always the record array. */
  private async collection<T>(
    label: keyof typeof ENVELOPE_KEYS,
    path: string,
    opts?: FetchOptions,
  ): Promise<ProviderResult<T[]>> {
    const res = await this.call<unknown>(label, path, opts);
    const records = res.success ? extractRecords(res.body, ENVELOPE_KEYS[label]) : null;
    const pagination = res.success ? extractImpactPagination(res.body) : undefined;
    return { ...res, body: records as T[] | null, ...(pagination ? { pagination } : {}) };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    await super.initialize();
  }

  /** Config sanity check, returned as a StandardResponse. */
  verify(): StandardResponse<{ ok: boolean; checks: string[] }> {
    const cfg = this.getConfig();
    const errors: string[] = [];
    const checks: string[] = [];

    if (!/impact/i.test(cfg.providerName)) errors.push(`Provider is "${cfg.providerName}", expected Impact`);
    else checks.push("provider=impact");

    if (cfg.authenticationType !== "basic") errors.push(`Authentication is "${cfg.authenticationType}", Impact requires Basic`);
    else checks.push("auth=basic");

    if (!cfg.baseUrl) errors.push("Base URL is missing");
    else checks.push("baseUrl");

    if (!this.endpointFor("health")) errors.push("Health endpoint is missing");
    else checks.push("endpoint:health");

    const v = this.validateConfiguration();
    if (!v.ok) errors.push(...v.errors);

    if (errors.length) return this.errorResponse(errors.join("; "));

    return {
      success: true,
      status: 200,
      latencyMs: 0,
      headers: {},
      body: { ok: true, checks },
      error: null,
      retryCount: 0,
      meta: {
        integrationId: cfg.id,
        method: "GET",
        url: cfg.baseUrl,
        at: new Date().toISOString(),
      },
    };
  }

  /** Impact uses Basic auth on every request — the engine attaches it. */
  async authenticate(): Promise<ProviderResult<{ authenticated: boolean }>> {
    const pre = this.verify();
    if (!pre.success) {
      return { ...pre, body: { authenticated: false } } as ProviderResult<{ authenticated: boolean }>;
    }
    const health = await this.healthCheck();
    return {
      ...health.response,
      body: { authenticated: health.state === "healthy" },
    } as ProviderResult<{ authenticated: boolean }>;
  }

  async healthCheck(): Promise<HealthResult & { accountId?: string; accountName?: string }> {
    const res = await this.call<Record<string, unknown>>("campaigns", this.endpointFor("health"), undefined, {
      retryAttempts: 0,
    });
    const body = (res.body ?? {}) as Record<string, unknown>;
    const accountId = typeof body.Id === "string" ? body.Id : undefined;
    const accountName = typeof body.Name === "string" ? body.Name : undefined;

    const state = res.success
      ? "healthy"
      : res.error?.class === "server_error" ||
          res.error?.class === "rate_limited" ||
          res.error?.class === "timeout"
        ? "warning"
        : "failed";

    return {
      state,
      status: res.status,
      latencyMs: res.latencyMs,
      message: res.success
        ? `Connected${accountName ? ` as ${accountName}` : ""}`
        : (res.error?.message ?? "Health check failed"),
      response: res,
      accountId,
      accountName,
    };
  }

  // ── Data ─────────────────────────────────────────────────────────────────

  fetchCampaigns(opts?: FetchOptions): Promise<ProviderResult<unknown[]>> {
    return this.collection<unknown>("campaigns", this.endpointFor("campaigns"), opts);
  }

  fetchPromotions(opts?: FetchOptions): Promise<ProviderResult<unknown[]>> {
    return this.collection<unknown>("promotions", this.endpointFor("promotions"), opts);
  }

  fetchCatalogs(opts?: FetchOptions): Promise<ProviderResult<unknown[]>> {
    return this.collection<unknown>("catalogs", this.endpointFor("catalogs"), opts);
  }

  /** Coupon ads — the enrichment source for the Promotions stream. */
  fetchCouponAds(opts?: FetchOptions): Promise<ProviderResult<unknown[]>> {
    return this.collection<unknown>("ads", this.endpointFor("ads"), { ...opts, Type: "COUPON" });
  }

  /** Offer Enrichment capability (see src/lib/enrichment). */
  createOfferEnricher(): OfferEnricher {
    return new ImpactOfferEnricher({
      fetchAds: async (page, pageSize) => (await this.fetchCouponAds({ page, pageSize })).body,
      fetchCampaigns: async (page, pageSize) => (await this.fetchCampaigns({ page, pageSize })).body,
    });
  }

  /** Impact campaigns represent merchants — reuse fetchCampaigns, no extra HTTP. */
  async fetchStores(opts?: FetchOptions): Promise<ProviderResult<ProviderStore[]>> {
    const res = await this.fetchCampaigns(opts);
    return res as unknown as ProviderResult<ProviderStore[]>;
  }

  /** Promotions cover both deals and coupons; classification lands in Phase 2C. */
  async fetchDeals(opts?: FetchOptions): Promise<ProviderResult<ProviderDeal[]>> {
    const res = await this.fetchPromotions(opts);
    return res as unknown as ProviderResult<ProviderDeal[]>;
  }

  async fetchCoupons(opts?: FetchOptions): Promise<ProviderResult<ProviderCoupon[]>> {
    const res = await this.fetchPromotions(opts);
    return res as unknown as ProviderResult<ProviderCoupon[]>;
  }
}
