// Lifecycle-based publishing rules for imported / synced offers (CODE + DEAL).
//
// Presentation-layer only: it maps a canonical provider status plus the offer's
// validity window onto the CMS coupon_status the catalog renders from.
//
//   validation failed              → draft   (disabled, never public)
//   today < start date             → draft   (scheduled)
//   today > end date               → expired
//   valid, available and active    → active  (published, no manual step)

export type PublishStatus = "active" | "expired" | "draft";

export interface OfferLifecycleInput {
  /** Canonical provider status: active | inactive | expired | pending | unknown. */
  providerStatus?: string | null;
  /** ISO date/datetime strings, or null when the provider omits them. */
  startDate?: string | null;
  endDate?: string | null;
  /** False when the record failed validation — it must never go public. */
  valid?: boolean;
  /** False when the provider marks the offer as not publicly available. */
  publiclyAvailable?: boolean;
  now?: Date;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function toDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function resolveOfferStatus(input: OfferLifecycleInput): PublishStatus {
  const { providerStatus, valid = true, publiclyAvailable = true } = input;
  if (!valid || !publiclyAvailable) return "draft";

  const today = startOfDay(input.now ?? new Date());
  const start = toDay(input.startDate);
  const end = toDay(input.endDate);

  if (end && end.getTime() < today.getTime()) return "expired";
  if (start && start.getTime() > today.getTime()) return "draft";

  switch (providerStatus) {
    case "inactive":
    case "pending":
      return "draft";
    // Providers frequently keep a stale "expired" flag on live offers; the
    // date window above is authoritative, so within it the offer publishes.
    case "expired":
    case "active":
    case "unknown":
    default:
      return "active";
  }
}
