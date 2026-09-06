import { supabase } from "@/integrations/supabase/client";
import {
  requestAffiliateSyncPreviewV2,
  type AdminV2PreviewHostResponse,
} from "@/lib/affiliate-sync-v2-preview";

/** Uses the existing authenticated browser client for the read-only V2 host. */
export function previewAffiliateSyncV2(integrationId: string): Promise<AdminV2PreviewHostResponse> {
  return requestAffiliateSyncPreviewV2(integrationId, (functionName, options) =>
    supabase.functions.invoke(functionName, options),
  );
}
