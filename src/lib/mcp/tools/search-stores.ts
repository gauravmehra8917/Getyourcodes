import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "search_stores",
  title: "Search stores",
  description:
    "Search stores/merchants on Getyourcodes by name. Returns store info with slug — use it to build links like https://getyourcodes.com/<slug>.",
  inputSchema: {
    name: z.string().min(1),
    limit: z.number().int().min(1).max(20).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ name, limit }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const like = `%${name.replace(/[%_]/g, "")}%`;
    const { data, error } = await supabase
      .from("stores")
      .select("id,name,slug,description,logo_url,featured")
      .ilike("name", like)
      .limit(limit ?? 10);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { results: data ?? [] },
    };
  },
});
