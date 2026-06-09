import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uploadLogoSchema = z.object({
  path: z.string().min(1).max(180),
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
    const { data: isAdmin, error: roleError } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });

    if (roleError || !isAdmin) {
      throw new Error("Only admins can upload store logos.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bytes = decodeBase64(data.base64);
    const { error } = await supabaseAdmin.storage.from("store-logos").upload(data.path, bytes, {
      contentType: data.contentType,
      upsert: true,
    });

    if (error) throw new Error(error.message);

    const { data: publicUrl } = supabaseAdmin.storage.from("store-logos").getPublicUrl(data.path);
    return { publicUrl: publicUrl.publicUrl };
  });