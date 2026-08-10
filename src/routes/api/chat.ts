import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { excludeLifecycleHiddenStoreRelation, excludeLifecycleHiddenStores } from "@/lib/catalog-visibility";

const SYSTEM_PROMPT = `You are Dealio, an AI Deal Discovery Assistant for the Getyourcodes coupon site.

Your job: help users find the best coupons, promo codes, and store deals.

When a user asks about a product, brand, category, or budget:
1. Extract intent (category, brand, budget, urgency).
2. Use the searchCoupons tool to find live coupon codes / deals matching their query.
3. Use the searchStores tool if they ask about a specific merchant.
4. Recommend the top 2-5 matches in a concise, friendly tone.
5. For each recommendation, include the store name, the offer title, and (when present) the code.
6. Rank results by: active status, discount strength signals in the title (% off, $ off), recency, and whether a real code is attached.
7. If you find nothing, suggest related categories or brands the user could try.

Keep replies short, scannable, and mobile-friendly. Use markdown lists. Never invent coupons that didn't come from tool results.`;

function getPublicClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const { messages } = (await request.json()) as { messages: UIMessage[] };
        if (!Array.isArray(messages)) {
          return new Response("messages required", { status: 400 });
        }

        const gateway = createLovableAiGatewayProvider(key);
        const supabase = getPublicClient();

        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          stopWhen: stepCountIs(50),
          tools: {
            searchCoupons: tool({
              description:
                "Search active coupons and deals. Use freeform keywords from the user's request (brand, category, product). Returns up to 12 active coupons with store info.",
              inputSchema: z.object({
                query: z.string().describe("Keywords like brand, product, or category"),
                couponType: z
                  .enum(["code", "deal", "any"])
                  .optional()
                  .describe("Restrict to coupon codes, deals, or any"),
                limit: z.number().int().min(1).max(20).optional(),
              }),
              execute: async ({ query, couponType, limit }) => {
                const max = limit ?? 12;
                let q = excludeLifecycleHiddenStoreRelation(supabase
                  .from("coupons")
                  .select("id,title,description,coupon_code,coupon_type,affiliate_url,expiry_date,created_at,stores!inner(name,slug,logo_url)"))
                  .eq("status", "active")
                  .order("created_at", { ascending: false })
                  .limit(max);

                if (couponType && couponType !== "any") q = q.eq("coupon_type", couponType);

                const terms = query.trim();
                if (terms) {
                  const like = `%${terms.replace(/[%_]/g, "")}%`;
                  q = q.or(`title.ilike.${like},description.ilike.${like}`);
                }

                const { data, error } = await q;
                if (error) return { error: error.message, results: [] };
                return { results: data ?? [] };
              },
            }),
            searchStores: tool({
              description:
                "Search stores/merchants by name when a user asks about a specific brand. Returns store info and slug used to build links like /<slug>.",
              inputSchema: z.object({
                name: z.string(),
                limit: z.number().int().min(1).max(10).optional(),
              }),
              execute: async ({ name, limit }) => {
                const like = `%${name.replace(/[%_]/g, "")}%`;
                const { data, error } = await excludeLifecycleHiddenStores(supabase
                  .from("stores")
                  .select("id,name,slug,description,logo_url,featured"))
                  .ilike("name", like)
                  .limit(limit ?? 5);
                if (error) return { error: error.message, results: [] };
                return { results: data ?? [] };
              },
            }),
          },
        });

        return result.toUIMessageStreamResponse({ originalMessages: messages });
      },
    },
  },
});
