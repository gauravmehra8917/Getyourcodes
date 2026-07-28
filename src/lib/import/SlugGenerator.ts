// SEO-friendly, collision-free slug generation. Provider-independent.

export function slugify(input: string): string {
  const base = (input ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "item";
}

/**
 * Reserves unique slugs across an import run.
 * Seed it with slugs already present in the database.
 */
export class SlugGenerator {
  private taken = new Set<string>();

  constructor(existing: Iterable<string> = []) {
    for (const s of existing) if (s) this.taken.add(s);
  }

  /** Reuse `preferred` when it already belongs to this record. */
  reserve(name: string, preferred?: string | null): string {
    if (preferred && !this.taken.has(preferred)) {
      this.taken.add(preferred);
      return preferred;
    }
    if (preferred) return preferred; // already this record's own slug

    const base = slugify(name);
    if (!this.taken.has(base)) {
      this.taken.add(base);
      return base;
    }
    let i = 2;
    while (this.taken.has(`${base}-${i}`)) i += 1;
    const slug = `${base}-${i}`;
    this.taken.add(slug);
    return slug;
  }

  has(slug: string): boolean {
    return this.taken.has(slug);
  }
}
