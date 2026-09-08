import type {
  AdsIneligibilityReasonV2,
  AdsOfferQualificationResultV2,
  MatchedImpactAdOfferV2,
  QualifiedImpactAdOfferV2,
} from "./ad-models.ts";
import type { AdsQualificationDiagnosticsV2 } from "./ads-diagnostics.ts";
import type { AdsStoreMatchResultV2 } from "./AdsStoreMatcher.ts";

export interface AdsOfferQualificationOutputV2
  extends AdsOfferQualificationResultV2 {
  diagnostics: AdsQualificationDiagnosticsV2;
}

function emptyReasonCounts(): Record<AdsIneligibilityReasonV2, number> {
  return {
    unresolved_store: 0,
    not_started: 0,
    expired: 0,
    invalid_date: 0,
    invalid_date_range: 0,
    missing_title: 0,
  };
}

function reasonFor(
  offer: MatchedImpactAdOfferV2,
  evaluationTime: number,
): AdsIneligibilityReasonV2 | null {
  if (
    offer.association.matchMethod === "unmatched" ||
    offer.snapshotStatus === "ambiguous" ||
    offer.snapshotStatus === "unresolved"
  ) return "unresolved_store";
  if (offer.title === null || !offer.title.trim()) return "missing_title";
  const start = offer.startDate === null ? null : Date.parse(offer.startDate);
  const end = offer.endDate === null ? null : Date.parse(offer.endDate);
  if (
    (start !== null && !Number.isFinite(start)) ||
    (end !== null && !Number.isFinite(end))
  ) return "invalid_date";
  if (start !== null && end !== null && start > end) {
    return "invalid_date_range";
  }
  if (start !== null && evaluationTime < start) return "not_started";
  if (end !== null && evaluationTime > end) return "expired";
  return null;
}

/** Deterministic source-neutral eligibility; no clock is read here. */
export class AdsOfferQualification {
  static evaluate(
    matched: AdsStoreMatchResultV2,
    input: { evaluationTimestamp: string },
  ): AdsOfferQualificationOutputV2 {
    const evaluationTime = Date.parse(input.evaluationTimestamp);
    if (!Number.isFinite(evaluationTime)) {
      throw new Error("evaluationTimestamp must be a valid date-time string");
    }
    const reasonCounts = emptyReasonCounts();
    const offers: QualifiedImpactAdOfferV2[] = [];
    const seen = new Set<string>();
    for (const offer of matched.offers) {
      const adId = offer.providerOfferKey.id;
      if (!adId || seen.has(adId)) {
        throw new Error("Qualification requires unique exact AdIds");
      }
      seen.add(adId);
      const reason = reasonFor(offer, evaluationTime);
      if (reason !== null) reasonCounts[reason] += 1;
      offers.push({ offer, eligible: reason === null, reason });
    }
    const eligibleOffers = offers.filter((entry) => entry.eligible).length;
    return {
      evaluationTimestamp: input.evaluationTimestamp,
      offers,
      diagnostics: {
        offersEvaluated: offers.length,
        eligibleOffers,
        heldOffers: offers.length - eligibleOffers,
        reasonCounts,
      },
    };
  }
}
