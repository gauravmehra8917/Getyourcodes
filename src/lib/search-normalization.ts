/** Keep public ILIKE searches bounded and prevent wildcard-only queries. */
export function normalizeSearchTerm(value: string): string {
  return value.replace(/[%_]/g, "").trim().slice(0, 100).trim();
}
