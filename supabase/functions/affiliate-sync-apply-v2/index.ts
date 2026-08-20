// Isolated trusted V2 apply host. The browser supplies no executable plan data.

import {
  ImpactFetchOrchestrator,
  PersistencePlannerV2,
  PreviewPlanner,
} from "../_shared/affiliate-sync-v2/index.ts";
import { createAuthenticatedEdgeClient } from "../_shared/edge-supabase.ts";
import { decryptCredentialsWebCrypto } from "../_shared/integration-crypto.ts";
import { ImpactTransportHost } from "../affiliate-sync-preview-v2/ImpactTransportHost.ts";
import { createAffiliateSyncApplyV2Handler } from "./handler.ts";
import { preparePersistenceExecution } from "./persistence-execution.ts";
import { SupabaseApplyV2DataSource } from "./supabase-persistence-boundary.ts";

const handler = createAffiliateSyncApplyV2Handler({
  async verifyUser(authorization, jwt) {
    const authenticated = createAuthenticatedEdgeClient(authorization);
    const { data, error } = await authenticated.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  createDataSource: () => new SupabaseApplyV2DataSource(),
  async decryptCredentialEnvelope(ciphertext) {
    const secret = Deno.env.get("INTEGRATION_CREDENTIAL_SECRET");
    if (!secret) throw new Error("credential_decryption_unavailable");
    return await decryptCredentialsWebCrypto(ciphertext, secret);
  },
  createImpactTransport: (credentials, approvedCredentialOrigin) =>
    new ImpactTransportHost({ credentials, approvedCredentialOrigin }),
  retrieveImpact: (input) => ImpactFetchOrchestrator.retrieve(input),
  previewPlan: (input) => PreviewPlanner.plan(input),
  persistencePlan: (input) => PersistencePlannerV2.plan(input),
  prepareExecution: (plan, triggeredBy) =>
    preparePersistenceExecution(plan, triggeredBy),
  now: () => new Date(),
  siteUrl: Deno.env.get("SITE_URL") ?? null,
});

Deno.serve(handler);
