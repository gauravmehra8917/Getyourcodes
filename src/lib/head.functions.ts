// Public read of enabled Head Manager entries for server-side head rendering.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { HeadEntryInput } from "@/lib/head/render";

export const getEnabledHeadEntries = createServerFn({ method: "GET" }).handler(
  async (): Promise<HeadEntryInput[]> => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return [];

    const client = createClient(url, key, {
      auth: { persistSession: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });

    const { data, error } = await client
      .from("head_entries")
      .select("id, section, provider, type, name, value, content, enabled")
      .eq("enabled", true)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("head entries fetch failed:", error.message);
      return [];
    }
    return (data ?? []) as HeadEntryInput[];
  },
);
