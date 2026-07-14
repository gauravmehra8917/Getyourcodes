// Supabase Edge Function: send-newsletter
// Fetches active+verified subscribers, gathers newly-added active coupons since
// the last successful newsletter (max 15, expired ignored), renders an HTML
// email, sends via Resend, and writes a row into public.newsletter_logs.
//
// Required secrets:
//   - RESEND_API_KEY         Resend account API key
//   - NEWSLETTER_FROM_EMAIL  Verified sender, e.g. "Getyourcodes <news@getyourcodes.com>"
//   - SITE_URL               Public site URL (e.g. https://getyourcodes.com)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://getyourcodes.com";
const MAX_COUPONS = 15;

type Coupon = {
  id: string;
  title: string;
  description: string | null;
  coupon_code: string | null;
  coupon_type: "code" | "deal";
  affiliate_url: string | null;
  expiry_date: string | null;
  created_at: string;
  store: { name: string; slug: string } | null;
};

type Subscriber = { email: string; unsubscribe_token: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify caller is an authenticated admin.
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userRes.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    // 1. Determine "since" cutoff = last successful send.
    const { data: lastLog } = await admin
      .from("newsletter_logs")
      .select("sent_at")
      .eq("status", "success")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const since = (lastLog as { sent_at: string } | null)?.sent_at ?? "1970-01-01T00:00:00Z";

    // 2. Fetch newly-added active, unexpired coupons (max 15).
    const today = new Date().toISOString().slice(0, 10);
    const { data: couponsRaw, error: couponsErr } = await admin
      .from("coupons")
      .select("id,title,description,coupon_code,coupon_type,affiliate_url,expiry_date,created_at,store:stores(name,slug)")
      .eq("status", "active")
      .gt("created_at", since)
      .or(`expiry_date.is.null,expiry_date.gte.${today}`)
      .order("created_at", { ascending: false })
      .limit(MAX_COUPONS);
    if (couponsErr) throw couponsErr;
    const coupons = (couponsRaw ?? []) as unknown as Coupon[];

    // 3. Fetch active + verified subscribers.
    const { data: subsRaw, error: subsErr } = await admin
      .from("subscribers")
      .select("email,unsubscribe_token")
      .eq("active", true)
      .eq("verified", true);
    if (subsErr) throw subsErr;
    const subscribers = (subsRaw ?? []) as Subscriber[];

    // 4. Nothing to send? Log and exit.
    if (coupons.length === 0) {
      await admin.from("newsletter_logs").insert({
        subscribers_count: subscribers.length,
        coupons_sent: 0,
        successful: 0,
        failed: 0,
        execution_time: Date.now() - startedAt,
        status: "No new coupons",
      });
      return json({ ok: true, reason: "no_new_coupons", subscribers: subscribers.length });
    }

    if (subscribers.length === 0) {
      await admin.from("newsletter_logs").insert({
        subscribers_count: 0,
        coupons_sent: coupons.length,
        successful: 0,
        failed: 0,
        execution_time: Date.now() - startedAt,
        status: "No subscribers",
      });
      return json({ ok: true, reason: "no_subscribers", coupons: coupons.length });
    }

    // 5. Send emails (or dry-run if Resend is not configured yet).
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const NEWSLETTER_FROM_EMAIL = Deno.env.get("NEWSLETTER_FROM_EMAIL");
    const canSend = Boolean(RESEND_API_KEY && NEWSLETTER_FROM_EMAIL);

    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    const subject = `${coupons.length} new deal${coupons.length === 1 ? "" : "s"} on Dealio`;

    for (const sub of subscribers) {
      const html = renderNewsletterHtml(coupons, sub.unsubscribe_token);
      if (!canSend) {
        // TODO: Once RESEND_API_KEY and NEWSLETTER_FROM_EMAIL are set in
        // Supabase Edge Function secrets, this branch is skipped and the
        // real Resend send below runs for each subscriber.
        successful++; // count the dry-run as processed but not delivered
        continue;
      }

      try {
        // TODO: Resend integration active — remove/adjust once verified in prod.
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: NEWSLETTER_FROM_EMAIL,
            to: [sub.email],
            subject,
            html,
            headers: {
              "List-Unsubscribe": `<${SITE_URL}/unsubscribe?token=${sub.unsubscribe_token}>`,
            },
          }),
        });
        if (!res.ok) {
          failed++;
          errors.push(`${sub.email}: ${res.status}`);
        } else {
          successful++;
        }
      } catch (e) {
        failed++;
        errors.push(`${sub.email}: ${(e as Error).message}`);
      }
    }

    const status = !canSend
      ? "dry_run"
      : failed === 0
        ? "success"
        : successful === 0
          ? "failed"
          : "partial";

    await admin.from("newsletter_logs").insert({
      subscribers_count: subscribers.length,
      coupons_sent: coupons.length,
      successful,
      failed,
      execution_time: Date.now() - startedAt,
      status,
      error_message: errors.length ? errors.slice(0, 10).join("; ") : null,
    });

    return json({
      ok: true,
      status,
      subscribers: subscribers.length,
      coupons: coupons.length,
      successful,
      failed,
      dry_run: !canSend,
    });
  } catch (e) {
    const message = (e as Error).message ?? "unknown_error";
    await admin.from("newsletter_logs").insert({
      subscribers_count: 0,
      coupons_sent: 0,
      successful: 0,
      failed: 0,
      execution_time: Date.now() - startedAt,
      status: "failed",
      error_message: message,
    });
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderNewsletterHtml(coupons: Coupon[], unsubscribeToken: string): string {
  const items = coupons
    .map((c) => {
      const storeName = c.store?.name ?? "Store";
      const storeHref = c.store?.slug ? `${SITE_URL}/${c.store.slug}` : SITE_URL;
      const ctaHref = c.affiliate_url ?? storeHref;
      const codeBlock = c.coupon_code
        ? `<div style="margin-top:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#eef2ff;color:#3730a3;display:inline-block;padding:6px 10px;border-radius:6px;font-weight:600;letter-spacing:.02em">${esc(c.coupon_code)}</div>`
        : "";
      const expiry = c.expiry_date
        ? `<div style="margin-top:6px;font-size:12px;color:#64748b">Expires ${esc(c.expiry_date)}</div>`
        : "";
      return `
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #e5e7eb">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6366f1;font-weight:600">
              <a href="${esc(storeHref)}" style="color:#6366f1;text-decoration:none">${esc(storeName)}</a>
            </div>
            <div style="margin-top:4px;font-size:16px;font-weight:600;color:#0f172a">${esc(c.title)}</div>
            ${c.description ? `<div style="margin-top:4px;font-size:14px;color:#475569">${esc(c.description)}</div>` : ""}
            ${codeBlock}
            ${expiry}
            <div style="margin-top:10px">
              <a href="${esc(ctaHref)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-size:14px;font-weight:600">
                ${c.coupon_type === "code" ? "Get code" : "Get deal"}
              </a>
            </div>
          </td>
        </tr>`;
    })
    .join("");

  const unsubscribeUrl = `${SITE_URL}/unsubscribe?token=${unsubscribeToken}`;

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>New deals on Dealio</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;padding:28px 28px 20px;box-shadow:0 1px 3px rgba(15,23,42,.06)">
        <tr><td>
          <div style="font-size:20px;font-weight:700;color:#4f46e5">Dealio</div>
          <h1 style="margin:12px 0 4px;font-size:22px;color:#0f172a">Fresh deals for you</h1>
          <p style="margin:0;color:#475569;font-size:14px">Here are the newest coupons we've added since our last update.</p>
        </td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
        </td></tr>
        <tr><td style="padding-top:20px">
          <div style="text-align:center;font-size:12px;color:#94a3b8">
            You're receiving this because you subscribed on Dealio.<br/>
            <a href="${esc(unsubscribeUrl)}" style="color:#6366f1;text-decoration:underline">Unsubscribe</a>
            &nbsp;·&nbsp;
            <a href="${esc(SITE_URL)}" style="color:#6366f1;text-decoration:underline">Visit Dealio</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
