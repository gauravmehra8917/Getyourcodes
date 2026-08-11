// Read-only Lovable Cloud preflight for the future affiliate-sync Edge boundary.
// It deliberately does not call providers, SyncEngine, ImportPipeline, or SQL
// mutation routines.

import {
  createAuthenticatedEdgeClient,
  createPrivilegedEdgeClient,
} from "../_shared/edge-supabase.ts";
import { decryptCredentialsWebCrypto } from "../_shared/integration-crypto.ts";

type PreflightStatus = {
  authenticated: boolean;
  admin: boolean;
  privilegedClient: boolean;
  integrationFound: boolean;
  credentialsReadable: boolean;
  credentialsDecryptable: boolean;
};

const emptyStatus = (): PreflightStatus => ({
  authenticated: false,
  admin: false,
  privilegedClient: false,
  integrationFound: false,
  credentialsReadable: false,
  credentialsDecryptable: false,
});

function response(status: PreflightStatus, statusCode = 200, origin: string | null = null) {
  const siteUrl = Deno.env.get("SITE_URL");
  const allowedOrigin = siteUrl && origin === siteUrl ? origin : "null";
  return new Response(JSON.stringify({ status }), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    },
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return response(emptyStatus(), 204, origin);
  if (request.method !== "POST") return response(emptyStatus(), 405, origin);

  const status = emptyStatus();
  const authorization = request.headers.get("Authorization") ?? "";
  const jwt = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!jwt) return response(status, 401, origin);

  try {
    const authenticated = createAuthenticatedEdgeClient(authorization);
    const { data: userData, error: userError } = await authenticated.auth.getUser(jwt);
    if (userError || !userData.user) return response(status, 401, origin);
    status.authenticated = true;

    const privileged = createPrivilegedEdgeClient();
    status.privilegedClient = true;
    const { data: role, error: roleError } = await privileged
      .from("user_roles")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError || !role) return response(status, 403, origin);
    status.admin = true;

    const { data: integration, error: integrationError } = await privileged
      .from("affiliate_integrations")
      .select("id")
      .or("provider_name.ilike.%impact%,provider_type.ilike.%impact%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (integrationError || !integration) return response(status, 200, origin);
    status.integrationFound = true;

    const { data: credentials, error: credentialsError } = await privileged
      .from("affiliate_integration_credentials")
      .select("ciphertext")
      .eq("integration_id", integration.id)
      .maybeSingle();
    if (credentialsError || !credentials?.ciphertext) return response(status, 200, origin);
    status.credentialsReadable = true;

    const credentialSecret = Deno.env.get("INTEGRATION_CREDENTIAL_SECRET");
    if (!credentialSecret) return response(status, 200, origin);
    await decryptCredentialsWebCrypto(credentials.ciphertext, credentialSecret);
    status.credentialsDecryptable = true;
    return response(status, 200, origin);
  } catch {
    // The response intentionally contains status booleans only: never keys,
    // ciphertext, plaintext credentials, or detailed database failures.
    return response(status, status.authenticated ? 500 : 401, origin);
  }
});
