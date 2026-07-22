// Authentication layer: builds request auth (headers + query) from
// the configured authentication type and decrypted credentials.
// Provider-agnostic. Never logs or returns raw secrets.

import type {
  AuthenticationType,
  IntegrationCredentials,
} from "./types";

export interface AppliedAuth {
  headers: Record<string, string>;
  query: Record<string, string>;
  /** True if enough credential material was present to actually authenticate. */
  configured: boolean;
}

export function applyAuthentication(
  type: AuthenticationType,
  creds: IntegrationCredentials,
): AppliedAuth {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  let configured = false;

  switch (type) {
    case "api_key": {
      const key = (creds.apiKey ?? "").trim();
      if (!key) break;
      const placement = creds.apiKeyPlacement ?? "header";
      if (placement === "query") {
        const name = (creds.apiKeyName ?? "apikey").trim() || "apikey";
        query[name] = key;
      } else {
        const name = (creds.apiKeyName ?? "X-API-Key").trim() || "X-API-Key";
        headers[name] = key;
      }
      configured = true;
      break;
    }
    case "bearer": {
      const token = (creds.accessToken ?? "").trim();
      if (!token) break;
      headers.Authorization = `Bearer ${token}`;
      configured = true;
      break;
    }
    case "basic": {
      const u = creds.username ?? "";
      const p = creds.password ?? "";
      if (!u && !p) break;
      headers.Authorization = `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
      configured = true;
      break;
    }
    case "oauth2": {
      // Framework only — no provider-specific flows here.
      // If an access token is present, use it as a bearer.
      const token = (creds.accessToken ?? "").trim();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
        configured = true;
      } else if ((creds.clientId ?? "").trim() && (creds.clientSecret ?? "").trim()) {
        // Client credentials configured but no active token yet.
        // Adapters (future phase) will exchange these for a token.
        configured = true;
      }
      break;
    }
    case "custom_headers": {
      // Handled entirely via custom_headers on the config — nothing to add here.
      configured = true;
      break;
    }
  }

  return { headers, query, configured };
}
