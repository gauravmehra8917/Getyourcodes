// Stage 2 – duplicate detection within an incoming batch.
//
// Identity is ALWAYS the provider's immutable identifier:
//   (provider, providerEntityId)
// Titles, slugs, coupon codes, discounts, dates and campaign/advertiser names
// are mutable between synchronizations and are never part of identity.

import type { ImportEntityKind, ImportIssue } from "./ImportPlan";

export interface DedupeOutcome<T> {
  unique: T[];
  /** One issue per duplicated identity, carrying the occurrence count. */
  duplicates: ImportIssue[];
  /** Number of records dropped because a later record shared their identity. */
  dropped: number;
}

export interface Identity {
  /** Provider-scoped immutable id. */
  id: string;
  /** Raw provider value the id came from (diagnostics only). */
  raw?: string | null;
}

/**
 * Keeps the last occurrence of each (provider, providerEntityId) — providers
 * usually emit the freshest record last — and reports every collision group.
 */
export function dedupe<T>(
  entity: ImportEntityKind,
  provider: string,
  items: T[],
  identityOf: (item: T) => Identity | string,
): DedupeOutcome<T> {
  const byKey = new Map<string, { item: T; count: number; raw: string | null }>();
  const order: string[] = [];

  for (const item of items) {
    const resolved = identityOf(item);
    const identity: Identity = typeof resolved === "string" ? { id: resolved } : resolved;
    const key = `${provider}::${identity.id}`;
    const prev = byKey.get(key);
    if (prev) {
      byKey.set(key, { item, count: prev.count + 1, raw: identity.raw ?? prev.raw ?? null });
    } else {
      order.push(key);
      byKey.set(key, { item, count: 1, raw: identity.raw ?? null });
    }
  }

  const duplicates: ImportIssue[] = [];
  let dropped = 0;
  for (const key of order) {
    const entry = byKey.get(key)!;
    if (entry.count <= 1) continue;
    dropped += entry.count - 1;
    duplicates.push({
      entity,
      provider,
      providerEntityId: key.slice(provider.length + 2),
      identity: key,
      occurrences: entry.count,
      rawProviderId: entry.raw,
      reason: `same provider identity (${provider}, ${key.slice(provider.length + 2)}) appears ${entry.count} times in this batch`,
    });
  }

  return { unique: order.map((k) => byKey.get(k)!.item), duplicates, dropped };
}

export const DuplicateResolver = { dedupe };
