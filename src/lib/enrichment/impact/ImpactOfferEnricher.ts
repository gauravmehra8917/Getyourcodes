// Impact offer enrichment: /Ads?Type=COUPON + Campaign metadata.
//
// Enriches the existing Promotions stream. It never creates, drops or
// re-identifies offers — promotion identity (PromotionIds) is untouched.

import type { DiscountType } from "@/lib/normalizers";
import type { OfferEnricher } from "../OfferEnricher";
import { ENRICHMENT_KEY, type EnrichmentStats, type OfferEnrichment, type StructuredTerms } from "../types";

type Rec = Record<string, unknown>;

const PAGE_SIZE = 200;
const MAX_PAGES = 25;

function isRec(v: unknown): v is Rec {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t && !/^(n\/a|none|null|undefined)$/i.test(t) ? t : null;
  }
  if (typeof v === "number") return String(v);
  return null;
}

function num(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : null;
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function first(raw: Rec, keys: string[]): unknown {
  for (const k of keys) if (raw[k] != null && raw[k] !== "") return raw[k];
  return null;
}

function iso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter((x): x is string => !!x);
  const s = str(v);
  if (!s) return [];
  return s
    .split(/[,;|]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function normKey(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Currency code from an explicit field or a symbol in the text. */
function currencyOf(raw: Rec, text: string): string | null {
  const explicit = str(
    first(raw, [
      "MinimumPurchaseAmountCurrency",
      "MaximumSavingsCurrency",
      "DiscountCurrency",
      "Currency",
      "CurrencyCode",
      "PayoutCurrency",
    ]),
  );
  if (explicit) return explicit.toUpperCase().slice(0, 3);
  if (/\$/.test(text)) return "USD";
  if (/£/.test(text)) return "GBP";
  if (/€/.test(text)) return "EUR";
  if (/₹/.test(text)) return "INR";
  return null;
}

function discountOf(raw: Rec, text: string): { type: DiscountType | null; value: number | null } {
  const pct = num(first(raw, ["DiscountPercent", "PercentOff", "Percentage"]));
  if (pct !== null) return { type: "percentage", value: pct };
  const amt = num(first(raw, ["DiscountAmount", "AmountOff", "FlatAmount"]));
  if (amt !== null) return { type: "fixed", value: amt };

  const t = text.toLowerCase();
  if (/free\s*ship/.test(t)) return { type: "free_shipping", value: null };
  if (/bogo|buy one|buy 1/.test(t)) return { type: "bogo", value: null };
  const p = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (p) return { type: "percentage", value: Number(p[1]) };
  const a = t.match(/[$£€₹]\s*(\d+(?:\.\d+)?)/);
  if (a) return { type: "fixed", value: Number(a[1]) };
  return { type: null, value: null };
}

/** "ENTIRE_STORE" → "Entire store". Provider vocabulary only, never invented. */
function prettyScope(value: string | null): string | null {
  if (!value) return null;
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

/** Structured terms parsed from Impact's own terms/description text + fields. */
function termsOf(raw: Rec, text: string): StructuredTerms | null {
  const explicitText = str(
    first(raw, ["Terms", "TermsAndConditions", "Restrictions", "FinePrint", "TermsConditions"]),
  );
  const source = `${explicitText ?? ""} ${text}`.trim();

  // Impact /Ads?Type=COUPON deal fields take precedence over text parsing.
  const minField = num(
    first(raw, ["MinimumPurchaseAmount", "MinimumPurchase", "MinPurchase", "MinimumOrderValue", "Threshold"]),
  );
  const maxField = num(
    first(raw, ["MaximumSavingsAmount", "MaximumSavings", "MaxDiscount", "MaximumDiscount", "MaxSavings"]),
  );
  const limitRaw = num(
    first(raw, ["PurchaseLimitQuantity", "PurchaseLimit", "UsageLimit", "RedemptionLimit", "MaxUses"]),
  );
  // Impact sends 0 for "no limit".
  const limitField = limitRaw && limitRaw > 0 ? limitRaw : null;
  const scopeField = prettyScope(
    str(first(raw, ["DealScope", "Scope", "AppliesTo", "PromotionScope", "Applicability"])),
  );

  const minMatch = source.match(/(?:min(?:imum)?(?:\s+(?:purchase|order|spend))?|orders?\s+over|spend)\D{0,12}([\d.,]+)/i);
  const maxMatch = source.match(/(?:max(?:imum)?\s+(?:savings?|discount)|up\s+to)\D{0,12}([\d.,]+)/i);
  const limitMatch = source.match(/(?:limit(?:ed)?(?:\s+to)?|max(?:imum)?)\s+(\d+)\s+(?:use|order|redemption|purchase)/i);

  let scope = scopeField;
  if (!scope) {
    if (/new\s+customers?\s+only/i.test(source)) scope = "new customers only";
    else if (/(sitewide|site-wide|entire\s+(?:site|order))/i.test(source)) scope = "sitewide";
    else if (/select(?:ed)?\s+(?:items|products|styles)/i.test(source)) scope = "select items";
    else if (/first\s+order/i.test(source)) scope = "first order";
  }

  const terms: StructuredTerms = {
    minimumPurchase: minField ?? (minMatch ? num(minMatch[1]) : null),
    maximumSavings: maxField ?? (maxMatch ? num(maxMatch[1]) : null),
    purchaseLimit: limitField ?? (limitMatch ? num(limitMatch[1]) : null),
    scope: scope ?? null,
    currency: currencyOf(raw, source),
    text: explicitText,
  };

  const hasAny = Object.values(terms).some((v) => v !== null && v !== undefined);
  return hasAny ? terms : null;
}


export interface ImpactEnrichmentSources {
  /** Fetch one page of coupon ads. */
  fetchAds(page: number, pageSize: number): Promise<unknown[] | null>;
  /** Fetch one page of campaigns. */
  fetchCampaigns(page: number, pageSize: number): Promise<unknown[] | null>;
}

interface CampaignInfo {
  advertiserName: string | null;
  country: string | null;
  trackingLink: string | null;
  landingPageUrl: string | null;
  deeplinkDomains: string[];
  currency: string | null;
  shippingRegions: string[];
}

export class ImpactOfferEnricher implements OfferEnricher {
  readonly provider = "impact";

  private loaded = false;
  private adsById = new Map<string, Rec>();
  private adsByCampaignTitle = new Map<string, Rec>();
  private adsByCampaign = new Map<string, Rec[]>();
  // Impact promotions carry no CampaignId, only AdvertiserId — index both.
  private adsByAdvertiserTitle = new Map<string, Rec>();
  private adsByAdvertiserCode = new Map<string, Rec>();
  private adsByAdvertiser = new Map<string, Rec[]>();
  private campaigns = new Map<string, CampaignInfo>();
  private counters: EnrichmentStats = { offers: 0, enriched: 0, adRecords: 0, campaignRecords: 0 };

  constructor(private readonly sources: ImpactEnrichmentSources) {}

  stats(): EnrichmentStats {
    return { ...this.counters };
  }

  private async loadAll(
    fetchPage: (page: number, pageSize: number) => Promise<unknown[] | null>,
  ): Promise<Rec[]> {
    const out: Rec[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      let records: unknown[] | null = null;
      try {
        records = await fetchPage(page, PAGE_SIZE);
      } catch {
        break;
      }
      if (!records || records.length === 0) break;
      out.push(...records.filter(isRec));
      if (records.length < PAGE_SIZE) break;
    }
    return out;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const [ads, campaigns] = await Promise.all([
      this.loadAll((p, s) => this.sources.fetchAds(p, s)),
      this.loadAll((p, s) => this.sources.fetchCampaigns(p, s)),
    ]);

    this.counters.adRecords = ads.length;
    this.counters.campaignRecords = campaigns.length;

    for (const ad of ads) {
      const promoId = str(first(ad, ["PromotionIds", "PromotionId", "Promotion"]));
      if (promoId) this.adsById.set(promoId, ad);

      const campaignId = str(first(ad, ["CampaignId", "ProgramId"]));
      const advertiserId = str(first(ad, ["AdvertiserId"]));
      const title = str(first(ad, ["Name", "DealName", "AdName", "Title", "Description"]));
      const code = str(first(ad, ["Code", "DealDefaultPromoCode", "CouponCode", "PromoCode"]));
      if (campaignId) {
        const list = this.adsByCampaign.get(campaignId) ?? [];
        list.push(ad);
        this.adsByCampaign.set(campaignId, list);
        if (title) this.adsByCampaignTitle.set(`${campaignId}::${normKey(title)}`, ad);
      }
      if (advertiserId) {
        const list = this.adsByAdvertiser.get(advertiserId) ?? [];
        list.push(ad);
        this.adsByAdvertiser.set(advertiserId, list);
        if (title && !this.adsByAdvertiserTitle.has(`${advertiserId}::${normKey(title)}`)) {
          this.adsByAdvertiserTitle.set(`${advertiserId}::${normKey(title)}`, ad);
        }
        if (code && !this.adsByAdvertiserCode.has(`${advertiserId}::${normKey(code)}`)) {
          this.adsByAdvertiserCode.set(`${advertiserId}::${normKey(code)}`, ad);
        }
      }
    }


    for (const c of campaigns) {
      const trackingLink = str(first(c, ["TrackingLink", "TrackingUrl"]));
      const landing = str(first(c, ["CampaignUrl", "AdvertiserUrl", "LandingPageUrl", "Url"]));
      const domains = new Set<string>(strList(first(c, ["DeeplinkDomains", "AllowedDeeplinkDomains"])));
      const landingDomain = domainOf(landing);
      if (landingDomain) domains.add(landingDomain);

      const info: CampaignInfo = {
        advertiserName: str(first(c, ["AdvertiserName", "CampaignName", "Name"])),
        country: str(first(c, ["Country", "CountryCode", "AdvertiserCountry"])),
        trackingLink,
        landingPageUrl: landing,
        deeplinkDomains: [...domains],
        currency: str(first(c, ["Currency", "CurrencyCode", "PayoutCurrency"])),
        shippingRegions: strList(
          first(c, ["ShippingRegions", "ShipsTo", "ShippingCountries", "AllowedCountries", "Geos"]),
        ),
      };

      for (const key of [
        str(first(c, ["CampaignId", "ProgramId", "Id"])),
        str(first(c, ["AdvertiserId"])),
      ]) {
        if (key) this.campaigns.set(key, info);
      }
    }
  }

  /** Find the coupon ad that corresponds to this promotion, if any. */
  private matchAd(promo: Rec): { ad: Rec; matchedBy: string } | null {
    const promoId = str(first(promo, ["PromotionIds", "PromotionId", "Id"]));
    if (promoId) {
      const byId = this.adsById.get(promoId);
      if (byId) return { ad: byId, matchedBy: "promotion id" };
    }

    const campaignId = str(first(promo, ["CampaignId", "ProgramId"]));
    const title = str(first(promo, ["PromotionTitle", "Name", "Title"]));
    if (campaignId && title) {
      const byTitle = this.adsByCampaignTitle.get(`${campaignId}::${normKey(title)}`);
      if (byTitle) return { ad: byTitle, matchedBy: "campaign + title" };
    }

    if (campaignId) {
      const list = this.adsByCampaign.get(campaignId) ?? [];
      if (list.length === 1) return { ad: list[0], matchedBy: "campaign (single coupon ad)" };
    }

    // Promotions expose AdvertiserId only, so advertiser-scoped matching is the
    // main path for the Impact Promotions stream.
    const advertiserId = str(first(promo, ["AdvertiserId"]));
    if (advertiserId) {
      if (title) {
        const byTitle = this.adsByAdvertiserTitle.get(`${advertiserId}::${normKey(title)}`);
        if (byTitle) return { ad: byTitle, matchedBy: "advertiser + title" };
      }
      const code = str(first(promo, ["GenericRedemptionCode", "PromoCode", "CouponCode", "Code"]));
      if (code) {
        const byCode = this.adsByAdvertiserCode.get(`${advertiserId}::${normKey(code)}`);
        if (byCode) return { ad: byCode, matchedBy: "advertiser + code" };
      }
      const list = this.adsByAdvertiser.get(advertiserId) ?? [];
      if (list.length === 1) return { ad: list[0], matchedBy: "advertiser (single coupon ad)" };
    }

    return null;

  }

  async enrichOffers(records: unknown[]): Promise<unknown[]> {
    await this.load();

    return records.map((record) => {
      if (!isRec(record)) return record;
      this.counters.offers += 1;

      const campaignId = str(first(record, ["CampaignId", "ProgramId"]));
      const advertiserId = str(first(record, ["AdvertiserId"]));
      const campaign =
        (advertiserId ? this.campaigns.get(advertiserId) : undefined) ??
        (campaignId ? this.campaigns.get(campaignId) : undefined) ??
        null;

      const matched = this.matchAd(record);
      const ad = matched?.ad ?? null;
      if (!ad && !campaign) return record;

      const adText = ad
        ? [
            str(first(ad, ["Name", "DealName", "AdName", "Title"])),
            str(first(ad, ["Description", "DealDescription", "ShortDescription", "AdDescription"])),
            str(first(ad, ["Terms", "TermsAndConditions", "Restrictions"])),
          ]
            .filter(Boolean)
            .join(" ")
        : "";

      const adTracking = ad ? str(first(ad, ["TrackingLink", "TrackingUrl", "ClickUrl"])) : null;
      const trackingUrl = adTracking ?? campaign?.trackingLink ?? null;
      const discount = ad ? discountOf(ad, adText) : { type: null, value: null };
      const landing =
        (ad ? str(first(ad, ["LandingPageUrl", "DestinationUrl", "TargetUrl", "Url"])) : null) ??
        campaign?.landingPageUrl ??
        null;

      const deeplinkDomains = new Set<string>(campaign?.deeplinkDomains ?? []);
      const landingDomain = domainOf(landing);
      if (landingDomain) deeplinkDomains.add(landingDomain);

      const enrichment: OfferEnrichment = {
        // Description priority: Ad Description → DealDescription → none.
        description: ad
          ? str(first(ad, ["Description", "DealDescription", "ShortDescription", "AdDescription"]))
          : null,
        trackingUrl,
        trackingUrlSource: adTracking ? "ad" : trackingUrl ? "campaign" : null,
        landingPageUrl: landing,
        code: ad
          ? str(first(ad, ["CouponCode", "PromoCode", "GenericRedemptionCode", "Code", "DealDefaultPromoCode"]))
          : null,

        discountType: discount.type,
        discountValue: discount.value,
        currency: (ad ? currencyOf(ad, adText) : null) ?? campaign?.currency ?? null,
        startDate: ad ? iso(first(ad, ["DealStartDate", "StartDate", "EffectiveDate", "CreationDate"])) : null,
        endDate: ad ? iso(first(ad, ["DealEndDate", "EndDate", "ExpirationDate", "ExpiryDate"])) : null,
        terms: ad ? termsOf(ad, adText) : null,
        shippingRegions:
          (ad ? strList(first(ad, ["ShippingRegions", "ShipsTo", "ShippingCountries"])) : []).length
            ? strList(first(ad!, ["ShippingRegions", "ShipsTo", "ShippingCountries"]))
            : (campaign?.shippingRegions ?? []),
        advertiserName: campaign?.advertiserName ?? null,
        country: campaign?.country ?? null,
        deeplinkDomains: [...deeplinkDomains],
        matchedBy: matched?.matchedBy ?? (campaign ? "campaign metadata only" : null),
        sourceId: ad ? str(first(ad, ["Id", "AdId"])) : null,
      };

      this.counters.enriched += 1;
      return { ...record, [ENRICHMENT_KEY]: enrichment };
    });
  }
}
