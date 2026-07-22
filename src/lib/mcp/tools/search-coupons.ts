import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "search_coupons",
  title: "Search coupons",
  description:
    "Search active coupons and deals on Getyourcodes by keyword (brand, product, or category). Returns up to 20 matches with store info.",
  inputSchema: {
    query: z.string().min(1).describe("Keywords like brand, product, or category"),
    couponType: z
      .enum(["code", "deal", "any"])
      .optional()
      .describe("Restrict to coupon codes, deals, or any"),
    limit: z.number().int().min(1).max(20).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, couponType, limit }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    let q = supabase
      .from("coupons")
      .select(
        "id,title,description,coupon_code,coupon_type,affiliate_url,expiry_date,created_at,stores(name,slug,logo_url)",
      )
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(limit ?? 12);

    if (couponType && couponType !== "any") q = q.eq("coupon_type", couponType);
    const terms = query.trim();
    if (terms) {
      const like = `%${terms.replace(/[%_]/g, "")}%`;
      q = q.or(`title.ilike.${like},description.ilike.${like}`);
    }

    const { data, error } = await q;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { results: data ?? [] },
    };
  },
});
