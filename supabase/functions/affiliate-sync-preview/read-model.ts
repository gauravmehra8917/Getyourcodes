// Edge-only read boundary for Preview Import. It returns plain data only; no
// database client crosses into SyncEngine or prepareImportPreview.

import { createPrivilegedEdgeClient } from "../_shared/edge-supabase.ts";
import { decryptCredentialsWebCrypto } from "../_shared/integration-crypto.ts";
import {
  FALLBACK_POLICY,
  mapIntegrationConfig,
  mapPolicyRow,
  resolveProviderKey,
} from "./import-boundary.ts";
import type { IntegrationConfig, IntegrationCredentials } from "../_shared/affiliate-sync-core/integration-engine/types.ts";
import type { ExistingRow } from "../_shared/affiliate-sync-core/import/EntityMatcher.ts";
import type { ExistingData } from "../_shared/affiliate-sync-core/import/ImportPlanner.ts";
import type { PolicyContext, PublishingPolicy } from "../_shared/affiliate-sync-core/publishing-policy/types.ts";

type Row = Record<string, unknown>;

const INTEGRATION_SELECT = "id, integration_name, provider_name, provider_type, authentication_type, base_url, api_version, timeout_seconds, retry_attempts, custom_headers, endpoint_configuration, environment, is_enabled, publishing_policy_id, orchestration_strategy, orchestration_page_size, orchestration_max_pages, orchestration_max_api_calls, orchestration_no_new_pages";
const POLICY_SELECT = "id, name, description, enabled, is_default, min_coupons_per_store, max_coupons_per_store, min_deals_per_store, max_deals_per_store, ranking_priority, fair_distribution, rotation, publish_only_active, skip_expired, skip_duplicate_identities, respect_manual_disable, never_overwrite_admin_edits, preview_before_import";
const OFFER_ID_PAGE_SIZE = 1000;

export interface PreviewReadModel {
  config: IntegrationConfig;
  provider: string;
  existing: ExistingData;
  existingProviderOfferIds: Set<string>;
  policy: PublishingPolicy;
  policyContext: PolicyContext;
  orchestration: {
    strategy: string | null;
    pageSize: number | null;
    maxPages: number | null;
    maxApiCalls: number | null;
    consecutiveNoNewPages: number | null;
  };
  warnings: string[];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapExisting(rows: Row[] | null | undefined, provider: string): ExistingRow[] {
  return (rows ?? []).map((row) => ({
    id: String(row.id),
    slug: text(row.slug),
    providerEntityId: row.provider === provider ? text(row.provider_entity_id) : null,
    lifecycleManaged: row.lifecycle_managed === true,
    lifecycleHidden: row.lifecycle_hidden === true,
  }));
}

async function loadPolicy(db: ReturnType<typeof createPrivilegedEdgeClient>, integration: Row): Promise<PublishingPolicy> {
  const assigned = text(integration.publishing_policy_id);
  if (assigned) {
    const { data } = await db.from("publishing_policies").select(POLICY_SELECT).eq("id", assigned).maybeSingle();
    if (data) return mapPolicyRow(data as Row);
  }
  const { data: fallback } = await db.from("publishing_policies").select(POLICY_SELECT).eq("is_default", true).maybeSingle();
  return fallback ? mapPolicyRow(fallback as Row) : FALLBACK_POLICY;
}

async function loadExistingOfferIds(db: ReturnType<typeof createPrivilegedEdgeClient>, provider: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += OFFER_ID_PAGE_SIZE) {
    const { data, error } = await db.from("coupons").select("provider_entity_id").eq("provider", provider).not("provider_entity_id", "is", null).range(from, from + OFFER_ID_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    for (const row of rows) { const id = text(row.provider_entity_id); if (id) ids.add(id); }
    if (rows.length < OFFER_ID_PAGE_SIZE) break;
  }
  return ids;
}

async function loadPolicyContext(db: ReturnType<typeof createPrivilegedEdgeClient>, policy: PublishingPolicy, provider: string): Promise<PolicyContext> {
  const context: PolicyContext = { rotation: {}, merchantPriority: {}, manuallyDisabledIds: [] };
  if (policy.rotation && policy.id !== FALLBACK_POLICY.id) {
    const { data } = await db.from("publishing_rotation_state").select("store_key, cursor").eq("policy_id", policy.id).eq("provider", provider);
    for (const row of (data ?? []) as Row[]) {
      const key = text(row.store_key); const cursor = numberOrNull(row.cursor);
      if (key && cursor != null) context.rotation![key] = cursor;
    }
  }
  const { data: featured } = await db.from("stores").select("provider_entity_id, featured").eq("provider", provider).eq("featured", true);
  for (const row of (featured ?? []) as Row[]) { const id = text(row.provider_entity_id); if (id) context.merchantPriority![id] = 1; }
  if (policy.respectManualDisable) {
    const { data: drafts } = await db.from("coupons").select("id").eq("provider", provider).eq("status", "draft");
    context.manuallyDisabledIds = ((drafts ?? []) as Row[]).map((row) => String(row.id));
  }
  return context;
}

export async function loadPreviewReadModel(integrationId: string): Promise<PreviewReadModel> {
  const db = createPrivilegedEdgeClient();
  const { data: integrationData, error: integrationError } = await db.from("affiliate_integrations").select(INTEGRATION_SELECT).eq("id", integrationId).maybeSingle();
  if (integrationError || !integrationData) throw new Error(integrationError?.message ?? "Integration not found");
  const integration = integrationData as Row;

  const { data: credentialData, error: credentialError } = await db.from("affiliate_integration_credentials").select("ciphertext").eq("integration_id", integrationId).maybeSingle();
  if (credentialError) throw new Error("Could not read integration credentials");
  const ciphertext = credentialData && typeof (credentialData as Row).ciphertext === "string" ? (credentialData as Row).ciphertext as string : null;
  let credentials: IntegrationCredentials = {};
  if (ciphertext) {
    const secret = Deno.env.get("INTEGRATION_CREDENTIAL_SECRET");
    if (!secret) throw new Error("Credential decryption is unavailable");
    credentials = JSON.parse(await decryptCredentialsWebCrypto(ciphertext, secret)) as IntegrationCredentials;
  }

  const config = mapIntegrationConfig(integration, credentials);
  const provider = resolveProviderKey({ provider_name: config.providerName, provider_type: config.providerType });
  const warnings: string[] = [];
  let existing: ExistingData = { stores: [], categories: [], coupons: [] };
  try {
    const [stores, categories, coupons] = await Promise.all([
      db.from("stores").select("id,slug,provider,provider_entity_id,lifecycle_managed,lifecycle_hidden"),
      db.from("categories").select("id,slug,provider,provider_entity_id"),
      db.from("coupons").select("id,provider,provider_entity_id").eq("provider", provider),
    ]);
    if (stores.error || categories.error || coupons.error) throw new Error(stores.error?.message ?? categories.error?.message ?? coupons.error?.message ?? "Could not load existing catalog data");
    existing = { stores: mapExisting(stores.data as Row[], provider), categories: mapExisting(categories.data as Row[], provider), coupons: mapExisting(coupons.data as Row[], provider) };
  } catch (error) {
    warnings.push(`could not load existing rows (${error instanceof Error ? error.message : String(error)}); planning as first import`);
  }

  const policy = await loadPolicy(db, integration);
  const [existingProviderOfferIds, policyContext] = await Promise.all([
    loadExistingOfferIds(db, provider),
    loadPolicyContext(db, policy, provider),
  ]);
  return {
    config, provider, existing, existingProviderOfferIds, policy, policyContext, warnings,
    orchestration: {
      strategy: text(integration.orchestration_strategy), pageSize: numberOrNull(integration.orchestration_page_size),
      maxPages: numberOrNull(integration.orchestration_max_pages), maxApiCalls: numberOrNull(integration.orchestration_max_api_calls),
      consecutiveNoNewPages: numberOrNull(integration.orchestration_no_new_pages),
    },
  };
}
