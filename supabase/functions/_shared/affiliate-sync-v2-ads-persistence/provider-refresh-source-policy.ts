import type {
  QualifiedImpactAdOfferV2,
} from "../affiliate-sync-v2-ads/index.ts";

export type AdsExistingAdRefreshSourceBlockReasonV2 =
  | "missing_coupon_code"
  | "unresolved_store"
  | "identity_conflict"
  | "missing_title"
  | "invalid_date"
  | "invalid_date_range"
  | "qualification_inconsistent";

export type AdsExistingAdRefreshSourceDispositionV2 =
  | {
    action: "refreshable";
    lifecycleReason: null | "not_started" | "expired";
    blockReason: null;
  }
  | {
    action: "blocked";
    lifecycleReason: null;
    blockReason: AdsExistingAdRefreshSourceBlockReasonV2;
  }
  | {
    action: "no_action";
    lifecycleReason: null;
    blockReason: null;
    reason: "absent_from_feed";
  };

/**
 * Fail-closed source policy for refreshing an already-existing exact Impact Ad.
 *
 * This function does not establish identity, parentage, ownership, or database
 * writability. Those remain separate planner/persistence responsibilities.
 *
 * It only answers whether the incoming provider representation is trustworthy
 * enough to participate in refresh comparison.
 */
export function classifyExistingAdRefreshSourceV2(
  qualified: QualifiedImpactAdOfferV2 | null,
): AdsExistingAdRefreshSourceDispositionV2 {
  if (qualified === null) {
    return {
      action: "no_action",
      lifecycleReason: null,
      blockReason: null,
      reason: "absent_from_feed",
    };
  }

  const offer = qualified.offer;

  /*
   * Preserve the current planner's strongest coupon invariant first:
   * a provider Ad without a validated code can never rewrite an existing
   * code-bearing coupon.
   */
  if (
    offer.codeClass !== "code_bearing" ||
    offer.validatedCouponCode.length === 0
  ) {
    return {
      action: "blocked",
      lifecycleReason: null,
      blockReason: "missing_coupon_code",
    };
  }

  /*
   * Exact Campaign resolution is mandatory.
   * Advertiser conflict receives its own identity-safe disposition.
   */
  if (offer.association.matchMethod === "unmatched") {
    return {
      action: "blocked",
      lifecycleReason: null,
      blockReason:
        offer.association.unresolvedReason ===
            "campaign_advertiser_conflict"
          ? "identity_conflict"
          : "unresolved_store",
    };
  }

  /*
   * AdsOfferQualification is a trusted deterministic stage, but guard its
   * result shape anyway so malformed synthetic state cannot become writable.
   */
  if (
    (qualified.reason === null && !qualified.eligible) ||
    (qualified.reason !== null && qualified.eligible)
  ) {
    return {
      action: "blocked",
      lifecycleReason: null,
      blockReason: "qualification_inconsistent",
    };
  }

  switch (qualified.reason) {
    case null:
      return {
        action: "refreshable",
        lifecycleReason: null,
        blockReason: null,
      };

    case "not_started":
      return {
        action: "refreshable",
        lifecycleReason: "not_started",
        blockReason: null,
      };

    case "expired":
      return {
        action: "refreshable",
        lifecycleReason: "expired",
        blockReason: null,
      };

    case "invalid_date":
      return {
        action: "blocked",
        lifecycleReason: null,
        blockReason: "invalid_date",
      };

    case "invalid_date_range":
      return {
        action: "blocked",
        lifecycleReason: null,
        blockReason: "invalid_date_range",
      };

    case "missing_title":
      return {
        action: "blocked",
        lifecycleReason: null,
        blockReason: "missing_title",
      };

    case "unresolved_store":
      return {
        action: "blocked",
        lifecycleReason: null,
        blockReason: "unresolved_store",
      };
  }
}
