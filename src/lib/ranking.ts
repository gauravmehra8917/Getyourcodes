/**
 * Deal ranking algorithm.
 *
 * Score signals:
 *  - Discount strength (% off / $ off parsed from title)
 *  - Click-through rate (clicks)
 *  - Coupon save / success rate (saves)
 *  - Freshness (recency of created_at, penalty as expiry approaches)
 *  - Has a real code vs deal-only (codes weighted slightly higher when present)
 */
export type RankableCoupon = {
  id: string;
  title: string;
  created_at: string;
  expiry_date: string | null;
  coupon_type: "code" | "deal";
  coupon_code: string | null;
  clicks: number;
  saves: number;
  /** Optional merchant popularity boost (0..1). */
  storePopularity?: number;
};

export type RankedCoupon = RankableCoupon & { score: number };

function parseDiscount(title: string): number {
  const t = title.toLowerCase();
  const pct = t.match(/(\d{1,3})\s*%/);
  if (pct) {
    const n = Math.min(parseInt(pct[1]!, 10), 95);
    return n / 100; // 0..0.95
  }
  const dollar = t.match(/\$\s?(\d{1,4})/);
  if (dollar) {
    const n = parseInt(dollar[1]!, 10);
    return Math.min(n / 200, 0.9); // soft cap
  }
  if (/\bfree shipping\b/.test(t)) return 0.2;
  if (/\bbogo\b|buy one get one/.test(t)) return 0.5;
  if (/\bclearance\b|\bsale\b/.test(t)) return 0.1;
  return 0;
}

function freshnessScore(createdAt: string): number {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  // 1.0 at <=1d, decays to ~0.1 around 60d
  return Math.max(0.1, Math.exp(-ageDays / 30));
}

function expiryPenalty(expiry: string | null): number {
  if (!expiry) return 0;
  const days = (new Date(expiry).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return 0.8; // already expired — heavy penalty
  if (days < 1) return 0.15;
  return 0;
}

export function scoreCoupon(c: RankableCoupon): number {
  const discount = parseDiscount(c.title); // 0..1
  const ctr = Math.log10(1 + c.clicks) / 2.5; // clicks normalized
  const success = Math.log10(1 + c.saves) / 2; // saves are a stronger conversion signal
  const fresh = freshnessScore(c.created_at); // 0..1
  const codeBoost = c.coupon_type === "code" && c.coupon_code ? 0.05 : 0;
  const storeBoost = c.storePopularity ?? 0;

  const raw =
    discount * 0.4 +
    ctr * 0.2 +
    success * 0.2 +
    fresh * 0.15 +
    storeBoost * 0.1 +
    codeBoost;

  return raw - expiryPenalty(c.expiry_date);
}

export function rankCoupons<T extends RankableCoupon>(coupons: T[]): (T & { score: number })[] {
  return coupons
    .map((c) => ({ ...c, score: scoreCoupon(c) }))
    .sort((a, b) => b.score - a.score);
}
