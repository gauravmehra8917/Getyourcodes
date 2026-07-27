// Endpoint path normalisation.
//
// Admin-configured endpoints are frequently written in "METHOD /path" form
// (e.g. "GET /Mediapartners/{AccountSID}"). The method token must not become
// part of the URL — otherwise the request goes to "/GET%20/Mediapartners/..."
// and the provider answers 404.

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type ParsedHttpMethod = (typeof METHODS)[number];

export interface ParsedEndpoint {
  /** Method found in the string, if any. */
  method: ParsedHttpMethod | null;
  /** The path without the leading method token. */
  path: string;
}

export function stripMethodPrefix(input: string): ParsedEndpoint {
  const value = (input ?? "").trim();
  if (!value) return { method: null, path: "" };
  const match = value.match(/^([A-Za-z]+)\s+(\S.*)$/);
  if (match) {
    const candidate = match[1].toUpperCase() as ParsedHttpMethod;
    if ((METHODS as readonly string[]).includes(candidate)) {
      return { method: candidate, path: match[2].trim() };
    }
  }
  return { method: null, path: value };
}
