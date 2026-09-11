import { projectUtcDateV2 } from "./dates.ts";

export interface StructuredTermsV2 {
  minimumPurchase?: number | null;
  maximumSavings?: number | null;
  purchaseLimit?: number | null;
  scope?: string | null;
  currency?: string | null;
  text?: string | null;
}

export interface TermRowV2 {
  label: string;
  value: string;
}

function moneyV2(amount: number, currency?: string | null): string {
  const code = (currency ?? "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount}`;
  }
}

export function readStructuredTermsV2(
  value: unknown,
): StructuredTermsV2 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as StructuredTermsV2;
}

export function formatStructuredTermsV2(value: unknown): TermRowV2[] {
  const terms = readStructuredTermsV2(value);
  if (!terms) return [];
  const rows: TermRowV2[] = [];
  if (
    typeof terms.minimumPurchase === "number" &&
    Number.isFinite(terms.minimumPurchase)
  ) {
    rows.push({
      label: "Minimum purchase",
      value: moneyV2(terms.minimumPurchase, terms.currency),
    });
  }
  if (
    typeof terms.maximumSavings === "number" &&
    Number.isFinite(terms.maximumSavings)
  ) {
    rows.push({
      label: "Maximum savings",
      value: moneyV2(terms.maximumSavings, terms.currency),
    });
  }
  if (
    typeof terms.purchaseLimit === "number" &&
    Number.isFinite(terms.purchaseLimit)
  ) {
    rows.push({
      label: "Purchase limit",
      value: `${terms.purchaseLimit} per customer`,
    });
  }
  if (terms.scope) {
    rows.push({ label: "Deal scope", value: String(terms.scope) });
  }
  return rows;
}

export function structuredTermsTextV2(value: unknown): string | null {
  const terms = readStructuredTermsV2(value);
  const text = terms?.text?.trim();
  return text || null;
}

/** Deterministic merchant terms generated solely from bounded provider values. */
export function generateTermsTextV2(
  value: unknown,
  expiryDate?: string | null,
): string | null {
  const providerText = structuredTermsTextV2(value);
  if (providerText) return providerText;

  const sentences = formatStructuredTermsV2(value).map((row) => {
    if (row.label === "Minimum purchase") {
      return `Minimum purchase of ${row.value} required.`;
    }
    if (row.label === "Maximum savings") {
      return `Maximum savings of ${row.value}.`;
    }
    if (row.label === "Purchase limit") return `Limited to ${row.value}.`;
    if (row.label === "Deal scope") return `Applies to: ${row.value}.`;
    return `${row.label}: ${row.value}.`;
  });

  if (expiryDate) {
    const projected = projectUtcDateV2(expiryDate);
    if (projected.ok && projected.value !== null) {
      const date = new Date(`${projected.value}T00:00:00.000Z`);
      sentences.push(
        `Offer valid until ${
          date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })
        }.`,
      );
    }
  }

  if (!sentences.length) return null;
  sentences.push(
    "Terms are set by the merchant and may change without notice.",
  );
  return sentences.join(" ");
}

export function formatDiscountV2(
  type: string | null | undefined,
  value: number | null | undefined,
  currency?: string | null,
): string | null {
  if (type === "free_shipping") return "Free shipping";
  if (type === "bogo") return "BOGO";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (type === "percentage") return `${Number(value.toFixed(2))}% off`;
    if (type === "fixed") return `${moneyV2(value, currency)} off`;
  }
  return null;
}
