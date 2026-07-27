// Request builder: composes a fetch Request from IntegrationConfig
// + per-call HttpRequestOptions. Merges base URL, endpoint lookup,
// endpoint variable resolution, query params, headers (config → auth →
// per-call), and body.

import { applyAuthentication } from "./authentication.server";
import { resolvePlaceholders, variableMapForConfig } from "./placeholders.server";
import type {
  HttpMethod,
  HttpRequestOptions,
  IntegrationConfig,
} from "./types";

export interface BuiltRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  authConfigured: boolean;
  /** Endpoint placeholders that could not be resolved from credentials. */
  unresolvedVariables: string[];
}


function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  if (!path) return b;
  if (/^https?:\/\//i.test(path)) return path;
  return `${b}${path.startsWith("/") ? "" : "/"}${path}`;
}

function appendQuery(url: string, query: Record<string, string>): string {
  const entries = Object.entries(query).filter(([, v]) => v !== "" && v != null);
  if (!entries.length) return url;
  const u = new URL(url);
  for (const [k, v] of entries) u.searchParams.set(k, v);
  return u.toString();
}

export function buildRequest(
  config: IntegrationConfig,
  opts: HttpRequestOptions,
): BuiltRequest {
  const method: HttpMethod = opts.method ?? "GET";

  // Endpoint variables ({AccountSID}, {ClientId}, {Username}, ...) resolved
  // generically from the integration credentials.
  const vars = variableMapForConfig(config);
  const unresolvedVariables: string[] = [];

  // Resolve path: prefer endpoint-map lookup, fall back to literal path.
  const rawPath = opts.path ?? "";
  const mappedRaw = rawPath && config.endpoints[rawPath] ? config.endpoints[rawPath] : rawPath;
  // Endpoints are often stored as "GET /path" — drop the method token.
  const parsed = stripMethodPrefix(mappedRaw);
  const mapped = parsed.path;
  const basePart = resolvePlaceholders(config.baseUrl, vars);
  const pathPart = resolvePlaceholders(mapped, vars);
  unresolvedVariables.push(...basePart.unresolved, ...pathPart.unresolved);
  let url = joinUrl(basePart.value, pathPart.value);

  // Auth
  const auth = applyAuthentication(config.authenticationType, config.credentials);

  // Query params: user-supplied + auth query
  const query: Record<string, string> = { ...auth.query };
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined) continue;
    const r = resolvePlaceholders(String(v), vars);
    unresolvedVariables.push(...r.unresolved);
    query[k] = r.value;
  }
  url = appendQuery(url, query);


  // Headers: config custom → auth → per-call overrides. Case-insensitive last-wins.
  const headers: Record<string, string> = { Accept: "application/json" };
  const put = (k: string, v: string) => {
    if (!k) return;
    // strip any header that differs only by case
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === k.toLowerCase()) delete headers[existing];
    }
    headers[k] = v;
  };
  const putResolved = (k: string, v: string) => {
    const r = resolvePlaceholders(v ?? "", vars);
    unresolvedVariables.push(...r.unresolved);
    put(k, r.value);
  };
  for (const h of config.customHeaders ?? []) if (h?.key) putResolved(h.key, h.value ?? "");
  for (const h of config.credentials.customHeaders ?? []) if (h?.key) putResolved(h.key, h.value ?? "");

  for (const [k, v] of Object.entries(auth.headers)) put(k, v);
  for (const [k, v] of Object.entries(opts.headers ?? {})) put(k, v);

  // Body
  let body: string | undefined;
  if (opts.jsonBody !== undefined) {
    put("Content-Type", "application/json");
    body = JSON.stringify(opts.jsonBody);
  } else if (opts.formBody) {
    put("Content-Type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(opts.formBody).toString();
  }

  return {
    url,
    method,
    headers,
    body,
    authConfigured: auth.configured,
    unresolvedVariables: Array.from(new Set(unresolvedVariables)),
  };

}
