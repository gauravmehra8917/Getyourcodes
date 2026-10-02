import assert from "node:assert/strict";
import type {
  CategoryMappingFact,
  StoreCategoryFact,
} from "../../_shared/affiliate-store-category-v1/planner.ts";
import type { StoredIntegrationV2 } from "../../_shared/affiliate-sync-v2-host/types.ts";
import type {
  ImpactAdsTransportRequestV2,
  ImpactAdsTransportV2,
} from "../../_shared/affiliate-sync-v2-ads/ads-diagnostics.ts";
import { createCategoryCanaryHandler } from "../handler.ts";
import type {
  CategoryCanaryDataSource,
  CategoryCanaryDependencies,
  CategoryCanaryEvidence,
  CategoryCanaryResult,
} from "../types.ts";

export const ID = "11111111-1111-4111-8111-111111111111";
export const USER = "22222222-2222-4222-8222-222222222222";
export const STORE = "33333333-3333-4333-8333-333333333333";
export const CATEGORY = "44444444-4444-4444-8444-444444444444";
export const OTHER = "55555555-5555-4555-8555-555555555555";
export const ORIGIN = "https://admin.example";
export const integration: StoredIntegrationV2 = {
  id: ID,
  providerName: "impact",
  authenticationType: "basic",
  baseUrl: "https://api.impact.com",
  endpointConfiguration: { campaigns: "/Mediapartners/{AccountSID}/Campaigns" },
  isEnabled: true,
  timeoutSeconds: 30,
  retryAttempts: 10,
  pageSize: 100,
  maxPages: 50,
  publishingPolicyId: null,
};
export const store: StoreCategoryFact = {
  id: STORE,
  provider: "impact",
  providerEntityNamespace: "campaign",
  providerEntityId: "private-campaign",
  categoryId: null,
};
export const mapping: CategoryMappingFact = {
  id: USER,
  provider: "impact",
  normalizedProviderCategoryKey: "fashion",
  categoryId: CATEGORY,
  priority: 100,
  enabled: true,
};

/** Fixture-only transaction model. SQL itself is verified statically, never executed. */
export function revalidateFixture(
  evidence: CategoryCanaryEvidence,
  stores: StoreCategoryFact[],
  categories: string[],
  mappings: CategoryMappingFact[],
): CategoryCanaryResult {
  const target = stores.find((row) => row.id === evidence.storeId);
  if (
    !target ||
    target.provider !== "impact" ||
    target.providerEntityNamespace !== "campaign" ||
    target.providerEntityId !== evidence.campaignId
  )
    return { status: "blocked", outcome: "store_identity_mismatch" };
  if (target.categoryId !== null)
    return { status: "noop_existing_category", outcome: "noop_existing_category" };
  if (!categories.includes(evidence.categoryId))
    return { status: "blocked", outcome: "category_not_found" };
  const matches = mappings.filter(
    (row) =>
      row.provider === "impact" &&
      row.enabled &&
      evidence.providerCategoryKeys.includes(row.normalizedProviderCategoryKey),
  );
  if (!matches.length) return { status: "blocked", outcome: "mapping_unmapped" };
  const priority = Math.min(...matches.map((row) => row.priority));
  const targets = new Set(
    matches.filter((row) => row.priority === priority).map((row) => row.categoryId),
  );
  if (targets.size !== 1) return { status: "blocked", outcome: "mapping_ambiguous" };
  if (!targets.has(evidence.categoryId)) return { status: "blocked", outcome: "mapping_stale" };
  target.categoryId = evidence.categoryId;
  return { status: "assigned", outcome: "assigned" };
}

export function harness(
  options: {
    user?: { id: string } | null;
    admin?: boolean;
    integration?: StoredIntegrationV2 | null;
    stores?: StoreCategoryFact[];
    mappings?: CategoryMappingFact[];
    categories?: string[];
    body?: unknown;
    failAt?: string;
    siteUrl?: string | null;
    beforeRpc?: (state: {
      stores: StoreCategoryFact[];
      mappings: CategoryMappingFact[];
      categories: string[];
    }) => void;
  } = {},
) {
  const operations: string[] = [];
  const requests: ImpactAdsTransportRequestV2[] = [];
  const calls: CategoryCanaryEvidence[] = [];
  const state = {
    stores: structuredClone(options.stores ?? [store]),
    mappings: structuredClone(options.mappings ?? [mapping]),
    categories: [...(options.categories ?? [CATEGORY, OTHER])],
  };
  const op = (name: string) => {
    operations.push(name);
    if (options.failAt === name) throw new Error("private-token SQL credentials raw-provider-data");
  };
  const source: CategoryCanaryDataSource = {
    async hasAdminRole() {
      op("admin");
      return options.admin ?? true;
    },
    async readIntegration() {
      op("integration");
      return options.integration === undefined ? integration : options.integration;
    },
    async readStores() {
      op("stores");
      return structuredClone(state.stores);
    },
    async readCategoryIds() {
      op("categories");
      return [...state.categories];
    },
    async readMappings() {
      op("mappings");
      return structuredClone(state.mappings);
    },
    async readCredentialCiphertext() {
      op("ciphertext");
      return "private-ciphertext";
    },
    async applyCanary(evidence) {
      op("rpc");
      calls.push(structuredClone(evidence));
      options.beforeRpc?.(state);
      return revalidateFixture(evidence, state.stores, state.categories, state.mappings);
    },
  };
  const transport: ImpactAdsTransportV2 = {
    async execute(req) {
      op("fetch");
      requests.push(req);
      return {
        kind: "response",
        status: 200,
        retryAfterMs: null,
        bodyText: JSON.stringify(
          options.body ?? {
            Campaigns: [
              {
                CampaignId: "private-campaign",
                Category: "Fashion",
                TrackingLink: "private-url",
                Credential: "raw-provider-data",
              },
            ],
          },
        ),
      };
    },
    async wait() {
      throw new Error("no retries allowed");
    },
    readRateSnapshot: () => ({ limit: null, remaining: null, reset: null }),
    consumeResponseSizeLimitExceeded: () => false,
  };
  const dependencies: CategoryCanaryDependencies = {
    siteUrl: options.siteUrl === undefined ? ORIGIN : options.siteUrl,
    async verifyUser(authorization, jwt) {
      op("verify");
      assert.equal(authorization, "Bearer verified-jwt");
      assert.equal(jwt, "verified-jwt");
      return options.user === undefined ? { id: USER } : options.user;
    },
    createDataSource() {
      op("source");
      return source;
    },
    async decryptCredentialEnvelope() {
      op("decrypt");
      return JSON.stringify({ accountSid: "private-account", authToken: "private-token" });
    },
    createImpactTransport(credentials, origin) {
      op("transport");
      assert.equal(origin, "https://api.impact.com");
      assert.equal(credentials.authToken, "private-token");
      return transport;
    },
  };
  return {
    handler: createCategoryCanaryHandler(dependencies),
    dependencies,
    source,
    operations,
    requests,
    calls,
    state,
  };
}

export function request(
  body: unknown = { integrationId: ID, apply: true, mode: "canary" },
  options: { origin?: string | null; authorization?: string | null; method?: string } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const auth = options.authorization === undefined ? "Bearer verified-jwt" : options.authorization;
  if (origin !== null) headers.set("Origin", origin);
  if (auth !== null) headers.set("Authorization", auth);
  const method = options.method ?? "POST";
  return new Request("https://edge.example/category-canary", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}
