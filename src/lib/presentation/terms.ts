// Structured terms → readable, human display rows.
// Only provider-supplied values are shown. Nothing is invented.

export interface StructuredTermsShape {
  minimumPurchase?: number | null;
  maximumSavings?: number | null;
  purchaseLimit?: number | null;
  scope?: string | null;
  currency?: string | null;
  text?: string | null;
}

export interface TermRow {
  label: string;
  value: string;
}

/** Translate known provider scope codes; never pretend a specific category is known. */
export function friendlyScope(scope: unknown): string | null {
  if (typeof scope !== "string") return null;
  switch (scope.trim().toUpperCase()) {
    case "ENTIRE_STORE":
      return "Storewide offer";
    case "PRODUCT":
      return "Selected products (check merchant eligibility)";
    case "CATEGORY":
      return "Selected product categories (not specified)";
    default:
      return null;
  }
}

/** Fail closed only for unequivocal percentage-versus-fixed-sum contradictions. */
export function hasDiscountTypeConflict(
  title: string | null | undefined,
  description: string | null | undefined,
  type: string | null | undefined,
  value: number | null | undefined,
): boolean {
  if (
    (type !== "fixed" && type !== "percentage") ||
    typeof value !== "number" ||
    !Number.isFinite(value)
  )
    return false;
  const claims = [title, description].filter((v): v is string => typeof v === "string");
  // Require a discount claim, not merely a year, product price, or eligibility threshold.
  if (type === "fixed")
    return claims.some((v) => /\b\d+(?:\.\d+)?\s*%\s*(?:off|discount|savings|sale)\b/i.test(v));
  return claims.some((v) =>
    /(?:US\$|\$|USD\s*)\s*\d+(?:\.\d+)?\s*(?:off|discount|savings)\b/i.test(v),
  );
}

function money(amount: number, currency?: string | null): string {
  const code = (currency ?? "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount}`;
  }
}

export function readStructuredTerms(value: unknown): StructuredTermsShape | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as StructuredTermsShape;
}

/** Converts structured terms into display rows. Empty array when nothing usable. */
export function formatStructuredTerms(value: unknown): TermRow[] {
  const t = readStructuredTerms(value);
  if (!t) return [];
  const rows: TermRow[] = [];
  if (typeof t.minimumPurchase === "number") {
    rows.push({ label: "Minimum purchase", value: money(t.minimumPurchase, t.currency) });
  }
  if (typeof t.maximumSavings === "number") {
    rows.push({ label: "Maximum savings", value: money(t.maximumSavings, t.currency) });
  }
  if (typeof t.purchaseLimit === "number") {
    rows.push({ label: "Purchase limit", value: `${t.purchaseLimit} per customer` });
  }
  const scope = friendlyScope(t.scope);
  if (scope) rows.push({ label: "Offer eligibility", value: scope });
  return rows;
}

/** Humanize only recognized provider phrases; retain all other merchant wording. */
export function humanizeProviderTerms(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.replace(
    /\bApplies to:\s*(ENTIRE_STORE|PRODUCT|CATEGORY)\b/gi,
    (_match, scope: string) =>
      `Offer eligibility: ${friendlyScope(scope) ?? "Check merchant terms"}`,
  );
}

/** Free-text terms supplied by the provider, if any. */
export function structuredTermsText(value: unknown): string | null {
  const t = readStructuredTerms(value);
  const text = t?.text?.trim();
  if (!text) return null;
  return humanizeProviderTerms(text);
}

/**
 * Deterministic terms & conditions text built only from provider values.
 * Returns null when the provider supplied nothing usable — never invents copy.
 */
export function generateTermsText(value: unknown, expiryDate?: string | null): string | null {
  const providerText = structuredTermsText(value);
  if (providerText) return providerText;

  const rows = formatStructuredTerms(value);
  const sentences = rows.map((r) => {
    if (r.label === "Minimum purchase") return `Minimum purchase of ${r.value} required.`;
    if (r.label === "Maximum savings") return `Maximum savings of ${r.value}.`;
    if (r.label === "Purchase limit") return `Limited to ${r.value}.`;
    if (r.label === "Offer eligibility") return `Offer eligibility: ${r.value}.`;
    return `${r.label}: ${r.value}.`;
  });

  if (expiryDate) {
    const d = new Date(expiryDate);
    if (!Number.isNaN(d.getTime())) {
      sentences.push(
        `Offer valid until ${d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`,
      );
    }
  }

  if (!sentences.length) return null;
  sentences.push("Terms are set by the merchant and may change without notice.");
  return sentences.join(" ");
}

/** "20% off" / "$15 off" / "Free shipping" — only from imported values. */
export function formatDiscount(
  type: string | null | undefined,
  value: number | null | undefined,
  currency?: string | null,
): string | null {
  if (type === "free_shipping") return "Free shipping";
  if (type === "bogo") return "BOGO";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (type === "percentage") return `${Number(value.toFixed(2))}% off`;
    if (type === "fixed") return `${money(value, currency)} off`;
  }
  return null;
}
