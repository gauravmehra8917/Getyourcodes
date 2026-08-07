// Publishing Policy Engine — provider-agnostic.
//
// Runs after Normalization → Enrichment → Deduplication and before any
// database write. It only ever sees the canonical ImportPlan, so every current
// and future provider inherits the behaviour with no provider-specific code.

import type { ImportIssue, ImportPlan, PlannedRecord } from "@/lib/import/ImportPlan";
import type { CanonicalCoupon, CanonicalDeal } from "@/lib/normalizers";
import { resolveOfferStatus } from "@/lib/presentation/publishing";
import {
  FALLBACK_POLICY,
  type DistributionRow,
  type PolicyContext,
  type PolicyOutcome,
  type PublishingPolicy,
  type PublishingSummary,
  type RankingKey,
} from "./types";

type OfferKind = "coupon" | "deal";
type OfferSource = CanonicalCoupon | CanonicalDeal;

interface Offer {
  kind: OfferKind;
  action: "create" | "update";
  record: PlannedRecord<CanonicalCoupon> | PlannedRecord<CanonicalDeal>;
  storeKey: string;
  storeName: string;
  discount: number;
  startAt: number;
  endAt: number;
  priority: number;
}

const UNKNOWN_STORE = "__unassigned__";

function storeKeyOf(s: OfferSource): string {
  const anyS = s as { providerAdvertiserId?: string | null; providerStoreId?: string | null; providerCampaignId?: string | null };
  return anyS.providerAdvertiserId || anyS.providerStoreId || anyS.providerCampaignId || UNKNOWN_STORE;
}

const ts = (v: string | null | undefined, fallback: number): number => {
  if (!v) return fallback;
  const t = Date.parse(v);
  return Number.isNaN(t) ? fallback : t;
};

function discountOf(kind: OfferKind, s: OfferSource): number {
  if (kind !== "coupon") return 0;
  const c = s as CanonicalCoupon;
  if (typeof c.discountValue === "number" && Number.isFinite(c.discountValue)) {
    return c.discountType === "percentage" ? c.discountValue : c.discountValue / 100;
  }
  return 0;
}

function comparator(priority: RankingKey[]) {
  const keys = priority.length ? priority : FALLBACK_POLICY.rankingPriority;
  return (a: Offer, b: Offer): number => {
    for (const key of keys) {
      let d = 0;
      if (key === "merchant_priority") d = b.priority - a.priority;
      else if (key === "discount") d = b.discount - a.discount;
      else if (key === "newest") d = b.startAt - a.startAt;
      else if (key === "expiry") d = a.endAt - b.endAt;
      if (d !== 0) return d;
    }
    return a.record.providerEntityId.localeCompare(b.record.providerEntityId);
  };
}

function hold(held: ImportIssue[], offer: Offer, reason: string) {
  held.push({
    entity: offer.kind,
    providerEntityId: offer.record.providerEntityId,
    reason,
  });
}

export function applyPublishingPolicy(
  plan: ImportPlan,
  policy: PublishingPolicy,
  ctx: PolicyContext = {},
): PolicyOutcome<ImportPlan> {
  const now = ctx.now ?? new Date();
  const rotationIn = ctx.rotation ?? {};
  const merchantPriority = ctx.merchantPriority ?? {};
  const disabled = new Set(ctx.manuallyDisabledIds ?? []);

  const storeNames = new Map<string, string>();
  for (const r of [...plan.storesToCreate, ...plan.storesToUpdate]) {
    const s = r.source;
    for (const key of [r.providerEntityId, s.providerStoreId, s.providerAdvertiserId, s.providerCampaignId]) {
      if (key) storeNames.set(key, s.name);
    }
  }

  const collect = (kind: OfferKind): Offer[] => {
    const lists: [("create" | "update"), PlannedRecord<CanonicalCoupon>[] | PlannedRecord<CanonicalDeal>[]][] =
      kind === "coupon"
        ? [["create", plan.couponsToCreate], ["update", plan.couponsToUpdate]]
        : [["create", plan.dealsToCreate], ["update", plan.dealsToUpdate]];
    const out: Offer[] = [];
    for (const [action, list] of lists) {
      for (const record of list) {
        const s = record.source as OfferSource;
        const storeKey = storeKeyOf(s);
        out.push({
          kind,
          action,
          record,
          storeKey,
          storeName: storeNames.get(storeKey) ?? storeKey,
          discount: discountOf(kind, s),
          startAt: ts(s.startDate, 0),
          endAt: ts(s.endDate, Number.MAX_SAFE_INTEGER),
          priority: merchantPriority[storeKey] ?? 0,
        });
      }
    }
    return out;
  };

  const fetched = { coupon: 0, deal: 0 };
  const publishedByKind = { coupon: [] as Offer[], deal: [] as Offer[] };
  const held: ImportIssue[] = [];
  const distribution = new Map<string, DistributionRow>();
  const rotationCursors: Record<string, number> = { ...rotationIn };

  const row = (offer: Offer): DistributionRow => {
    let r = distribution.get(offer.storeKey);
    if (!r) {
      r = { storeKey: offer.storeKey, storeName: offer.storeName, couponsPublished: 0, couponsHeld: 0, dealsPublished: 0, dealsHeld: 0 };
      distribution.set(offer.storeKey, r);
    }
    return r;
  };

  const disabledFlag = !policy.enabled;

  for (const kind of ["coupon", "deal"] as OfferKind[]) {
    const offers = collect(kind);
    fetched[kind] = offers.length;

    if (disabledFlag) {
      publishedByKind[kind] = offers;
      for (const o of offers) {
        const r = row(o);
        if (kind === "coupon") r.couponsPublished++;
        else r.dealsPublished++;
      }
      continue;
    }

    // ── Content rules ──────────────────────────────────────────────────────
    const eligible: Offer[] = [];
    for (const o of offers) {
      const s = o.record.source as OfferSource;
      const status = resolveOfferStatus({
        providerStatus: s.status,
        startDate: s.startDate,
        endDate: s.endDate,
        now,
      });
      if (policy.skipExpired && status === "expired") {
        hold(held, o, "expired offer");
      } else if (policy.publishOnlyActive && status !== "active") {
        hold(held, o, `offer is not active (${status})`);
      } else if (policy.respectManualDisable && o.record.existingId && disabled.has(o.record.existingId)) {
        hold(held, o, "manually disabled by an administrator");
      } else {
        eligible.push(o);
      }
      if (!eligible.includes(o)) {
        const r = row(o);
        if (kind === "coupon") r.couponsHeld++;
        else r.dealsHeld++;
      }
    }

    // ── Ranking + per-store limits ─────────────────────────────────────────
    const byStore = new Map<string, Offer[]>();
    for (const o of eligible) {
      const list = byStore.get(o.storeKey) ?? [];
      list.push(o);
      byStore.set(o.storeKey, list);
    }

    const min = kind === "coupon" ? policy.minCouponsPerStore : policy.minDealsPerStore;
    let max = kind === "coupon" ? policy.maxCouponsPerStore : policy.maxDealsPerStore;

    // Fair distribution without an explicit cap: give every store the same
    // share of the batch so a single large merchant cannot dominate.
    if (policy.fairDistribution && max <= 0 && byStore.size > 0) {
      const fairShare = Math.ceil(eligible.length / byStore.size);
      max = Math.max(fairShare, min);
    }

    const cmp = comparator(policy.rankingPriority);
    const perStorePublished: Offer[][] = [];

    for (const [storeKey, list] of byStore) {
      list.sort(cmp);
      if (min > 0 && list.length < min) {
        for (const o of list) {
          hold(held, o, `store has fewer than the minimum of ${min} ${kind}s`);
          const r = row(o);
          if (kind === "coupon") r.couponsHeld++;
          else r.dealsHeld++;
        }
        continue;
      }

      const limit = max > 0 ? Math.min(max, list.length) : list.length;
      const cursorKey = `${kind}:${storeKey}`;
      const offset = policy.rotation && list.length > limit ? (rotationIn[cursorKey] ?? 0) % list.length : 0;
      const ordered = offset ? [...list.slice(offset), ...list.slice(0, offset)] : list;
      const take = ordered.slice(0, limit);
      const rest = ordered.slice(limit);

      if (policy.rotation) rotationCursors[cursorKey] = list.length ? (offset + limit) % list.length : 0;

      perStorePublished.push(take);
      for (const o of take) {
        const r = row(o);
        if (kind === "coupon") r.couponsPublished++;
        else r.dealsPublished++;
      }
      for (const o of rest) {
        hold(held, o, `over the maximum of ${max} ${kind}s per store`);
        const r = row(o);
        if (kind === "coupon") r.couponsHeld++;
        else r.dealsHeld++;
      }
    }

    // Fair distribution also interleaves merchants in the published order.
    const publishedList: Offer[] = [];
    if (policy.fairDistribution) {
      const longest = perStorePublished.reduce((m, l) => Math.max(m, l.length), 0);
      for (let i = 0; i < longest; i++) {
        for (const list of perStorePublished) if (list[i]) publishedList.push(list[i]!);
      }
    } else {
      for (const list of perStorePublished) publishedList.push(...list);
    }
    publishedByKind[kind] = publishedList;
  }

  // ── Rebuild the plan with published records only ──────────────────────────
  const nextPlan: ImportPlan = {
    ...plan,
    couponsToCreate: publishedByKind.coupon.filter((o) => o.action === "create").map((o) => o.record as PlannedRecord<CanonicalCoupon>),
    couponsToUpdate: publishedByKind.coupon.filter((o) => o.action === "update").map((o) => o.record as PlannedRecord<CanonicalCoupon>),
    dealsToCreate: publishedByKind.deal.filter((o) => o.action === "create").map((o) => o.record as PlannedRecord<CanonicalDeal>),
    dealsToUpdate: publishedByKind.deal.filter((o) => o.action === "update").map((o) => o.record as PlannedRecord<CanonicalDeal>),
    skipped: [...plan.skipped, ...held],
  };

  const couponsPublished = publishedByKind.coupon.length;
  const dealsPublished = publishedByKind.deal.length;
  const rows = [...distribution.values()].sort(
    (a, b) => b.couponsPublished + b.dealsPublished - (a.couponsPublished + a.dealsPublished),
  );
  const storesCovered = rows.filter((r) => r.couponsPublished + r.dealsPublished > 0).length;
  const totalFetched = fetched.coupon + fetched.deal;

  const reasonCounts = new Map<string, number>();
  for (const h of held) reasonCounts.set(h.reason, (reasonCounts.get(h.reason) ?? 0) + 1);

  const round = (v: number) => Math.round(v * 10) / 10;

  const summary: PublishingSummary = {
    policyId: policy.id,
    policyName: policy.name,
    applied: !disabledFlag,
    couponsFetched: fetched.coupon,
    couponsPublished,
    couponsHeld: fetched.coupon - couponsPublished,
    dealsFetched: fetched.deal,
    dealsPublished,
    dealsHeld: fetched.deal - dealsPublished,
    storesCovered,
    averageCouponsPerStore: storesCovered ? round(couponsPublished / storesCovered) : 0,
    averageDealsPerStore: storesCovered ? round(dealsPublished / storesCovered) : 0,
    coveragePercent: totalFetched ? round(((couponsPublished + dealsPublished) / totalFetched) * 100) : 0,
    holdReasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    distribution: rows.slice(0, 50),
    rules: {
      fairDistribution: policy.fairDistribution,
      rotation: policy.rotation,
      publishOnlyActive: policy.publishOnlyActive,
      skipExpired: policy.skipExpired,
      skipDuplicateIdentities: policy.skipDuplicateIdentities,
      respectManualDisable: policy.respectManualDisable,
      neverOverwriteAdminEdits: policy.neverOverwriteAdminEdits,
      rankingPriority: policy.rankingPriority,
      minCouponsPerStore: policy.minCouponsPerStore,
      maxCouponsPerStore: policy.maxCouponsPerStore,
      minDealsPerStore: policy.minDealsPerStore,
      maxDealsPerStore: policy.maxDealsPerStore,
    },
  };

  return { plan: nextPlan, summary, rotationCursors };
}

export class PublishingPolicyEngine {
  static apply = applyPublishingPolicy;
}
