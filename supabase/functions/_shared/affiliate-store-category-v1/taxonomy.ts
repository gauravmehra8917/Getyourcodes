export interface ProviderCategoryLabel {
  label: string;
  key: string;
}

export interface CampaignCategoryFact {
  campaignId: string | null;
  labels: readonly ProviderCategoryLabel[];
  invalid: boolean;
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** IDs are opaque: do not trim, case-fold, or substitute an AdvertiserId. */
export function exactCampaignId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\s/u.test(value) &&
    ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    ? value
    : null;
}

/** No punctuation removal, separator splitting, fuzzy matching or inference. */
export function normalizeCategoryLabel(value: unknown): ProviderCategoryLabel | null {
  if (typeof value !== "string" || value.length > 160) return null;
  const label = value.trim();
  if (
    !label ||
    !/[\p{L}\p{N}]/u.test(label) ||
    [...label].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 8 || (code >= 14 && code <= 31) || (code >= 127 && code <= 159);
    }) ||
    /[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(label)
  ) {
    return null;
  }
  return { label, key: label.toLowerCase().replace(/\s+/gu, " ") };
}

/** A malformed present field holds the whole Campaign, including mixed arrays. */
export function extractCampaignCategories(value: unknown): CampaignCategoryFact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { campaignId: null, labels: [], invalid: true };
  }
  const record = value as Record<string, unknown>;
  const campaignId = exactCampaignId(record.CampaignId);
  let invalid = campaignId === null;
  const labels = new Map<string, ProviderCategoryLabel>();
  for (const field of ["Categories", "Category", "Vertical", "Verticals"]) {
    const raw = record[field];
    if (raw === undefined || raw === null || raw === "") continue;
    const candidates = typeof raw === "string" ? [raw] : raw;
    if (!Array.isArray(candidates) || candidates.length > 32) {
      invalid = true;
      continue;
    }
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim() === "") continue;
      const normalized = normalizeCategoryLabel(candidate);
      if (!normalized) {
        invalid = true;
        continue;
      }
      const previous = labels.get(normalized.key);
      if (!previous || normalized.label < previous.label) labels.set(normalized.key, normalized);
    }
  }
  if (labels.size > 32) invalid = true;
  return {
    campaignId,
    labels: [...labels.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    invalid,
  };
}
