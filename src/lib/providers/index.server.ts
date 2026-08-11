// Public entry point for the Provider Adapter framework.
// Consumers should only import from here, never from adapters/*.

export type {
  ProviderAdapter,
  ProviderResult,
  ProviderStore,
  ProviderCoupon,
  ProviderDeal,
  ProviderCategory,
  FetchOptions,
} from "./ProviderAdapter";
export { NotImplementedError, notImplementedResponse } from "./ProviderAdapter";

export { BaseProviderAdapter } from "./BaseProviderAdapter";

export {
  ProviderFactory,
  resolveProviderKey,
  type ProviderKey,
} from "./ProviderFactory.server";
