import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminUserRow = {
  id: string;
  display_name: string | null;
  created_at: string;
  is_admin: boolean;
};

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    const { data: role, error: roleError } = await context.supabase
      .from("user_roles")
      .select("user_id")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !role) throw new Error("Forbidden: admin only");

    // Load the privileged client only after authorizing the authenticated caller.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const profiles: Omit<AdminUserRow, "is_admin">[] = [];
    const adminIds = new Set<string>();
    const pageSize = 500;

    // Page both queries so Supabase's response row limit cannot silently truncate the list.
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, display_name, created_at")
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error("Could not load users. Please try again.");
      profiles.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .order("user_id")
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error("Could not load user roles. Please try again.");
      for (const row of data ?? []) adminIds.add(row.user_id);
      if (!data || data.length < pageSize) break;
    }

    return profiles.map((profile) => ({
      id: profile.id,
      display_name: profile.display_name,
      created_at: profile.created_at,
      is_admin: adminIds.has(profile.id),
    }));
  });

const uploadLogoSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(180)
    .regex(/^[a-z0-9-]+\.(png|jpe?g|webp|gif|svg)$/i),
  contentType: z.string().regex(/^image\//),
  base64: z.string().min(1),
});

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const uploadStoreLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(uploadLogoSchema)
  .handler(async ({ data, context }) => {
    const authContext = context as typeof context & { userId: string };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", authContext.userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !role) {
      throw new Error("Only admins can upload store logos.");
    }

    const bytes = decodeBase64(data.base64);
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const { error } = await supabaseAdmin.storage.from("store-logos").upload(data.path, body, {
      contentType: data.contentType,
      upsert: true,
    });

    if (error) throw new Error(error.message);

    const { data: publicUrl } = supabaseAdmin.storage.from("store-logos").getPublicUrl(data.path);
    return { publicUrl: publicUrl.publicUrl };
  });
