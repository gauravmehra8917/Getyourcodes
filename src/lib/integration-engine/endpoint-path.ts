// Runtime-neutral endpoint path normalisation.

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type ParsedHttpMethod = (typeof METHODS)[number];

export interface ParsedEndpoint {
  method: ParsedHttpMethod | null;
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
