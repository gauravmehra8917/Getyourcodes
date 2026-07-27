// Public entry point for the Response Normalization Layer.
// Consumers should import only from here.

export type {
  CanonicalStore,
  CanonicalCoupon,
  CanonicalDeal,
  CanonicalCategory,
  CanonicalEntity,
  CanonicalStatus,
  DiscountType,
  EntityKind,
  Metadata,
  NormalizationBatch,
  NormalizationIssue,
  PromotionSplit,
} from "./types";

export type { Normalizer, NormalizerContext } from "./Normalizer";
export { BaseNormalizer } from "./Normalizer";

export { NormalizerFactory } from "./NormalizerFactory";
export { ImpactNormalizer, isCouponPromotion } from "./impact/ImpactNormalizer";
