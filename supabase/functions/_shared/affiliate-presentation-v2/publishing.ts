import { evaluationUtcDateV2, projectUtcDateV2 } from "./dates.ts";

export type PublishStatusV2 = "active" | "expired" | "draft";

export interface OfferLifecycleInputV2 {
  providerStatus?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  valid?: boolean;
  publiclyAvailable?: boolean;
  evaluationTimestamp: string;
}

/** Established lifecycle formula with an explicit, UTC-stable evaluation time. */
export function resolveOfferStatusV2(
  input: OfferLifecycleInputV2,
): PublishStatusV2 {
  const evaluationDate = evaluationUtcDateV2(input.evaluationTimestamp);
  const { providerStatus, valid = true, publiclyAvailable = true } = input;
  if (!valid || !publiclyAvailable) return "draft";

  const start = projectUtcDateV2(input.startDate ?? null);
  const end = projectUtcDateV2(input.endDate ?? null);
  if (!start.ok || !end.ok) return "draft";
  if (end.value !== null && end.value < evaluationDate) return "expired";
  if (start.value !== null && start.value > evaluationDate) return "draft";

  switch (providerStatus) {
    case "inactive":
    case "pending":
      return "draft";
    case "expired":
    case "active":
    case "unknown":
    default:
      return "active";
  }
}
