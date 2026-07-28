// Stage 2 – duplicate detection within an incoming batch.
// Rules are provider-independent: (provider, providerEntityId).

import type { ImportEntityKind, ImportIssue } from "./ImportPlan";

export interface DedupeOutcome<T> {
  unique: T[];
  duplicates: ImportIssue[];
}

/**
 * Keeps the last occurrence of each provider id (providers usually emit the
 * freshest record last) and reports every earlier collision.
 */
export function dedupe<T>(
  entity: ImportEntityKind,
  items: T[],
  keyOf: (item: T) => string,
): DedupeOutcome<T> {
  const byKey = new Map<string, T>();
  const duplicates: ImportIssue[] = [];

  for (const item of items) {
    const key = keyOf(item);
    if (byKey.has(key)) {
      duplicates.push({ entity, providerEntityId: key, reason: "duplicate provider id in batch" });
    }
    byKey.set(key, item);
  }

  return { unique: [...byKey.values()], duplicates };
}

export const DuplicateResolver = { dedupe };
