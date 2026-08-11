// Config loader: reads an integration row (Milestone 1 schema) and its
// encrypted credential blob, decrypts on the server, and returns an
// IntegrationConfig ready for the engine.
//
// Never returns decrypted credentials to the browser — callers are
// server functions / server routes only.

import type {
  CustomHeader,
  IntegrationConfig,
  IntegrationCredentials,
} from "./types";
import { mapIntegrationConfig } from "./config-model";

export async function loadIntegrationConfig(integrationId: string): Promise<IntegrationConfig> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { decryptCredentials } = await import("@/lib/integration-crypto.server");

  const { data: row, error } = await supabaseAdmin
    .from("affiliate_integrations")
    .select(
      "id, integration_name, provider_name, provider_type, authentication_type, base_url, api_version, timeout_seconds, retry_attempts, custom_headers, endpoint_configuration, environment, is_enabled",
    )
    .eq("id", integrationId)
    .single();

  if (error || !row) {
    throw new Error(`Integration not found: ${integrationId}`);
  }

  const { data: credRow } = await supabaseAdmin
    .from("affiliate_integration_credentials")
    .select("ciphertext")
    .eq("integration_id", integrationId)
    .maybeSingle();

  let credentials: IntegrationCredentials = {};
  if (credRow?.ciphertext) {
    try {
      const parsed = JSON.parse(decryptCredentials(credRow.ciphertext)) as IntegrationCredentials & {
        customHeaders?: CustomHeader[];
      };
      credentials = parsed ?? {};
    } catch {
      // Never expose decryption details; treat as no credentials.
      credentials = {};
    }
  }

  return mapIntegrationConfig(row, credentials);
}
