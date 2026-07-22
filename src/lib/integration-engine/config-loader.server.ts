// Config loader: reads an integration row (Milestone 1 schema) and its
// encrypted credential blob, decrypts on the server, and returns an
// IntegrationConfig ready for the engine.
//
// Never returns decrypted credentials to the browser — callers are
// server functions / server routes only.

import type {
  AuthenticationType,
  CustomHeader,
  IntegrationConfig,
  IntegrationCredentials,
} from "./types";

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

  return {
    id: row.id,
    name: row.integration_name,
    providerName: row.provider_name,
    providerType: row.provider_type,
    authenticationType: row.authentication_type as AuthenticationType,
    baseUrl: row.base_url,
    apiVersion: row.api_version ?? "",
    timeoutMs: Math.min(600_000, Math.max(1_000, (row.timeout_seconds ?? 30) * 1000)),
    retryAttempts: Math.max(0, Math.min(20, row.retry_attempts ?? 0)),
    customHeaders: (row.custom_headers as CustomHeader[] | null) ?? [],
    endpoints: (row.endpoint_configuration as Record<string, string> | null) ?? {},
    environment: row.environment ?? "production",
    isEnabled: !!row.is_enabled,
    credentials,
  };
}
