// Stage 3 – matching canonical entities against existing database rows.
// Reads only; all writes happen in the executor's transaction.

export interface ExistingRow {
  id: string;
  slug?: string | null;
  providerEntityId: string | null;
}

export interface ExistingSnapshot {
  /** provider entity id -> internal id */
  byProviderId: Map<string, string>;
  /** slug -> internal id (stores/categories only) */
  bySlug: Map<string, string>;
  /** every slug currently taken in the table */
  slugs: string[];
}

export function buildSnapshot(rows: ExistingRow[]): ExistingSnapshot {
  const byProviderId = new Map<string, string>();
  const bySlug = new Map<string, string>();
  const slugs: string[] = [];
  for (const row of rows) {
    if (row.providerEntityId) byProviderId.set(row.providerEntityId, row.id);
    if (row.slug) {
      bySlug.set(row.slug, row.id);
      slugs.push(row.slug);
    }
  }
  return { byProviderId, bySlug, slugs };
}

export const EntityMatcher = {
  buildSnapshot,
  /** Primary match on provider id, secondary on slug (internal identifier). */
  match(
    snapshot: ExistingSnapshot,
    providerEntityId: string,
    candidateSlug?: string | null,
  ): { existingId: string | null; matchedBy: "provider" | "slug" | null } {
    const byProvider = snapshot.byProviderId.get(providerEntityId);
    if (byProvider) return { existingId: byProvider, matchedBy: "provider" };
    if (candidateSlug) {
      const bySlug = snapshot.bySlug.get(candidateSlug);
      if (bySlug) return { existingId: bySlug, matchedBy: "slug" };
    }
    return { existingId: null, matchedBy: null };
  },
};
