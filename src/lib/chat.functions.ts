import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];

export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: JsonValue[];
};

export const loadChatHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StoredChatMessage[]> => {
    const { data, error } = await context.supabase
      .from("chat_messages")
      .select("id, role, parts, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ id: string; role: string; parts: unknown }>).map((row) => ({
      id: row.id,
      role: (row.role === "assistant" || row.role === "system" ? row.role : "user") as
        | "user"
        | "assistant"
        | "system",
      parts: (Array.isArray(row.parts) ? row.parts : []) as JsonValue[],
    }));
  });

export const saveChatMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      messages: z.array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          parts: z.array(z.any()),
        }),
      ),
    }),
  )
  .handler(async ({ data, context }) => {
    if (data.messages.length === 0) return { ok: true };
    const rows = data.messages.map((m) => ({
      user_id: context.userId,
      role: m.role,
      parts: m.parts,
    }));
    const { error } = await context.supabase.from("chat_messages").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearChatHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("chat_messages")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
