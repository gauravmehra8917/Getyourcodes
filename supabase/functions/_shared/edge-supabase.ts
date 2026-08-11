import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  resolvePrivilegedEdgeKey,
  resolvePublishableEdgeKey,
  resolveSupabaseEdgeUrl,
} from "./edge-credentials.ts";

type EnvironmentReader = (name: string) => string | null | undefined;

export function createPrivilegedEdgeClient(read: EnvironmentReader = Deno.env.get) {
  return createClient(resolveSupabaseEdgeUrl(read), resolvePrivilegedEdgeKey(read), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAuthenticatedEdgeClient(
  authorization: string,
  read: EnvironmentReader = Deno.env.get,
) {
  return createClient(resolveSupabaseEdgeUrl(read), resolvePublishableEdgeKey(read), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
