import type { StoreCandidate, StoreLifecycleDecision, StoreLifecycleStatistics } from "./ImportPlan.ts";
import type { StoreQualification } from "./StoreQualification.ts";

const keys = (c: StoreCandidate) => [c.providerEntityId, c.source.providerStoreId, c.source.providerAdvertiserId, c.source.providerCampaignId].filter((v): v is string => !!v);
export function planStoreLifecycle(candidates: StoreCandidate[], qualifications: StoreQualification[]): { decisions: StoreLifecycleDecision[]; statistics: StoreLifecycleStatistics } {
  const byKey = new Map(qualifications.map((q) => [q.storeKey, q]));
  const stats: StoreLifecycleStatistics = { storesEvaluated: 0, storesQualified: 0, storesHeld: 0, storesToCreate: 0, storesToUpdate: 0, storesToLifecycleHide: 0, storesToLifecycleRepublish: 0 };
  const decisions = candidates.map((candidate) => {
    const q = keys(candidate).map((k) => byKey.get(k)).find(Boolean) ?? { qualified: false, reason: "insufficient_publishable_offers", eligibleCoupons: 0, eligibleDeals: 0, selectedCoupons: 0, selectedDeals: 0 };
    stats.storesEvaluated++; if (q.qualified) stats.storesQualified++;
    let action: StoreLifecycleDecision["action"];
    if (!candidate.existingId) action = q.qualified ? "create_store" : "hold_store";
    else if (!candidate.existingLifecycleManaged) action = "hold_store";
    else if (!q.qualified) action = "lifecycle_hide_store";
    else action = candidate.existingLifecycleHidden ? "lifecycle_republish_store" : "update_store";
    if (action === "hold_store") stats.storesHeld++; else if (action === "create_store") stats.storesToCreate++; else if (action === "update_store") stats.storesToUpdate++; else if (action === "lifecycle_hide_store") stats.storesToLifecycleHide++; else stats.storesToLifecycleRepublish++;
    return { action, providerEntityId: candidate.providerEntityId, candidate, qualification: q };
  });
  return { decisions, statistics: stats };
}
