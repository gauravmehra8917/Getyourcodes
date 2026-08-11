type EnvironmentReader = (name: string) => string | null | undefined;

function defaultKeyFromJson(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const key = parsed.default;
    return typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

/** Current hosted Edge Functions expose this JSON map; legacy is fallback only. */
export function resolvePrivilegedEdgeKey(read: EnvironmentReader): string {
  return (
    defaultKeyFromJson(read("SUPABASE_SECRET_KEYS")) ??
    nonEmpty(read("SUPABASE_SERVICE_ROLE_KEY")) ??
    (() => { throw new Error("No trusted Supabase Edge credential is available"); })()
  );
}

export function resolvePublishableEdgeKey(read: EnvironmentReader): string {
  return (
    defaultKeyFromJson(read("SUPABASE_PUBLISHABLE_KEYS")) ??
    nonEmpty(read("SUPABASE_ANON_KEY")) ??
    (() => { throw new Error("No Supabase publishable Edge credential is available"); })()
  );
}

export function resolveSupabaseEdgeUrl(read: EnvironmentReader): string {
  const url = nonEmpty(read("SUPABASE_URL"));
  if (!url) throw new Error("No Supabase Edge URL is available");
  return url;
}
