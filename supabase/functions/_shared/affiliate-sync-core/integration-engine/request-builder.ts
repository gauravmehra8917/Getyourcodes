// Runtime-neutral request construction.

import { applyAuthentication } from "./authentication.ts";
import { stripMethodPrefix } from "./endpoint-path.ts";
import { resolvePlaceholders, variableMapForConfig } from "./placeholders.ts";
import type { HttpMethod, HttpRequestOptions, IntegrationConfig } from "./types.ts";

export interface BuiltRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  authConfigured: boolean;
  unresolvedVariables: string[];
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  if (!path) return b;
  if (/^https?:\/\//i.test(path)) return path;
  return `${b}${path.startsWith("/") ? "" : "/"}${path}`;
}

function appendQuery(url: string, query: Record<string, string>): string {
  const entries = Object.entries(query).filter(([, value]) => value !== "" && value != null);
  if (!entries.length) return url;
  const resolved = new URL(url);
  for (const [key, value] of entries) resolved.searchParams.set(key, value);
  return resolved.toString();
}

export function buildRequest(config: IntegrationConfig, opts: HttpRequestOptions): BuiltRequest {
  const method: HttpMethod = opts.method ?? "GET";
  const vars = variableMapForConfig(config);
  const unresolvedVariables: string[] = [];
  const rawPath = opts.path ?? "";
  const mappedRaw = rawPath && config.endpoints[rawPath] ? config.endpoints[rawPath] : rawPath;
  const mapped = stripMethodPrefix(mappedRaw).path;
  const basePart = resolvePlaceholders(config.baseUrl, vars);
  const pathPart = resolvePlaceholders(mapped, vars);
  unresolvedVariables.push(...basePart.unresolved, ...pathPart.unresolved);
  let url = joinUrl(basePart.value, pathPart.value);

  const auth = applyAuthentication(config.authenticationType, config.credentials);
  const query: Record<string, string> = { ...auth.query };
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value === undefined) continue;
    const resolved = resolvePlaceholders(String(value), vars);
    unresolvedVariables.push(...resolved.unresolved);
    query[key] = resolved.value;
  }
  url = appendQuery(url, query);

  const headers: Record<string, string> = { Accept: "application/json" };
  const put = (key: string, value: string) => {
    if (!key) return;
    for (const existing of Object.keys(headers)) if (existing.toLowerCase() === key.toLowerCase()) delete headers[existing];
    headers[key] = value;
  };
  const putResolved = (key: string, value: string) => {
    const resolved = resolvePlaceholders(value ?? "", vars);
    unresolvedVariables.push(...resolved.unresolved);
    put(key, resolved.value);
  };
  for (const header of config.customHeaders ?? []) if (header?.key) putResolved(header.key, header.value ?? "");
  for (const header of config.credentials.customHeaders ?? []) if (header?.key) putResolved(header.key, header.value ?? "");
  for (const [key, value] of Object.entries(auth.headers)) put(key, value);
  for (const [key, value] of Object.entries(opts.headers ?? {})) put(key, value);

  let body: string | undefined;
  if (opts.jsonBody !== undefined) { put("Content-Type", "application/json"); body = JSON.stringify(opts.jsonBody); }
  else if (opts.formBody) { put("Content-Type", "application/x-www-form-urlencoded"); body = new URLSearchParams(opts.formBody).toString(); }
  return { url, method, headers, body, authConfigured: auth.configured, unresolvedVariables: Array.from(new Set(unresolvedVariables)) };
}
