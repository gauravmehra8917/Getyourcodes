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

function money(amount: number, currency?: string | null): string {
  const code = (currency ?? "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(amount);
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
  if (t.scope) rows.push({ label: "Deal scope", value: String(t.scope) });
  return rows;
}

/** Free-text terms supplied by the provider, if any. */
export function structuredTermsText(value: unknown): string | null {
  const t = readStructuredTerms(value);
  const text = t?.text?.trim();
  return text ? text : null;
}

/** "20% off" / "$15 off" / "Free shipping" — only from imported values. */
export function formatDiscount(type: string | null | undefined, value: number | null | undefined, currency?: string | null): string | null {
  if (type === "free_shipping") return "Free shipping";
  if (type === "bogo") return "BOGO";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (type === "percentage") return `${Number(value.toFixed(2))}% off`;
    if (type === "fixed") return `${money(value, currency)} off`;
  }
  return null;
}
