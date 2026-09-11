import {
  type ImpactAdDiscountTypeV2,
  type ImpactAdStructuredTermsV2,
  type RawImpactAdV2,
  toOpaqueAdProviderIdV2,
  type ValidatedImpactAdCouponCodeV2,
} from "./ad-models.ts";
import type {
  ImpactAdsParseFailureReasonV2,
  ImpactAdsQuarantineReasonCountsV2,
} from "./ads-diagnostics.ts";
import {
  impactContinuationV2,
  impactPageMetadataV2,
  impactRecordProvenanceV2,
  isImpactRecordV2,
  optionalImpactStringV2,
} from "./impact-page-parsing.ts";

export interface ParsedImpactAdsPageV2 {
  ok: true;
  records: RawImpactAdV2[];
  rawRecordCount: number;
  quarantineReasonCounts: ImpactAdsQuarantineReasonCountsV2;
  providerPage: number | null;
  providerPageSize: number | null;
  nextContinuationUri: string | null;
}

export interface ImpactAdsPageParseFailureV2 {
  ok: false;
  reason: ImpactAdsParseFailureReasonV2;
}

export type ImpactAdsPageParseResultV2 =
  | ParsedImpactAdsPageV2
  | ImpactAdsPageParseFailureV2;

const INVALID_COUPON_CODE = /^(?:n\/a|none|no code|null|undefined)$/i;

function validatedCouponCode(value: unknown): ValidatedImpactAdCouponCodeV2 {
  if (typeof value !== "string") {
    return { codeClass: "no_code", validatedCouponCode: null };
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && !INVALID_COUPON_CODE.test(trimmed)
    ? { codeClass: "code_bearing", validatedCouponCode: trimmed }
    : { codeClass: "no_code", validatedCouponCode: null };
}

interface ParsedDateFieldV2 {
  value: string | null;
  valid: boolean;
}

function validDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return date.toISOString().slice(0, 10) === value;
}

function validProviderDate(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validDateOnly(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i
      .test(value) || !validDateOnly(value.slice(0, 10))
  ) return false;
  return Number.isFinite(Date.parse(value));
}

function dateField(
  record: Record<string, unknown>,
  property: "DealStartDate" | "DealEndDate" | "StartDate" | "EndDate",
): ParsedDateFieldV2 {
  if (!Object.prototype.hasOwnProperty.call(record, property)) {
    return { value: null, valid: true };
  }
  const value = record[property];
  if (value === null) return { value: null, valid: true };
  if (typeof value !== "string") return { value: null, valid: false };
  const trimmed = value.trim();
  if (!trimmed) return { value: null, valid: true };
  return { value: trimmed, valid: validProviderDate(trimmed) };
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonnegativeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function currency(record: Record<string, unknown>): string | null {
  const values = [
    record.MinimumPurchaseAmountCurrency,
    record.MaximumSavingsCurrency,
    record.DiscountCurrency,
    record.Currency,
  ].flatMap((value) => {
    const parsed = optionalImpactStringV2(value);
    return parsed !== null && /^[A-Za-z]{3}$/.test(parsed)
      ? [parsed.toUpperCase()]
      : [];
  });
  const unique = new Set(values);
  return unique.size === 1 ? values[0]! : null;
}

function structuredTerms(
  record: Record<string, unknown>,
): ImpactAdStructuredTermsV2 | null {
  const terms: ImpactAdStructuredTermsV2 = {
    minimumPurchase: nonnegativeNumber(record.MinimumPurchaseAmount),
    maximumSavings: nonnegativeNumber(record.MaximumSavingsAmount),
    purchaseLimit: positiveNumber(record.PurchaseLimitQuantity),
    scope: optionalImpactStringV2(record.DealScope),
    currency: currency(record),
    text: optionalImpactStringV2(record.Terms),
  };
  return Object.values(terms).some((value) => value !== null) ? terms : null;
}

function discount(record: Record<string, unknown>): {
  discountType: ImpactAdDiscountTypeV2;
  discountValue: number | null;
} {
  const percent = nonnegativeNumber(record.DiscountPercent);
  if (percent !== null) {
    return { discountType: "percentage", discountValue: percent };
  }
  const amount = nonnegativeNumber(record.DiscountAmount);
  return amount === null
    ? { discountType: "unknown", discountValue: null }
    : { discountType: "fixed", discountValue: amount };
}

function adOf(
  record: Record<string, unknown>,
  adId: string,
  fetchSequence: number,
  recordIndex: number,
  metadata: { providerPage: number | null; providerPageSize: number | null },
): RawImpactAdV2 {
  const dealStartDate = dateField(record, "DealStartDate");
  const dealEndDate = dateField(record, "DealEndDate");
  const startDate = dateField(record, "StartDate");
  const endDate = dateField(record, "EndDate");
  return {
    providerOfferKey: { provider: "impact", namespace: "ad", id: adId },
    campaignId: toOpaqueAdProviderIdV2(record.CampaignId),
    advertiserId: toOpaqueAdProviderIdV2(record.AdvertiserId),
    dealId: toOpaqueAdProviderIdV2(record.DealId),
    dealState: optionalImpactStringV2(record.DealState),
    // `Name` is the exact provider Ad title carrier. No identity fallback uses it.
    title: optionalImpactStringV2(record.Name),
    description: optionalImpactStringV2(record.Description),
    trackingUrl: optionalImpactStringV2(record.TrackingLink),
    landingPageUrl: optionalImpactStringV2(record.LandingPageUrl),
    dealStartDate: dealStartDate.value,
    dealEndDate: dealEndDate.value,
    startDate: startDate.value,
    endDate: endDate.value,
    dateFieldsValid: [dealStartDate, dealEndDate, startDate, endDate].every(
      (field) => field.valid,
    ),
    ...discount(record),
    structuredTerms: structuredTerms(record),
    ...validatedCouponCode(record.DealDefaultPromoCode),
    provenance: impactRecordProvenanceV2(
      fetchSequence,
      recordIndex,
      metadata,
    ),
  };
}

/** Strict root-`Ads` parser. Impact `Code` is never a coupon-code fallback. */
export class ImpactAdsPageParser {
  static parse(
    bodyText: string,
    input: { fetchSequence: number },
  ): ImpactAdsPageParseResultV2 {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    if (!isImpactRecordV2(parsed)) {
      return { ok: false, reason: "envelope_not_object" };
    }
    if (!("Ads" in parsed)) {
      return { ok: false, reason: "missing_collection" };
    }
    if (!Array.isArray(parsed.Ads)) {
      return { ok: false, reason: "collection_not_array" };
    }
    const continuation = impactContinuationV2(parsed);
    if (!continuation.ok) {
      return { ok: false, reason: "invalid_nextpageuri" };
    }

    const metadata = impactPageMetadataV2(parsed);
    const records: RawImpactAdV2[] = [];
    const quarantineReasonCounts: ImpactAdsQuarantineReasonCountsV2 = {
      malformed_record: 0,
      missing_ad_id: 0,
      missing_campaign_id: 0,
    };
    parsed.Ads.forEach((value, recordIndex) => {
      if (!isImpactRecordV2(value)) {
        quarantineReasonCounts.malformed_record += 1;
        return;
      }
      const adId = toOpaqueAdProviderIdV2(value.Id);
      if (adId === null) {
        quarantineReasonCounts.missing_ad_id += 1;
        return;
      }
      records.push(
        adOf(value, adId, input.fetchSequence, recordIndex, metadata),
      );
    });

    return {
      ok: true,
      records,
      rawRecordCount: parsed.Ads.length,
      quarantineReasonCounts,
      ...metadata,
      nextContinuationUri: continuation.value,
    };
  }
}
