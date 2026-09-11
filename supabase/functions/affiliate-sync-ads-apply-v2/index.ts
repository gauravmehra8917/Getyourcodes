// Trusted coded-Impact-Ads apply host. The request supplies intent only.

import { AdsPersistencePlannerV2 } from "../_shared/affiliate-sync-v2-ads-persistence/index.ts";
import { DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2 } from "../_shared/affiliate-sync-v2-ads/index.ts";
import { createAuthenticatedEdgeClient } from "../_shared/edge-supabase.ts";
import { decryptCredentialsWebCrypto } from "../_shared/integration-crypto.ts";
import { ImpactAdsApplyTransportHost } from "./ads-transport-host.ts";
import { createAffiliateSyncAdsApplyV2Handler } from "./handler.ts";
import { prepareAdsPersistenceExecutionV2 } from "./persistence-execution.ts";
import { SupabaseAdsApplyV2DataSource } from "./supabase-persistence-boundary.ts";

const handler = createAffiliateSyncAdsApplyV2Handler({
  async verifyUser(authorization, jwt) {
    const authenticated = createAuthenticatedEdgeClient(authorization);
    const { data, error } = await authenticated.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  createDataSource: () => new SupabaseAdsApplyV2DataSource(),
  async decryptCredentialEnvelope(ciphertext) {
    const secret = Deno.env.get("INTEGRATION_CREDENTIAL_SECRET");
    if (!secret) throw new Error("credential_decryption_unavailable");
    return await decryptCredentialsWebCrypto(ciphertext, secret);
  },
  createImpactTransport: (
    credentials,
    approvedCredentialOrigin,
    maximumResponseBytes,
  ) =>
    new ImpactAdsApplyTransportHost({
      credentials,
      approvedCredentialOrigin,
      maxResponseBytes: Math.min(
        maximumResponseBytes,
        DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2.maxResponseBytes,
      ),
    }),
  persistencePlan: (input) => AdsPersistencePlannerV2.plan(input),
  prepareExecution: (plan, triggeredBy) =>
    prepareAdsPersistenceExecutionV2(plan, triggeredBy),
  now: () => new Date(),
  siteUrl: Deno.env.get("SITE_URL") ?? null,
});

Deno.serve(handler);
