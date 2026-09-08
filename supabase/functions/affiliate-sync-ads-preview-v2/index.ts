// Isolated, authenticated and strictly read-only Impact Coupon Ads preview.

import {
  DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2,
} from "../_shared/affiliate-sync-v2-ads/index.ts";
import { createAuthenticatedEdgeClient } from "../_shared/edge-supabase.ts";
import { decryptCredentialsWebCrypto } from "../_shared/integration-crypto.ts";
import { ImpactAdsTransportHost } from "./ads-transport-host.ts";
import { createAffiliateSyncAdsPreviewV2Handler } from "./handler.ts";
import { SupabaseAdsPreviewV2DataSource } from "./supabase-read-boundary.ts";

const handler = createAffiliateSyncAdsPreviewV2Handler({
  async verifyUser(authorization, jwt) {
    const authenticated = createAuthenticatedEdgeClient(authorization);
    const { data, error } = await authenticated.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  createDataSource: () => new SupabaseAdsPreviewV2DataSource(),
  async decryptCredentialEnvelope(ciphertext) {
    const secret = Deno.env.get("INTEGRATION_CREDENTIAL_SECRET");
    if (!secret) throw new Error("credential_decryption_unavailable");
    return await decryptCredentialsWebCrypto(ciphertext, secret);
  },
  createImpactTransport: (credentials, approvedCredentialOrigin) =>
    new ImpactAdsTransportHost({
      credentials,
      approvedCredentialOrigin,
      maxResponseBytes: DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2.maxResponseBytes,
    }),
  now: () => new Date().toISOString(),
  siteUrl: Deno.env.get("SITE_URL") ?? null,
});

Deno.serve(handler);
