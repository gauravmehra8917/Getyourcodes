import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const providerType = z.enum([
  "affiliate_network",
  "email_service",
  "ai_service",
  "analytics",
  "payment_gateway",
  "custom_rest_api",
]);
const authType = z.enum(["api_key", "bearer", "oauth2", "basic", "custom_headers"]);

const credentialsSchema = z.object({
  apiKey: z.string().optional().default(""),
  accessToken: z.string().optional().default(""),
  username: z.string().optional().default(""),
  password: z.string().optional().default(""),
  clientId: z.string().optional().default(""),
  clientSecret: z.string().optional().default(""),
  authorizationUrl: z.string().optional().default(""),
  tokenUrl: z.string().optional().default(""),
  scopes: z.string().optional().default(""),
  customHeaders: z.array(z.object({ key: z.string(), value: z.string() })).optional().default([]),
});

const metaSchema = z.object({
  integration_name: z.string().min(1).max(200),
  provider_name: z.string().min(1).max(200),
  provider_type: providerType,
  description: z.string().max(2000).optional().default(""),
  authentication_type: authType,
  base_url: z.string().url(),
  api_version: z.string().max(50).optional().default(""),
  timeout_seconds: z.number().int().positive().max(600),
  retry_attempts: z.number().int().min(0).max(20),
  custom_headers: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
  endpoint_configuration: z.record(z.string(), z.string()).default({}),
  is_enabled: z.boolean().default(false),
});

async function requireAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("Forbidden: admin only");
}


export const listIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { data, error } = await ctx.supabase
      .from("affiliate_integrations")
      .select(
        "id, integration_name, provider_name, provider_type, description, authentication_type, base_url, api_version, timeout_seconds, retry_attempts, custom_headers, endpoint_configuration, is_enabled, status, environment, last_test_result, last_tested_at, created_at, updated_at"
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ meta: metaSchema, credentials: credentialsSchema }).parse(v))
  .handler(async ({ data, context }) => {
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptCredentials } = await import("@/lib/integration-crypto.server");

    await assertUnique(supabaseAdmin, data.meta, null);

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("affiliate_integrations")
      .insert({
        ...data.meta,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) throw new Error(mapDupError(insertErr));

    const ciphertext = encryptCredentials(JSON.stringify(data.credentials));
    const { data: credRow, error: credErr } = await supabaseAdmin
      .from("affiliate_integration_credentials")
      .insert({ integration_id: inserted.id, ciphertext })
      .select("id")
      .single();
    if (credErr || !credRow) {
      await supabaseAdmin.from("affiliate_integrations").delete().eq("id", inserted.id);
      throw new Error(credErr?.message ?? "Failed to store credentials");
    }

    await supabaseAdmin
      .from("affiliate_integrations")
      .update({ credential_reference: credRow.id })
      .eq("id", inserted.id);

    return { id: inserted.id };
  });

export const updateIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z
      .object({
        id: z.string().uuid(),
        meta: metaSchema,
        credentials: credentialsSchema.optional(),
      })
      .parse(v)
  )
  .handler(async ({ data, context }) => {
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptCredentials } = await import("@/lib/integration-crypto.server");

    const { error: upErr } = await supabaseAdmin
      .from("affiliate_integrations")
      .update(data.meta)
      .eq("id", data.id);
    if (upErr) throw new Error(upErr.message);

    if (data.credentials) {
      const ciphertext = encryptCredentials(JSON.stringify(data.credentials));
      const { data: existing } = await supabaseAdmin
        .from("affiliate_integration_credentials")
        .select("id")
        .eq("integration_id", data.id)
        .maybeSingle();
      if (existing) {
        const { error } = await supabaseAdmin
          .from("affiliate_integration_credentials")
          .update({ ciphertext })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { data: credRow, error } = await supabaseAdmin
          .from("affiliate_integration_credentials")
          .insert({ integration_id: data.id, ciphertext })
          .select("id")
          .single();
        if (error || !credRow) throw new Error(error?.message ?? "Failed to store credentials");
        await supabaseAdmin
          .from("affiliate_integrations")
          .update({ credential_reference: credRow.id })
          .eq("id", data.id);
      }
      // Audit: credentials updated (never log values)
      await supabaseAdmin.from("admin_activity_log").insert({
        actor_id: ctx.userId,
        action: "update",
        entity: "affiliate_integration_credentials",
        entity_id: data.id,
        meta: { description: "Credentials updated", name: data.meta.integration_name },
      });
    }

    return { id: data.id };
  });

export const toggleIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(v))
  .handler(async ({ data, context }) => {
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("affiliate_integrations")
      .update({ is_enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { id: data.id, is_enabled: data.enabled };
  });

export const deleteIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // ON DELETE CASCADE removes the credentials row.
    const { error } = await supabaseAdmin.from("affiliate_integrations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });

export const getTestHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { data: rows, error } = await ctx.supabase
      .from("affiliate_integration_tests")
      .select("id, status, http_status, latency_ms, auth_status, message, environment, created_at")
      .eq("integration_id", data.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getAuditHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { data: rows, error } = await ctx.supabase
      .from("admin_activity_log")
      .select("id, action, entity, meta, created_at")
      .eq("entity_id", data.id)
      .in("entity", ["affiliate_integrations", "affiliate_integration_credentials"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getMaskedCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptCredentials } = await import("@/lib/integration-crypto.server");
    const { data: row } = await supabaseAdmin
      .from("affiliate_integration_credentials")
      .select("ciphertext")
      .eq("integration_id", data.id)
      .maybeSingle();
    if (!row) return {};
    try {
      const creds = JSON.parse(decryptCredentials(row.ciphertext)) as Record<string, unknown>;
      const maskVal = (v: unknown) => {
        const s = typeof v === "string" ? v : "";
        if (!s) return "";
        if (s.length <= 4) return "•".repeat(s.length);
        return `${"•".repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
      };
      const out: Record<string, string> = {};
      for (const k of ["apiKey", "accessToken", "username", "password", "clientId", "clientSecret", "authorizationUrl", "tokenUrl", "scopes"]) {
        if (creds[k]) out[k] = k === "username" || k === "authorizationUrl" || k === "tokenUrl" || k === "scopes" ? String(creds[k]) : maskVal(creds[k]);
      }
      return out;
    } catch {
      return {};
    }
  });

export const testIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const ctx = context as typeof context & { supabase: any; userId: string };
    await requireAdmin(ctx.supabase, ctx.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptCredentials } = await import("@/lib/integration-crypto.server");

    const { data: integ, error: iErr } = await supabaseAdmin
      .from("affiliate_integrations")
      .select("id, integration_name, base_url, authentication_type, timeout_seconds, custom_headers, endpoint_configuration, environment, is_enabled")
      .eq("id", data.id)
      .single();
    if (iErr || !integ) throw new Error(iErr?.message ?? "Integration not found");

    const { data: credRow } = await supabaseAdmin
      .from("affiliate_integration_credentials")
      .select("ciphertext")
      .eq("integration_id", data.id)
      .maybeSingle();

    let creds: Record<string, string> = {};
    try {
      if (credRow) creds = JSON.parse(decryptCredentials(credRow.ciphertext));
    } catch {
      // ignore
    }

    // Build URL: base_url + optional health path
    const endpoints = (integ.endpoint_configuration as Record<string, string>) ?? {};
    const healthPath = (endpoints.health ?? "").trim();
    const base = integ.base_url.replace(/\/+$/, "");
    const url = healthPath ? `${base}${healthPath.startsWith("/") ? "" : "/"}${healthPath}` : base;

    // Build headers by auth type
    const headers: Record<string, string> = { Accept: "application/json" };
    for (const h of (integ.custom_headers as { key: string; value: string }[]) ?? []) {
      if (h?.key) headers[h.key] = h.value ?? "";
    }
    let authConfigured = false;
    switch (integ.authentication_type) {
      case "api_key":
        if (creds.apiKey) { headers["X-API-Key"] = creds.apiKey; authConfigured = true; }
        break;
      case "bearer":
        if (creds.accessToken) { headers.Authorization = `Bearer ${creds.accessToken}`; authConfigured = true; }
        break;
      case "basic":
        if (creds.username || creds.password) {
          headers.Authorization = `Basic ${Buffer.from(`${creds.username ?? ""}:${creds.password ?? ""}`).toString("base64")}`;
          authConfigured = true;
        }
        break;
      case "oauth2":
        if (creds.accessToken) { headers.Authorization = `Bearer ${creds.accessToken}`; authConfigured = true; }
        else if (creds.clientId && creds.clientSecret) { authConfigured = true; }
        break;
      case "custom_headers":
        authConfigured = Object.keys(headers).length > 1; // more than Accept
        break;
    }

    // Validate URL
    let urlOk = true;
    try { new URL(url); } catch { urlOk = false; }

    const timeoutMs = Math.min(60_000, Math.max(1_000, (integ.timeout_seconds ?? 30) * 1000));
    const start = Date.now();
    let httpStatus: number | null = null;
    let status: "connected" | "failed" | "warning" = "failed";
    let authStatus: "valid" | "invalid" | "not_configured" | "unknown" = authConfigured ? "unknown" : "not_configured";
    let message = "";

    if (!urlOk) {
      message = "Invalid base URL or health endpoint";
    } else {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
        httpStatus = res.status;
        if (res.status >= 200 && res.status < 300) {
          status = "connected";
          authStatus = authConfigured ? "valid" : authStatus;
          message = "Connection successful";
        } else if (res.status === 401 || res.status === 403) {
          status = "failed";
          authStatus = "invalid";
          message = `Authentication failed (HTTP ${res.status})`;
        } else if (res.status >= 500) {
          status = "warning";
          message = `Server error (HTTP ${res.status})`;
        } else {
          status = "warning";
          message = `Unexpected response (HTTP ${res.status})`;
        }
      } catch (err) {
        message = err instanceof Error ? (err.name === "AbortError" ? "Request timed out" : err.message) : "Network error";
        status = "failed";
      } finally {
        clearTimeout(t);
      }
    }

    const latency = Date.now() - start;
    const result = {
      status,
      http_status: httpStatus,
      latency_ms: latency,
      auth_status: authStatus,
      message,
      environment: integ.environment ?? "production",
      tested_at: new Date().toISOString(),
    };

    await supabaseAdmin.from("affiliate_integration_tests").insert({
      integration_id: data.id,
      status,
      http_status: httpStatus,
      latency_ms: latency,
      auth_status: authStatus,
      message,
      environment: integ.environment ?? "production",
      tested_by: ctx.userId,
    });

    await supabaseAdmin
      .from("affiliate_integrations")
      .update({
        status: integ.is_enabled ? status : "disabled",
        last_tested_at: result.tested_at,
        last_test_result: result,
      })
      .eq("id", data.id);

    return result;
  });
