import type { CredentialDisposition } from "./contracts.ts";

const REDACTED = "[REDACTED]";
const SENSITIVE_QUERY_KEY = /(?:token|auth|api[_-]?key|secret|signature|password|cursor|sid)/i;

export interface ImpactContinuationPolicy {
  /** HTTPS base URL supplied by the host for resolving relative continuations. */
  approvedBaseUrl: string;
  /** Exact HTTPS origins permitted for Impact continuations. */
  allowedOrigins: readonly string[];
  /** Exact Account SID-like path values to mask in diagnostics. */
  accountSidPathSegments?: readonly string[];
}

export interface SanitizedUrlOptions {
  baseUrl?: string;
  accountSidPathSegments?: readonly string[];
}

export interface ValidImpactContinuation {
  ok: true;
  url: string;
  sanitizedUrl: string;
  credentialDisposition: CredentialDisposition;
  originRelation: "same_origin" | "allowed_cross_origin";
}

export interface InvalidImpactContinuation {
  ok: false;
  reason: "invalid_continuation";
  detail:
    | "empty"
    | "invalid_base_url"
    | "invalid_url"
    | "unsupported_scheme"
    | "userinfo_not_allowed"
    | "origin_not_allowed";
  sanitizedUrl: string | null;
}

export type ImpactContinuationValidation = ValidImpactContinuation | InvalidImpactContinuation;

function parseHttpsOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) return null;
    return url;
  } catch {
    return null;
  }
}

function approvedOrigins(policy: ImpactContinuationPolicy): Set<string> | null {
  const base = parseHttpsOrigin(policy.approvedBaseUrl);
  if (!base) return null;
  const origins = new Set<string>();
  for (const value of policy.allowedOrigins) {
    const parsed = parseHttpsOrigin(value);
    if (!parsed) return null;
    origins.add(parsed.origin);
  }
  return origins.has(base.origin) ? origins : null;
}

function sensitiveSegmentSet(values: readonly string[] | undefined): Set<string> {
  const result = new Set<string>();
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (trimmed) result.add(trimmed);
  }
  return result;
}

function decodedSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function maskedSegment(value: string): string {
  const decoded = decodedSegment(value);
  const suffix = decoded.slice(-4);
  return `${"•".repeat(Math.min(4, decoded.length))}${suffix}`;
}

/** Sanitizes a URL for diagnostics without making a network request. */
export function sanitizeImpactDiagnosticUrl(
  value: string,
  options: SanitizedUrlOptions = {},
): string | null {
  let url: URL;
  try {
    url = options.baseUrl ? new URL(value, options.baseUrl) : new URL(value);
  } catch {
    return null;
  }

  url.username = "";
  url.password = "";
  url.hash = "";
  const sensitiveSegments = sensitiveSegmentSet(options.accountSidPathSegments);
  const maskedPath = url.pathname
    .split("/")
    .map((segment) => (sensitiveSegments.has(decodedSegment(segment)) ? maskedSegment(segment) : segment))
    .join("/");
  url.pathname = maskedPath;
  for (const [key] of url.searchParams) {
    if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, REDACTED);
  }
  return url.toString();
}

/**
 * Resolves and validates an Impact continuation before a future client follows
 * it. The returned URL preserves the validated path and query semantics.
 */
export function validateImpactContinuation(
  continuationUri: string,
  policy: ImpactContinuationPolicy,
): ImpactContinuationValidation {
  const sanitizedUrl = sanitizeImpactDiagnosticUrl(continuationUri, {
    baseUrl: policy.approvedBaseUrl,
    accountSidPathSegments: policy.accountSidPathSegments,
  });
  if (!continuationUri.trim()) {
    return { ok: false, reason: "invalid_continuation", detail: "empty", sanitizedUrl: null };
  }

  const origins = approvedOrigins(policy);
  if (!origins) {
    return { ok: false, reason: "invalid_continuation", detail: "invalid_base_url", sanitizedUrl };
  }

  let base: URL;
  let url: URL;
  try {
    base = new URL(policy.approvedBaseUrl);
    url = new URL(continuationUri, base);
  } catch {
    return { ok: false, reason: "invalid_continuation", detail: "invalid_url", sanitizedUrl };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "invalid_continuation", detail: "unsupported_scheme", sanitizedUrl };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "invalid_continuation", detail: "userinfo_not_allowed", sanitizedUrl };
  }
  if (!origins.has(url.origin)) {
    return { ok: false, reason: "invalid_continuation", detail: "origin_not_allowed", sanitizedUrl };
  }

  const originRelation = url.origin === base.origin ? "same_origin" : "allowed_cross_origin";
  return {
    ok: true,
    url: url.toString(),
    sanitizedUrl: sanitizeImpactDiagnosticUrl(url.toString(), {
      accountSidPathSegments: policy.accountSidPathSegments,
    }) ?? "",
    credentialDisposition: originRelation === "same_origin" ? "attach_if_same_origin" : "omit",
    originRelation,
  };
}
