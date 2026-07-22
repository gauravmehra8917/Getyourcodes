// Fallback adapter for generic REST integrations that don't match a
// known affiliate network. Uses only the Integration Engine — no
// provider-specific behavior.
import { BaseProviderAdapter } from "../BaseProviderAdapter";

export class CustomRestAdapter extends BaseProviderAdapter {
  readonly providerKey = "custom_rest";
}
