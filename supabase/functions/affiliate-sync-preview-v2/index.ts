// Isolated, read-only V2 preview host. It has no persistence/import executor.

import { createAuthenticatedEdgeClient } from "../_shared/edge-supabase.ts";
import { decryptCredentialsWebCrypto } from "../_shared/integration-crypto.ts";
import { createAffiliateSyncPreviewV2Handler } from "./handler.ts";
import { ImpactTransportHost } from "./ImpactTransportHost.ts";
import { SupabasePreviewV2DataSource } from "./supabase-read-boundary.ts";

const handler = createAffiliateSyncPreviewV2Handler({
  async verifyUser(authorization, jwt) {
    const authenticated = createAuthenticatedEdgeClient(authorization);
    const { data, error } = await authenticated.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  createDataSource: () => new SupabasePreviewV2DataSource(),
  async decryptCredentialEnvelope(ciphertext) {
    const secret = Deno.env.get("INTEGRATION_CREDENTIAL_SECRET");
    if (!secret) throw new Error("credential_decryption_unavailable");
    return await decryptCredentialsWebCrypto(ciphertext, secret);
  },
  createImpactTransport: (credentials, approvedCredentialOrigin) =>
    new ImpactTransportHost({ credentials, approvedCredentialOrigin }),
  now: () => new Date(),
  siteUrl: Deno.env.get("SITE_URL") ?? null,
});

Deno.serve(handler);
