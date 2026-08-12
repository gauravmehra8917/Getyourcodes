// Runtime-neutral request authentication helpers.

import type { AuthenticationType, IntegrationCredentials } from "./types.ts";

export interface AppliedAuth {
  headers: Record<string, string>;
  query: Record<string, string>;
  configured: boolean;
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function applyAuthentication(type: AuthenticationType, creds: IntegrationCredentials): AppliedAuth {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  let configured = false;
  switch (type) {
    case "api_key": {
      const key = (creds.apiKey ?? "").trim();
      if (!key) break;
      const placement = creds.apiKeyPlacement ?? "header";
      const name = (creds.apiKeyName ?? (placement === "query" ? "apikey" : "X-API-Key")).trim() || (placement === "query" ? "apikey" : "X-API-Key");
      if (placement === "query") query[name] = key;
      else headers[name] = key;
      configured = true;
      break;
    }
    case "bearer": {
      const token = (creds.accessToken ?? "").trim();
      if (token) { headers.Authorization = `Bearer ${token}`; configured = true; }
      break;
    }
    case "basic": {
      const username = creds.username ?? "";
      const password = creds.password ?? "";
      if (username || password) { headers.Authorization = `Basic ${base64Utf8(`${username}:${password}`)}`; configured = true; }
      break;
    }
    case "oauth2": {
      const token = (creds.accessToken ?? "").trim();
      if (token) { headers.Authorization = `Bearer ${token}`; configured = true; }
      else configured = !!((creds.clientId ?? "").trim() && (creds.clientSecret ?? "").trim());
      break;
    }
    case "custom_headers":
      configured = true;
      break;
  }
  return { headers, query, configured };
}
