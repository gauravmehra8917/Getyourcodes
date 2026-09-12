// Runtime-neutral endpoint variable resolution.

import type { IntegrationConfig, IntegrationCredentials } from "./types.ts";

const ALIASES: Record<string, string[]> = {
  username: ["username", "user", "login", "accountsid", "accountid", "account", "sid", "merchantid", "siteid", "publisherid", "affiliateid"],
  password: ["password", "pass", "secret"],
  apikey: ["apikey", "key", "apitoken"],
  accesstoken: ["accesstoken", "token", "bearertoken"],
  clientid: ["clientid", "applicationid", "appid"],
  clientsecret: ["clientsecret", "applicationsecret", "appsecret"],
  apiversion: ["apiversion", "version"],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function buildVariableMap(creds: IntegrationCredentials, extra?: { apiVersion?: string }): Record<string, string> {
  const source: Record<string, string | undefined> = {
    username: creds.username, password: creds.password, apikey: creds.apiKey,
    accesstoken: creds.accessToken, clientid: creds.clientId, clientsecret: creds.clientSecret,
    apiversion: extra?.apiVersion,
  };
  const map: Record<string, string> = {};
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    const value = source[canonical];
    if (!value) continue;
    for (const alias of aliases) map[alias] = value;
  }
  return map;
}

export interface ResolveResult { value: string; resolved: string[]; unresolved: string[]; }

export function resolvePlaceholders(input: string, vars: Record<string, string>): ResolveResult {
  const resolved: string[] = [];
  const unresolved: string[] = [];
  if (!input || !input.includes("{")) return { value: input, resolved, unresolved };
  const value = input.replace(/\{([A-Za-z0-9_.\- ]+)\}/g, (match, name: string) => {
    const hit = vars[norm(name)];
    if (hit == null || hit === "") { unresolved.push(name); return match; }
    resolved.push(name);
    return encodeURIComponent(hit);
  });
  return { value, resolved, unresolved };
}

export function variableMapForConfig(config: IntegrationConfig): Record<string, string> {
  return buildVariableMap(config.credentials, { apiVersion: config.apiVersion });
}
