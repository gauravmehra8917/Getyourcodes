import {
  createAuthenticatedEdgeClient,
  createPrivilegedEdgeClient,
} from "../_shared/edge-supabase.ts";
import { decryptCredentialsWebCrypto } from "../_shared/integration-crypto.ts";
import { ImpactAdsTransportHost } from "../affiliate-sync-ads-preview-v2/ads-transport-host.ts";
import { createCategoryCanaryHandler } from "./handler.ts";
import { SupabaseCategoryCanaryDataSource } from "./supabase-canary-boundary.ts";
import { RESPONSE_BYTE_LIMIT } from "./types.ts";

Deno.serve(
  createCategoryCanaryHandler({
    siteUrl: Deno.env.get("SITE_URL") ?? null,
    async verifyUser(authorization, jwt) {
      const { data, error } = await createAuthenticatedEdgeClient(authorization).auth.getUser(jwt);
      return error || !data.user ? null : { id: data.user.id };
    },
    createDataSource: () => new SupabaseCategoryCanaryDataSource(createPrivilegedEdgeClient()),
    async decryptCredentialEnvelope(ciphertext) {
      const secret = Deno.env.get("INTEGRATION_CREDENTIAL_SECRET");
      if (!secret) throw new Error("credential_decryption_unavailable");
      return await decryptCredentialsWebCrypto(ciphertext, secret);
    },
    createImpactTransport: (credentials, approvedCredentialOrigin) =>
      new ImpactAdsTransportHost({
        credentials,
        approvedCredentialOrigin,
        maxResponseBytes: RESPONSE_BYTE_LIMIT,
      }),
  }),
);
