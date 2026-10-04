import type { RawImpactCampaignV2 } from "../_shared/affiliate-sync-v2/models.ts";
import type {
  StoreCategoryTaxonomyAuditV2,
  StoreCategoryTaxonomyFieldCoverageV2,
  StoreCategoryTaxonomyFieldV2,
  StoreCategoryTaxonomyLabelV2,
} from "./types.ts";

const TAXONOMY_FIELDS: readonly StoreCategoryTaxonomyFieldV2[] = [
  "Categories",
  "Category",
  "Vertical",
  "Verticals",
];
const MAX_ARRAY_LENGTH = 32;
const MAX_LABEL_LENGTH = 160;
const MAX_RESPONSE_LABELS = 100;

interface CategoryLabel {
  label: string;
  key: string;
}

/** P1C-A1 label semantics: retain trimmed display text and punctuation. */
function normalizeCategoryLabel(value: unknown): CategoryLabel | null {
  if (typeof value !== "string" || value.length > MAX_LABEL_LENGTH) return null;
  const label = value.trim();
  if (
    !label ||
    !/[\p{L}\p{N}]/u.test(label) ||
    [...label].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 8 || (code >= 14 && code <= 31) ||
        (code >= 127 && code <= 159);
    }) ||
    /[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(label)
  ) {
    return null;
  }
  return { label, key: label.toLowerCase().replace(/\s+/gu, " ") };
}

function emptyFieldCoverage(): StoreCategoryTaxonomyFieldCoverageV2 {
  return { present: 0, validString: 0, validArray: 0, malformed: 0 };
}

/** Aggregate only taxonomy from a completed Campaign fetch; no host capabilities. */
export function summarizeStoreCategoryTaxonomyV2(
  campaigns: readonly RawImpactCampaignV2[],
): StoreCategoryTaxonomyAuditV2 {
  const fieldCoverage: StoreCategoryTaxonomyAuditV2["fieldCoverage"] = {
    Categories: emptyFieldCoverage(),
    Category: emptyFieldCoverage(),
    Vertical: emptyFieldCoverage(),
    Verticals: emptyFieldCoverage(),
  };
  const aggregate = new Map<string, StoreCategoryTaxonomyLabelV2>();
  let campaignsWithUsableTaxonomy = 0;
  let campaignsWithoutTaxonomy = 0;
  let invalidTaxonomyCampaigns = 0;

  for (const campaign of campaigns) {
    const labels = new Map<string, CategoryLabel>();
    let invalid = false;
    for (const field of TAXONOMY_FIELDS) {
      if (!Object.hasOwn(campaign.raw, field)) continue;
      const value = campaign.raw[field];
      if (value === undefined || value === null || value === "") continue;
      const coverage = fieldCoverage[field];
      coverage.present += 1;
      const candidates = typeof value === "string" ? [value] : value;
      if (!Array.isArray(candidates) || candidates.length > MAX_ARRAY_LENGTH) {
        coverage.malformed += 1;
        invalid = true;
        continue;
      }

      let malformed = false;
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim() === "") continue;
        const normalized = normalizeCategoryLabel(candidate);
        if (normalized === null) {
          malformed = true;
          continue;
        }
        const previous = labels.get(normalized.key);
        if (!previous || normalized.label < previous.label) {
          labels.set(normalized.key, normalized);
        }
      }
      if (malformed) {
        coverage.malformed += 1;
        invalid = true;
      } else if (typeof value === "string") {
        coverage.validString += 1;
      } else {
        coverage.validArray += 1;
      }
    }

    if (invalid) {
      invalidTaxonomyCampaigns += 1;
      continue;
    }
    if (labels.size === 0) {
      campaignsWithoutTaxonomy += 1;
      continue;
    }
    campaignsWithUsableTaxonomy += 1;
    for (const { label, key } of labels.values()) {
      const previous = aggregate.get(key);
      if (previous) {
        previous.campaignCount += 1;
        if (label < previous.label) previous.label = label;
      } else {
        aggregate.set(key, { label, key, campaignCount: 1 });
      }
    }
  }

  const labels = [...aggregate.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );
  return {
    complete: true,
    campaignsEvaluated: campaigns.length,
    campaignsWithUsableTaxonomy,
    campaignsWithoutTaxonomy,
    invalidTaxonomyCampaigns,
    distinctLabels: labels.length,
    labels: labels.slice(0, MAX_RESPONSE_LABELS),
    labelsTruncated: labels.length > MAX_RESPONSE_LABELS,
    fieldCoverage,
  };
}