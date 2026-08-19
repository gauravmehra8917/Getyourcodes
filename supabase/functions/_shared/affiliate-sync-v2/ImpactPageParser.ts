import type {
  ImpactParseFailureReasonV2,
  ImpactPageProvenanceV2,
  ImpactPromotionIdentifierCarrierDiagnosticsV2,
  ImpactPromotionIdentityEquivalenceDiagnosticsV2,
  ImpactPromotionIdShapeCountsV2,
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
  reason: ImpactParseFailureReasonV2;
  detail: string;
}

export interface ParsedImpactPageV2<T> {
  ok: true;
  stream: "promotions" | "campaigns";
  records: T[];
  quarantinedRecords: QuarantinedImpactRecordV2[];
  rawRecordCount: number;
  /** Count-only raw PromotionIds shapes; null for Campaign pages. */
  promotionIdShapeCounts: ImpactPromotionIdShapeCountsV2 | null;
  /** Count-only observations of the fixed Promotions-only candidate set. */
  promotionIdentifierCarrierDiagnostics: ImpactPromotionIdentifierCarrierDiagnosticsV2 | null;
  /** Internal-only exact values needed to aggregate distinct counts across pages. */
  promotionIdentifierCarrierDistinctValues: ImpactPromotionIdentifierCarrierDistinctValuesV2 | null;
  /** Count-only comparison of singular PromotionId with retrieval-Uri terminal. */
  promotionIdentityEquivalenceDiagnostics: ImpactPromotionIdentityEquivalenceDiagnosticsV2 | null;
  /** Internal-only relations needed to aggregate mapping counts across pages. */
  promotionIdentityEquivalenceRelations: ImpactPromotionIdentityEquivalenceRelationsV2 | null;
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

export interface ImpactPromotionIdentifierCarrierDistinctValuesV2 {
  promotionFileId: ReadonlySet<string>;
  uri: ReadonlySet<string>;
  promotionIdSingular: ReadonlySet<string>;
  id: ReadonlySet<string>;
  promotionRetrieveTerminalSegments: ReadonlySet<string>;
}

interface MutablePromotionIdentifierCarrierDistinctValuesV2 {
  promotionFileId: Set<string>;
  uri: Set<string>;
  promotionIdSingular: Set<string>;
  id: Set<string>;
  promotionRetrieveTerminalSegments: Set<string>;
}

export interface ImpactPromotionIdentityEquivalenceRelationsV2 {
  promotionIds: ReadonlySet<string>;
  retrieveUriTerminalSegments: ReadonlySet<string>;
  promotionIdToUriTerminals: ReadonlyMap<string, ReadonlySet<string>>;
  uriTerminalToPromotionIds: ReadonlyMap<string, ReadonlySet<string>>;
}

interface MutablePromotionIdentityEquivalenceRelationsV2 {
  promotionIds: Set<string>;
  retrieveUriTerminalSegments: Set<string>;
  promotionIdToUriTerminals: Map<string, Set<string>>;
  uriTerminalToPromotionIds: Map<string, Set<string>>;
}

function isRecord(value: unknown): value is ImpactEnvelope {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function emptyPromotionIdShapeCounts(): ImpactPromotionIdShapeCountsV2 {
  return {
    missing: 0,
    null: 0,
    nonempty_string: 0,
    empty_or_whitespace_string: 0,
    number: 0,
    array: 0,
    object: 0,
    boolean: 0,
    other: 0,
  };
}

function emptyOpaqueScalarCarrierDiagnostics() {
  return {
    missing: 0,
    null: 0,
    validOpaqueScalar: 0,
    invalidShape: 0,
    distinctValidOpaqueValues: 0,
  };
}

function emptyPromotionIdentifierCarrierDiagnostics(): ImpactPromotionIdentifierCarrierDiagnosticsV2 {
  return {
    promotionFileId: emptyOpaqueScalarCarrierDiagnostics(),
    uri: {
      missing: 0,
      null: 0,
      nonemptyString: 0,
      invalidShape: 0,
      distinctNonemptyValues: 0,
      promotionRetrievePathShape: 0,
      distinctPromotionRetrieveTerminalSegments: 0,
    },
    promotionIdSingular: emptyOpaqueScalarCarrierDiagnostics(),
    id: emptyOpaqueScalarCarrierDiagnostics(),
  };
}

function emptyPromotionIdentifierCarrierDistinctValues(): MutablePromotionIdentifierCarrierDistinctValuesV2 {
  return {
    promotionFileId: new Set<string>(),
    uri: new Set<string>(),
    promotionIdSingular: new Set<string>(),
    id: new Set<string>(),
    promotionRetrieveTerminalSegments: new Set<string>(),
  };
}

function emptyPromotionIdentityEquivalenceDiagnostics(): ImpactPromotionIdentityEquivalenceDiagnosticsV2 {
  return {
    structurallyValidPromotionRecords: 0,
    promotionIdAndRetrieveUriPresent: 0,
    exactPromotionIdEqualsUriTerminal: 0,
    promotionIdDiffersFromUriTerminal: 0,
    promotionIdPresentWithoutRetrieveUri: 0,
    retrieveUriPresentWithoutPromotionId: 0,
    neitherPresent: 0,
    distinctPromotionIds: 0,
    distinctRetrieveUriTerminalSegments: 0,
    promotionIdsMappingToMultipleUriTerminals: 0,
    uriTerminalsMappingToMultiplePromotionIds: 0,
    duplicatePromotionIdRecords: 0,
  };
}

function emptyPromotionIdentityEquivalenceRelations(): MutablePromotionIdentityEquivalenceRelationsV2 {
  return {
    promotionIds: new Set<string>(),
    retrieveUriTerminalSegments: new Set<string>(),
    promotionIdToUriTerminals: new Map<string, Set<string>>(),
    uriTerminalToPromotionIds: new Map<string, Set<string>>(),
  };
}

function observeOpaqueScalarCarrier(
  record: ImpactEnvelope,
  property: "PromotionFileId" | "PromotionId" | "Id",
  diagnostics: ReturnType<typeof emptyOpaqueScalarCarrierDiagnostics>,
  distinctValues: Set<string>,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(record, property)) {
    diagnostics.missing += 1;
    return null;
  }
  const value = record[property];
  if (value === null) {
    diagnostics.null += 1;
    return null;
  }
  const opaque = toOpaqueProviderId(value);
  if (opaque === null) {
    diagnostics.invalidShape += 1;
    return null;
  }
  diagnostics.validOpaqueScalar += 1;
  distinctValues.add(opaque);
  diagnostics.distinctValidOpaqueValues = distinctValues.size;
  return opaque;
}

function promotionRetrieveTerminalSegment(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim(), "https://impact-diagnostic.invalid/");
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/");
  if (segments.length < 4) return null;
  const terminal = segments.at(-1) ?? "";
  const promotions = segments.at(-2) ?? "";
  const account = segments.at(-3) ?? "";
  const mediaPartners = segments.at(-4) ?? "";
  if (
    mediaPartners !== "Mediapartners" ||
    !account ||
    promotions !== "Promotions" ||
    !terminal
  ) return null;
  return terminal;
}

function observeUriCarrier(
  record: ImpactEnvelope,
  diagnostics: ImpactPromotionIdentifierCarrierDiagnosticsV2["uri"],
  distinctValues: MutablePromotionIdentifierCarrierDistinctValuesV2,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(record, "Uri")) {
    diagnostics.missing += 1;
    return null;
  }
  const value = record.Uri;
  if (value === null) {
    diagnostics.null += 1;
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    diagnostics.invalidShape += 1;
    return null;
  }
  diagnostics.nonemptyString += 1;
  distinctValues.uri.add(value);
  diagnostics.distinctNonemptyValues = distinctValues.uri.size;
  const terminal = promotionRetrieveTerminalSegment(value);
  if (terminal === null) return null;
  diagnostics.promotionRetrievePathShape += 1;
  distinctValues.promotionRetrieveTerminalSegments.add(terminal);
  diagnostics.distinctPromotionRetrieveTerminalSegments =
    distinctValues.promotionRetrieveTerminalSegments.size;
  return terminal;
}

function observePromotionIdentifierCarriers(
  record: ImpactEnvelope,
  diagnostics: ImpactPromotionIdentifierCarrierDiagnosticsV2,
  distinctValues: MutablePromotionIdentifierCarrierDistinctValuesV2,
): { promotionId: string | null; retrieveUriTerminal: string | null } {
  observeOpaqueScalarCarrier(
    record,
    "PromotionFileId",
    diagnostics.promotionFileId,
    distinctValues.promotionFileId,
  );
  const retrieveUriTerminal = observeUriCarrier(
    record,
    diagnostics.uri,
    distinctValues,
  );
  const promotionId = observeOpaqueScalarCarrier(
    record,
    "PromotionId",
    diagnostics.promotionIdSingular,
    distinctValues.promotionIdSingular,
  );
  observeOpaqueScalarCarrier(record, "Id", diagnostics.id, distinctValues.id);
  return { promotionId, retrieveUriTerminal };
}

function addRelation(
  relations: Map<string, Set<string>>,
  key: string,
  value: string,
): boolean {
  let values = relations.get(key);
  if (!values) {
    values = new Set<string>();
    relations.set(key, values);
  }
  const priorSize = values.size;
  values.add(value);
  return priorSize === 1 && values.size === 2;
}

function observePromotionIdentityEquivalence(
  promotionId: string | null,
  retrieveUriTerminal: string | null,
  diagnostics: ImpactPromotionIdentityEquivalenceDiagnosticsV2,
  relations: MutablePromotionIdentityEquivalenceRelationsV2,
): void {
  diagnostics.structurallyValidPromotionRecords += 1;
  if (promotionId !== null) {
    if (relations.promotionIds.has(promotionId)) {
      diagnostics.duplicatePromotionIdRecords += 1;
    }
    relations.promotionIds.add(promotionId);
    diagnostics.distinctPromotionIds = relations.promotionIds.size;
  }
  if (retrieveUriTerminal !== null) {
    relations.retrieveUriTerminalSegments.add(retrieveUriTerminal);
    diagnostics.distinctRetrieveUriTerminalSegments =
      relations.retrieveUriTerminalSegments.size;
  }
  if (promotionId !== null && retrieveUriTerminal !== null) {
    diagnostics.promotionIdAndRetrieveUriPresent += 1;
    if (promotionId === retrieveUriTerminal) {
      diagnostics.exactPromotionIdEqualsUriTerminal += 1;
    } else {
      diagnostics.promotionIdDiffersFromUriTerminal += 1;
    }
    if (
      addRelation(
        relations.promotionIdToUriTerminals,
        promotionId,
        retrieveUriTerminal,
      )
    ) diagnostics.promotionIdsMappingToMultipleUriTerminals += 1;
    if (
      addRelation(
        relations.uriTerminalToPromotionIds,
        retrieveUriTerminal,
        promotionId,
      )
    ) diagnostics.uriTerminalsMappingToMultiplePromotionIds += 1;
    return;
  }
  if (promotionId !== null) {
    diagnostics.promotionIdPresentWithoutRetrieveUri += 1;
    return;
  }
  if (retrieveUriTerminal !== null) {
    diagnostics.retrieveUriPresentWithoutPromotionId += 1;
    return;
  }
  diagnostics.neitherPresent += 1;
}

function promotionIdShape(record: ImpactEnvelope): keyof ImpactPromotionIdShapeCountsV2 {
  if (!Object.prototype.hasOwnProperty.call(record, "PromotionIds")) return "missing";
  const value = record.PromotionIds;
  if (value === null) return "null";
  if (typeof value === "string") {
    return value.trim() ? "nonempty_string" : "empty_or_whitespace_string";
  }
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "boolean") return "boolean";
  return "other";
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

type ImpactContinuationParseResultV2 =
  | { ok: true; nextContinuationUri: string | null }
  | { ok: false };

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function hasProvenTerminalPage(envelope: ImpactEnvelope): boolean {
  const page = positiveInteger(envelope["@page"]);
  const numPages = positiveInteger(envelope["@numpages"]);
  return page !== null && numPages !== null && page === numPages;
}

function continuationOf(envelope: ImpactEnvelope): ImpactContinuationParseResultV2 {
  if (!("@nextpageuri" in envelope)) return { ok: true, nextContinuationUri: null };
  const value = envelope["@nextpageuri"];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return { ok: true, nextContinuationUri: trimmed };
    return hasProvenTerminalPage(envelope)
      ? { ok: true, nextContinuationUri: null }
      : { ok: false };
  }
  if (value === null && hasProvenTerminalPage(envelope)) {
    return { ok: true, nextContinuationUri: null };
  }
  return { ok: false };
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
    return {
      ok: false,
      code: "malformed_page",
      reason: "invalid_json",
      detail: "Impact response is not valid JSON",
    };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      code: "malformed_page",
      reason: "envelope_not_object",
      detail: "Impact response envelope is not an object",
    };
  }
  if (!(collectionName in parsed)) {
    return {
      ok: false,
      code: "malformed_page",
      reason: "missing_collection",
      detail: `Impact response is missing ${collectionName}`,
    };
  }
  if (!Array.isArray(parsed[collectionName])) {
    return {
      ok: false,
      code: "malformed_page",
      reason: "collection_not_array",
      detail: `Impact response ${collectionName} is not an array`,
    };
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
    promotionTitle: optionalText(record.PromotionTitle),
    description: optionalText(record.Description),
    genericRedemptionCode: optionalText(record.GenericRedemptionCode),
    trackingUrl: optionalText(record.TrackingLink),
    startDate: optionalText(record.StartDate),
    endDate: optionalText(record.EndDate),
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
  observeRecord?: (record: ImpactEnvelope) => void;
}): { records: T[]; quarantinedRecords: QuarantinedImpactRecordV2[] } {
  const records: T[] = [];
  const quarantinedRecords: QuarantinedImpactRecordV2[] = [];
  input.records.forEach((value, recordIndex) => {
    const provenance = recordProvenance(input.pageProvenance, recordIndex);
    if (!isRecord(value)) {
      quarantinedRecords.push({ stream: input.stream, reason: "malformed_record", provenance });
      return;
    }
    input.observeRecord?.(value);
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
    const continuation = continuationOf(parsed.envelope);
    if (!continuation.ok) {
      return {
        ok: false,
        code: "malformed_page",
        reason: "invalid_nextpageuri",
        detail: "Impact response @nextpageuri is not a nonempty string",
      };
    }
    const pagination = paginationOf(parsed.envelope);
    const promotionIdShapeCounts = emptyPromotionIdShapeCounts();
    const promotionIdentifierCarrierDiagnostics = emptyPromotionIdentifierCarrierDiagnostics();
    const promotionIdentifierCarrierDistinctValues = emptyPromotionIdentifierCarrierDistinctValues();
    const promotionIdentityEquivalenceDiagnostics = emptyPromotionIdentityEquivalenceDiagnostics();
    const promotionIdentityEquivalenceRelations = emptyPromotionIdentityEquivalenceRelations();
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
      observeRecord: (record) => {
        promotionIdShapeCounts[promotionIdShape(record)] += 1;
        const carriers = observePromotionIdentifierCarriers(
          record,
          promotionIdentifierCarrierDiagnostics,
          promotionIdentifierCarrierDistinctValues,
        );
        observePromotionIdentityEquivalence(
          carriers.promotionId,
          carriers.retrieveUriTerminal,
          promotionIdentityEquivalenceDiagnostics,
          promotionIdentityEquivalenceRelations,
        );
      },
    });
    return {
      ok: true,
      stream: "promotions",
      ...records,
      rawRecordCount: parsed.records.length,
      promotionIdShapeCounts,
      promotionIdentifierCarrierDiagnostics,
      promotionIdentifierCarrierDistinctValues,
      promotionIdentityEquivalenceDiagnostics,
      promotionIdentityEquivalenceRelations,
      pagination,
      nextContinuationUri: continuation.nextContinuationUri,
    };
  }

  static campaigns(
    bodyText: string,
    input: ImpactPageParserInputV2,
  ): ImpactPageParseResultV2<RawImpactCampaignV2> {
    const parsed = parseEnvelope(bodyText, "Campaigns");
    if ("ok" in parsed) return parsed;
    const continuation = continuationOf(parsed.envelope);
    if (!continuation.ok) {
      return {
        ok: false,
        code: "malformed_page",
        reason: "invalid_nextpageuri",
        detail: "Impact response @nextpageuri is not a nonempty string",
      };
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
      promotionIdShapeCounts: null,
      promotionIdentifierCarrierDiagnostics: null,
      promotionIdentifierCarrierDistinctValues: null,
      promotionIdentityEquivalenceDiagnostics: null,
      promotionIdentityEquivalenceRelations: null,
      pagination,
      nextContinuationUri: continuation.nextContinuationUri,
    };
  }
}
