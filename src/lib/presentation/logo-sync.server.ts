// Merchant logo management (Phase 3A) — server only.
//
// Downloads provider logos with the existing authenticated provider connection,
// validates them, stores them in Supabase Storage and points the store row at
// the public URL. Provider credentials never leave the server.
//
// Idempotent: a store whose logo was already downloaded from the same provider
// URI is skipped, so repeated syncs cost nothing.

const BUCKET = "store-logos";
const MAX_BYTES = 3 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

export interface LogoSyncSummary {
  processed: number;
  downloaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}

type StoreRow = {
  id: string;
  name: string;
  logo_url: string | null;
  logo_source_url: string | null;
  metadata: Record<string, unknown> | null;
};

function normalizeSource(value: string | null | undefined, baseUrl: string | null = null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    // Providers such as Impact return relative URIs
    // (/Mediapartners/{SID}/Campaigns/{id}/Logo) — resolve against the API base.
    const u = candidate.startsWith("/") && baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Auth headers + API base URL derived from the integration, if any. */
async function providerConnection(
  integrationId: string | null,
): Promise<{ headers: Record<string, string>; baseUrl: string | null }> {
  if (!integrationId) return { headers: {}, baseUrl: null };
  try {
    const { loadIntegrationConfig } = await import("@/lib/integration-engine/config-loader.server");
    const config = await loadIntegrationConfig(integrationId);
    const c = config.credentials ?? {};
    const baseUrl = config.baseUrl ?? null;
    if (c.username && c.password) {
      return {
        headers: { Authorization: `Basic ${Buffer.from(`${c.username}:${c.password}`).toString("base64")}` },
        baseUrl,
      };
    }
    if (c.accessToken) return { headers: { Authorization: `Bearer ${c.accessToken}` }, baseUrl };
    if (c.apiKey) return { headers: { [c.apiKeyName || "X-API-Key"]: c.apiKey }, baseUrl };
    return { headers: {}, baseUrl };
  } catch {
    return { headers: {}, baseUrl: null };
  }
}

async function fetchImage(url: string, authHeaders: Record<string, string>) {
  const attempt = async (headers: Record<string, string>) =>
    fetch(url, { headers: { Accept: "image/*", ...headers }, redirect: "follow" });

  // Provider logo endpoints are usually authenticated: try credentials first.
  let res = Object.keys(authHeaders).length ? await attempt(authHeaders) : await attempt({});
  if (!res.ok && Object.keys(authHeaders).length) res = await attempt({});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) throw new Error(`not an image (${type || "unknown content-type"})`);

  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.byteLength) throw new Error("empty image response");
  if (buf.byteLength > MAX_BYTES) throw new Error("image exceeds 3 MB");

  return { bytes: buf, contentType: type, ext: EXT_BY_TYPE[type] ?? "img" };
}

/**
 * Downloads and caches logos for every imported store of a provider.
 * Failures are collected, never thrown — imports must not be interrupted.
 */
export async function syncStoreLogosForProvider(
  provider: string,
  integrationId: string | null,
  limit = 500,
): Promise<LogoSyncSummary> {
  const summary: LogoSyncSummary = { processed: 0, downloaded: 0, skipped: 0, failed: 0, errors: [] };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  const { data, error } = await db
    .from("stores")
    .select("id,name,logo_url,logo_source_url,metadata")
    .eq("provider", provider)
    .limit(limit);

  if (error) {
    summary.errors.push(`could not load stores: ${error.message}`);
    return summary;
  }

  const rows = (data ?? []) as StoreRow[];
  const { headers: authHeaders, baseUrl } = await providerConnection(integrationId);

  for (const store of rows) {
    const meta = (store.metadata ?? {}) as Record<string, unknown>;
    const source =
      normalizeSource(store.logo_source_url, baseUrl) ??
      normalizeSource(typeof meta.originalLogo === "string" ? meta.originalLogo : null, baseUrl) ??
      normalizeSource(store.logo_url, baseUrl);

    if (!source) {
      summary.skipped += 1;
      continue;
    }
    summary.processed += 1;

    const already = typeof meta.logoSyncedFrom === "string" ? meta.logoSyncedFrom : null;
    const hosted = !!store.logo_url && store.logo_url.includes(`/storage/v1/object/public/${BUCKET}/`);
    // Re-download only when the provider logo changed.
    if (hosted && already === source) {
      summary.skipped += 1;
      continue;
    }

    try {
      const image = await fetchImage(source, authHeaders);
      const path = `${provider}/${store.id}.${image.ext}`;

      const upload = await db.storage.from(BUCKET).upload(path, image.bytes, {
        contentType: image.contentType,
        upsert: true,
        cacheControl: "31536000",
      });
      if (upload.error) throw new Error(upload.error.message);

      const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;

      const { error: updateError } = await db
        .from("stores")
        .update({
          logo_url: publicUrl,
          logo_source_url: source,
          metadata: { ...meta, originalLogo: source, logoSyncedFrom: source, logoSyncedAt: new Date().toISOString() },
        })
        .eq("id", store.id);
      if (updateError) throw new Error(updateError.message);

      summary.downloaded += 1;
    } catch (err) {
      summary.failed += 1;
      if (summary.errors.length < 20) {
        summary.errors.push(`${store.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return summary;
}
