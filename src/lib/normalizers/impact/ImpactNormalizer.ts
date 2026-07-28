// Impact (impact.com) → canonical model normalizer.
//
// Campaign  → CanonicalStore
// Promotion → CanonicalCoupon (has a code) | CanonicalDeal (no code)
// Catalog   → CanonicalCategory
//
// No HTTP, no persistence. Unmapped provider fields are preserved in metadata.

import type { StandardResponse } from "@/lib/integration-engine/types";
import {
  BaseNormalizer,
  asIsoDate,
  asNumber,
  asString,
  asStringArray,
  buildMetadata,
  isRecord,
  normalizerFail,
  normalizerOk,
  pick,
  toRecordArray,
  type NormalizerContext,
} from "../Normalizer";
import type {
  CanonicalCategory,
  CanonicalCoupon,
  CanonicalDeal,
  CanonicalStatus,
  CanonicalStore,
  DiscountType,
  PromotionSplit,
} from "../types";

const PROVIDER = "impact";

function mapStatus(v: unknown): CanonicalStatus {
  const s = (asString(v) ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/(^|_)(active|approved|joined|live|running)/.test(s)) return "active";
  if (/expire/.test(s)) return "expired";
  if (/pending|review|applied/.test(s)) return "pending";
  if (/inactive|paused|ended|closed|rejected|declined|not/.test(s)) return "inactive";
  return "unknown";
}

function mapDiscountType(raw: Record<string, unknown>): { type: DiscountType; value: number | null } {
  const pct = asNumber(pick(raw, ["DiscountPercent", "PercentOff", "Percentage"]));
  if (pct !== null) return { type: "percentage", value: pct };

  const amt = asNumber(pick(raw, ["DiscountAmount", "AmountOff", "FlatAmount", "Value"]));
  if (amt !== null) return { type: "fixed", value: amt };

  const text = [
    asString(pick(raw, ["PromoType", "Type", "PromotionType", "OfferType"])),
    asString(pick(raw, ["Name", "Description"])),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/free\s*ship/.test(text)) return { type: "free_shipping", value: null };
  if (/bogo|buy one|buy 1/.test(text)) return { type: "bogo", value: null };

  const pctInText = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctInText) return { type: "percentage", value: Number(pctInText[1]) };

  const amtInText = text.match(/[$£€]\s*(\d+(?:\.\d+)?)/);
  if (amtInText) return { type: "fixed", value: Number(amtInText[1]) };

  return { type: text ? "other" : "unknown", value: null };
}

/**
 * Logo values from Impact can be absolute, protocol-relative (//cdn/...) or junk.
 * Returns a valid absolute https/http URL, or null (never fatal).
 */
export function normalizeLogoUrl(value: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}


function promoCode(raw: Record<string, unknown>): string | null {
  return asString(
    pick(raw, ["GenericRedemptionCode", "PromoCode", "CouponCode", "Code", "DiscountCode", "Coupon"]),
  );
}

/** Impact returns "2026-07-28/2026-07-29" style ranges in PromotionEffectiveDates. */
export function parseEffectiveDates(value: unknown): { start: string | null; end: string | null } {
  const raw = asString(value);
  if (!raw) return { start: null, end: null };
  const [a, b] = raw.split("/").map((p) => p.trim());
  return { start: asIsoDate(a), end: asIsoDate(b ?? null) };
}

/** Resolve a promotion tracking url with a documented fallback order. */
function resolveTrackingUrl(
  raw: Record<string, unknown>,
  ctx: NormalizerContext | undefined,
  advertiserId: string | null,
  campaignId: string | null,
): { url: string | null; warning: string | null } {
  const direct = asString(pick(raw, ["TrackingLink", "TrackingUrl", "LandingPageUrl", "Url", "ClickUrl"]));
  if (direct) return { url: direct, warning: null };

  const map = ctx?.storeTrackingUrls ?? {};
  const fromStore =
    (advertiserId ? map[advertiserId] : undefined) ??
    (campaignId ? map[campaignId] : undefined) ??
    (ctx?.providerStoreId ? map[ctx.providerStoreId] : undefined) ??
    null;
  if (fromStore) return { url: fromStore, warning: "tracking url fell back to the campaign tracking link" };

  const uri = asString(pick(raw, ["Uri", "PromotionItemsUri"]));
  if (uri && /^https?:\/\//i.test(uri)) {
    return { url: uri, warning: "tracking url fell back to the promotion uri" };
  }

  return { url: null, warning: "no tracking url available for this promotion" };
}

/** Classification rule: a promotion with a usable code is a coupon. */
export function isCouponPromotion(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const code = promoCode(raw);
  if (!code) return false;
  return !/^(n\/a|none|no code|null)$/i.test(code);
}

export class ImpactNormalizer extends BaseNormalizer {
  readonly provider = PROVIDER;

  // ── Campaign → Store ─────────────────────────────────────────────────────
  normalizeStore(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalStore> {
    if (!isRecord(raw)) return normalizerFail(PROVIDER, "Store record is not an object", 0, ctx?.integrationId);

    const id = asString(pick(raw, ["CampaignId", "Id", "AdvertiserId", "ProgramId"]));
    const name = asString(pick(raw, ["CampaignName", "Name", "AdvertiserName"]));
    if (!id) return normalizerFail(PROVIDER, "Store record is missing CampaignId/Id", 0, ctx?.integrationId);
    if (!name) return normalizerFail(PROVIDER, `Store ${id} is missing a name`, 0, ctx?.integrationId);

    const consumed = [
      "CampaignId", "Id", "AdvertiserId", "ProgramId",
      "CampaignName", "Name", "AdvertiserName",
      "CampaignDescription", "Description",
      "CampaignUrl", "Url", "AdvertiserUrl", "LandingPageUrl",
      "CampaignLogoUri", "LogoUri", "Logo", "ImageUrl",
      "Categories", "Category", "Vertical", "Verticals",
      "Country", "CountryCode", "AdvertiserCountry",
      "ContractStatus", "Status", "State",
      "ContractCommission", "PayoutType", "Commission", "DefaultPayout",
    ];

    const rawLogo = asString(pick(raw, ["CampaignLogoUri", "LogoUri", "Logo", "ImageUrl"]));
    const logo = normalizeLogoUrl(rawLogo);

    const store: CanonicalStore = {
      provider: PROVIDER,
      providerStoreId: id,
      name,
      description: asString(pick(raw, ["CampaignDescription", "Description"])),
      website: asString(pick(raw, ["CampaignUrl", "Url", "AdvertiserUrl", "LandingPageUrl"])),
      logo,
      categories: asStringArray(pick(raw, ["Categories", "Category", "Vertical", "Verticals"])),
      country: asString(pick(raw, ["Country", "CountryCode", "AdvertiserCountry"])),
      status: mapStatus(pick(raw, ["ContractStatus", "Status", "State"])),
      commission: asString(pick(raw, ["ContractCommission", "PayoutType", "Commission", "DefaultPayout"])),
      metadata: {
        ...buildMetadata(raw, consumed),
        ...(rawLogo ? { originalLogo: rawLogo } : {}),
        ...(rawLogo && !logo ? { logoWarning: "logo could not be resolved to an absolute http(s) url" } : {}),
      },
    };

    return normalizerOk(PROVIDER, store, 0, ctx?.integrationId);
  }

  // ── Promotion → Coupon ───────────────────────────────────────────────────
  normalizeCoupon(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalCoupon> {
    if (!isRecord(raw)) return normalizerFail(PROVIDER, "Coupon record is not an object", 0, ctx?.integrationId);

    const id = asString(pick(raw, ["Id", "PromotionId", "AdId"]));
    const title = asString(pick(raw, ["Name", "Title", "Description"]));
    if (!id) return normalizerFail(PROVIDER, "Coupon record is missing Id", 0, ctx?.integrationId);
    if (!title) return normalizerFail(PROVIDER, `Coupon ${id} is missing a title`, 0, ctx?.integrationId);

    const { type, value } = mapDiscountType(raw);
    const consumed = [
      "Id", "PromotionId", "AdId",
      "CampaignId", "AdvertiserId", "ProgramId",
      "Name", "Title", "Description", "ShortDescription",
      "PromoCode", "CouponCode", "Code", "DiscountCode", "Coupon",
      "DiscountPercent", "PercentOff", "Percentage",
      "DiscountAmount", "AmountOff", "FlatAmount", "Value",
      "StartDate", "CreationDate", "EffectiveDate",
      "EndDate", "ExpirationDate", "ExpiryDate",
      "TrackingLink", "LandingPageUrl", "Url", "ClickUrl",
      "Terms", "TermsAndConditions", "Restrictions",
      "State", "Status",
    ];

    const coupon: CanonicalCoupon = {
      provider: PROVIDER,
      providerCouponId: id,
      providerStoreId:
        asString(pick(raw, ["CampaignId", "AdvertiserId", "ProgramId"])) ?? ctx?.providerStoreId ?? null,
      title,
      description: asString(pick(raw, ["Description", "ShortDescription"])),
      code: promoCode(raw),
      discountType: type,
      discountValue: value,
      startDate: asIsoDate(pick(raw, ["StartDate", "CreationDate", "EffectiveDate"])),
      endDate: asIsoDate(pick(raw, ["EndDate", "ExpirationDate", "ExpiryDate"])),
      trackingUrl: asString(pick(raw, ["TrackingLink", "LandingPageUrl", "Url", "ClickUrl"])),
      terms: asString(pick(raw, ["Terms", "TermsAndConditions", "Restrictions"])),
      status: mapStatus(pick(raw, ["State", "Status"])),
      metadata: buildMetadata(raw, consumed),
    };

    return normalizerOk(PROVIDER, coupon, 0, ctx?.integrationId);
  }

  // ── Promotion → Deal ─────────────────────────────────────────────────────
  normalizeDeal(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalDeal> {
    if (!isRecord(raw)) return normalizerFail(PROVIDER, "Deal record is not an object", 0, ctx?.integrationId);

    const id = asString(pick(raw, ["Id", "PromotionId", "AdId"]));
    const title = asString(pick(raw, ["Name", "Title", "Description"]));
    if (!id) return normalizerFail(PROVIDER, "Deal record is missing Id", 0, ctx?.integrationId);
    if (!title) return normalizerFail(PROVIDER, `Deal ${id} is missing a title`, 0, ctx?.integrationId);

    const consumed = [
      "Id", "PromotionId", "AdId",
      "CampaignId", "AdvertiserId", "ProgramId",
      "Name", "Title", "Description", "ShortDescription",
      "TrackingLink", "LandingPageUrl", "Url", "ClickUrl",
      "StartDate", "CreationDate", "EffectiveDate",
      "EndDate", "ExpirationDate", "ExpiryDate",
      "State", "Status",
    ];

    const deal: CanonicalDeal = {
      provider: PROVIDER,
      providerDealId: id,
      providerStoreId:
        asString(pick(raw, ["CampaignId", "AdvertiserId", "ProgramId"])) ?? ctx?.providerStoreId ?? null,
      title,
      description: asString(pick(raw, ["Description", "ShortDescription"])),
      trackingUrl: asString(pick(raw, ["TrackingLink", "LandingPageUrl", "Url", "ClickUrl"])),
      startDate: asIsoDate(pick(raw, ["StartDate", "CreationDate", "EffectiveDate"])),
      endDate: asIsoDate(pick(raw, ["EndDate", "ExpirationDate", "ExpiryDate"])),
      status: mapStatus(pick(raw, ["State", "Status"])),
      metadata: buildMetadata(raw, consumed),
    };

    return normalizerOk(PROVIDER, deal, 0, ctx?.integrationId);
  }

  // ── Catalog → Category ───────────────────────────────────────────────────
  normalizeCategory(raw: unknown, ctx?: NormalizerContext): StandardResponse<CanonicalCategory> {
    if (!isRecord(raw)) return normalizerFail(PROVIDER, "Category record is not an object", 0, ctx?.integrationId);

    const id = asString(pick(raw, ["Id", "CatalogId", "CategoryId"]));
    const name = asString(pick(raw, ["Name", "CatalogName", "CategoryName"]));
    if (!id) return normalizerFail(PROVIDER, "Category record is missing Id", 0, ctx?.integrationId);
    if (!name) return normalizerFail(PROVIDER, `Category ${id} is missing a name`, 0, ctx?.integrationId);

    const consumed = [
      "Id", "CatalogId", "CategoryId",
      "Name", "CatalogName", "CategoryName",
      "ParentId", "ParentCategoryId", "CampaignId",
    ];

    const category: CanonicalCategory = {
      provider: PROVIDER,
      providerCategoryId: id,
      name,
      parentId: asString(pick(raw, ["ParentId", "ParentCategoryId", "CampaignId"])),
      metadata: buildMetadata(raw, consumed),
    };

    return normalizerOk(PROVIDER, category, 0, ctx?.integrationId);
  }

  /**
   * Impact returns coupons and deals in one Promotions collection.
   * Splits the batch by the code-presence rule and normalizes each side.
   */
  normalizePromotions(raw: unknown, ctx?: NormalizerContext): StandardResponse<PromotionSplit> {
    const started = Date.now();
    const records = toRecordArray(raw);
    const couponRaw = records.filter((r) => isCouponPromotion(r));
    const dealRaw = records.filter((r) => !isCouponPromotion(r));

    const coupons = this.normalizeCoupons(couponRaw, ctx);
    const deals = this.normalizeDeals(dealRaw, ctx);

    return normalizerOk<PromotionSplit>(
      PROVIDER,
      {
        coupons: coupons.body?.items ?? [],
        deals: deals.body?.items ?? [],
      },
      Date.now() - started,
      ctx?.integrationId,
    );
  }
}
