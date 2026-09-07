// Isolated, authenticated, read-only source evidence host.

import { createAuthenticatedEdgeClient } from "../_shared/edge-supabase.ts";
import { decryptCredentialsWebCrypto } from "../_shared/integration-crypto.ts";
import { createAffiliateSyncSourceAuditV2Handler } from "./handler.ts";
import { ImpactAuditTransportHost } from "./ImpactAuditTransportHost.ts";
import { SupabaseSourceAuditV2DataSource } from "./supabase-read-boundary.ts";

const handler = createAffiliateSyncSourceAuditV2Handler({
  async verifyUser(authorization, jwt) {
    const authenticated = createAuthenticatedEdgeClient(authorization);
    const { data, error } = await authenticated.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  createDataSource: () => new SupabaseSourceAuditV2DataSource(),
  async decryptCredentialEnvelope(ciphertext) {
    const secret = Deno.env.get("INTEGRATION_CREDENTIAL_SECRET");
    if (!secret) throw new Error("credential_decryption_unavailable");
    return await decryptCredentialsWebCrypto(ciphertext, secret);
  },
  createImpactTransport: (credentials, approvedCredentialOrigin) =>
    new ImpactAuditTransportHost({ credentials, approvedCredentialOrigin }),
  siteUrl: Deno.env.get("SITE_URL") ?? null,
});

Deno.serve(handler);
