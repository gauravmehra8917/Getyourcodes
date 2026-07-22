import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchCoupons from "./tools/search-coupons";
import searchStores from "./tools/search-stores";
import listSavedCoupons from "./tools/list-saved-coupons";

// The OAuth issuer MUST be the direct Supabase host, not the .lovable.cloud proxy.
// VITE_SUPABASE_PROJECT_ID is inlined at build time and survives publish.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "getyourcodes-mcp",
  title: "Getyourcodes",
  version: "0.1.0",
  instructions:
    "Tools for the Getyourcodes coupon site. Use `search_coupons` to find active coupons and deals, `search_stores` to look up merchants by name, and `list_my_saved_coupons` to read the signed-in user's saved coupons.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchCoupons, searchStores, listSavedCoupons],
});
