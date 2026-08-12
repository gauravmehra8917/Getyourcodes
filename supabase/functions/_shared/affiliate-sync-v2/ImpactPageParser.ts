import type {
  ImpactPageProvenanceV2,
  ImpactRecordProvenanceV2,
  QuarantinedImpactRecordV2,
} from "./diagnostics.ts";
import type { RawImpactCampaignV2, RawImpactPromotionV2 } from "./models.ts";
import { toOpaqueProviderId } from "./models.ts";

type ImpactEnvelope = Record<string, unknown>;

export interface ImpactPaginationMetadataV2 {
  page: string | null;
  pageSize: string | null;
  total: string | null;
  numPages: string | null;
  uri: string | null;
}

export interface ImpactPageParseFailureV2 {
  ok: false;
  code: "malformed_page";
  detail: string;
}

export interface ParsedImpactPageV2<T> {
  ok: true;
  stream: "promotions" | "campaigns";
  records: T[];
  quarantinedRecords: QuarantinedImpactRecordV2[];
  rawRecordCount: number;
  pagination: ImpactPaginationMetadataV2;
  /**
   * Used only by the immediately following client continuation decision. It is
   * never copied to provenance or diagnostics because it may contain opaque
   * provider values.
   */
  nextContinuationUri: string | null;
}

export type ImpactPageParseResultV2<T> = ParsedImpactPageV2<T> | ImpactPageParseFailureV2;

export interface ImpactPageParserInputV2 {
  provenance: ImpactPageProvenanceV2;
}

function isRecord(value: unknown): value is ImpactEnvelope {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function valueAt(record: ImpactEnvelope, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = optionalText(record[field]);
    if (value) return value;
  }
  return null;
}

function paginationOf(envelope: ImpactEnvelope): ImpactPaginationMetadataV2 {
  return {
    page: optionalText(envelope["@page"]),
    pageSize: optionalText(envelope["@pagesize"]),
    total: optionalText(envelope["@total"]),
    numPages: optionalText(envelope["@numpages"]),
    uri: optionalText(envelope["@uri"]),
  };
}

function nextContinuationOf(envelope: ImpactEnvelope): string | null {
  if (!("@nextpageuri" in envelope)) return null;
  const value = envelope["@nextpageuri"];
  return typeof value === "string" ? value.trim() : null;
}

function recordProvenance(
  page: ImpactPageProvenanceV2,
  recordIndex: number,
): ImpactRecordProvenanceV2 {
  return { ...page, recordIndex };
}

function parseEnvelope(
  bodyText: string,
  collectionName: "Promotions" | "Campaigns",
): { envelope: ImpactEnvelope; records: unknown[] } | ImpactPageParseFailureV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { ok: false, code: "malformed_page", detail: "Impact response is not valid JSON" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, code: "malformed_page", detail: "Impact response envelope is not an object" };
  }
  if (!(collectionName in parsed)) {
    return { ok: false, code: "malformed_page", detail: `Impact response is missing ${collectionName}` };
  }
  if (!Array.isArray(parsed[collectionName])) {
    return { ok: false, code: "malformed_page", detail: `Impact response ${collectionName} is not an array` };
  }
  return { envelope: parsed, records: parsed[collectionName] as unknown[] };
}

function promotionOf(
  record: ImpactEnvelope,
  provenance: ImpactRecordProvenanceV2,
): RawImpactPromotionV2 {
  return {
    promotionId: toOpaqueProviderId(record.PromotionIds),
    advertiserId: toOpaqueProviderId(record.AdvertiserId),
    advertiserName: optionalText(record.AdvertiserName),
    campaignId: toOpaqueProviderId(record.CampaignId),
    programId: toOpaqueProviderId(record.ProgramId),
    raw: record,
    provenance,
  };
}

function campaignOf(
  record: ImpactEnvelope,
  provenance: ImpactRecordProvenanceV2,
): RawImpactCampaignV2 {
  return {
    campaignId: toOpaqueProviderId(record.CampaignId),
    advertiserId: toOpaqueProviderId(record.AdvertiserId),
    campaignName: valueAt(record, ["CampaignName", "Name", "AdvertiserName"]),
    destinationUrl: valueAt(record, ["CampaignUrl", "AdvertiserUrl", "LandingPageUrl", "Url"]),
    trackingUrl: valueAt(record, ["TrackingLink", "TrackingUrl"]),
    raw: record,
    provenance,
  };
}

function parseRecords<T>(input: {
  stream: "promotions" | "campaigns";
  records: unknown[];
  pageProvenance: ImpactPageProvenanceV2;
  identity: (record: ImpactEnvelope, provenance: ImpactRecordProvenanceV2) => T;
  hasIdentity: (record: T) => boolean;
  missingIdentityReason: "missing_promotion_id" | "missing_campaign_id";
}): { records: T[]; quarantinedRecords: QuarantinedImpactRecordV2[] } {
  const records: T[] = [];
  const quarantinedRecords: QuarantinedImpactRecordV2[] = [];
  input.records.forEach((value, recordIndex) => {
    const provenance = recordProvenance(input.pageProvenance, recordIndex);
    if (!isRecord(value)) {
      quarantinedRecords.push({ stream: input.stream, reason: "malformed_record", provenance });
      return;
    }
    const record = input.identity(value, provenance);
    if (!input.hasIdentity(record)) {
      quarantinedRecords.push({ stream: input.stream, reason: input.missingIdentityReason, provenance });
      return;
    }
    records.push(record);
  });
  return { records, quarantinedRecords };
}

export class ImpactPageParser {
  static promotions(
    bodyText: string,
    input: ImpactPageParserInputV2,
  ): ImpactPageParseResultV2<RawImpactPromotionV2> {
    const parsed = parseEnvelope(bodyText, "Promotions");
    if ("ok" in parsed) return parsed;
    if ("@nextpageuri" in parsed.envelope && !nextContinuationOf(parsed.envelope)) {
      return { ok: false, code: "malformed_page", detail: "Impact response @nextpageuri is not a nonempty string" };
    }
    const pagination = paginationOf(parsed.envelope);
    const records = parseRecords({
      stream: "promotions",
      records: parsed.records,
      pageProvenance: {
        ...input.provenance,
        providerPage: pagination.page,
        providerPageSize: pagination.pageSize,
      },
      identity: promotionOf,
      hasIdentity: (record) => record.promotionId !== null,
      missingIdentityReason: "missing_promotion_id",
    });
    return {
      ok: true,
      stream: "promotions",
      ...records,
      rawRecordCount: parsed.records.length,
      pagination,
      nextContinuationUri: nextContinuationOf(parsed.envelope),
    };
  }

  static campaigns(
    bodyText: string,
    input: ImpactPageParserInputV2,
  ): ImpactPageParseResultV2<RawImpactCampaignV2> {
    const parsed = parseEnvelope(bodyText, "Campaigns");
    if ("ok" in parsed) return parsed;
    if ("@nextpageuri" in parsed.envelope && !nextContinuationOf(parsed.envelope)) {
      return { ok: false, code: "malformed_page", detail: "Impact response @nextpageuri is not a nonempty string" };
    }
    const pagination = paginationOf(parsed.envelope);
    const records = parseRecords({
      stream: "campaigns",
      records: parsed.records,
      pageProvenance: {
        ...input.provenance,
        providerPage: pagination.page,
        providerPageSize: pagination.pageSize,
      },
      identity: campaignOf,
      hasIdentity: (record) => record.campaignId !== null,
      missingIdentityReason: "missing_campaign_id",
    });
    return {
      ok: true,
      stream: "campaigns",
      ...records,
      rawRecordCount: parsed.records.length,
      pagination,
      nextContinuationUri: nextContinuationOf(parsed.envelope),
    };
  }
}
