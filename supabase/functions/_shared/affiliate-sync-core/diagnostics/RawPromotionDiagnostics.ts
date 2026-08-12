// TEMPORARY — read-only observation of Impact Promotions responses.
//
// This module deliberately observes the raw provider envelope before
// normalization. It has no database, policy, qualification, or persistence
// dependencies, and returns only a small, sanitized projection.

type RawRecord = Record<string, unknown>;

const TARGET_PROMOTION_IDS = new Set([
  "26b410_ridgid_10off",
  "26b409_greenlee_10off",
  "26b256_milwaukee_free",
  "26b239_dewalt_free",
  "26b212_acme_10off",
]);

const SECRET_QUERY_KEY =
  /(?:api[_-]?key|token|secret|auth(?:orization)?|password|signature|account[_-]?sid|^sid$)/i;

export interface RawPromotionAdvertiserCount {
  advertiserId: string | null;
  advertiserName: string | null;
  count: number;
}

export interface PromotionNextPageComparison {
  sanitizedReconstructedNextUrl: string;
  sanitizedNextPageUri: string;
  samePath: boolean;
  sameQueryParameters: boolean;
  parametersOnlyInNextPageUri: string[];
  parametersOnlyInReconstructedRequest: string[];
  parametersWithDifferentValues: string[];
}

export interface RawPromotionPageDiagnostics {
  requestedPageNumber: number | null;
  sanitizedRequestedUrl: string;
  responsePage: string | null;
  responsePageSize: string | null;
  responseTotal: string | null;
  responseNumPages: string | null;
  sanitizedResponseUri: string | null;
  sanitizedResponseNextPageUri: string | null;
  promotionCount: number;
  uniquePromotionIdCount: number;
  uniqueAdvertiserIdCount: number;
  topAdvertisers: RawPromotionAdvertiserCount[];
  firstPromotionIds: string[];
  lastPromotionIds: string[];
  nextPageComparison: PromotionNextPageComparison | null;
}

export interface DuplicatePromotionProvenance {
  providerId: string;
  occurrenceCount: number;
  pages: number[];
}

export interface TargetRawPromotionRecord {
  promotionIds: string;
  promotionTitle: string | null;
  advertiserId: string | null;
  advertiserName: string | null;
  campaignId: string | null;
  programId: string | null;
  sanitizedUri: string | null;
  pageNumber: number | null;
}

export interface RawPromotionDiagnostics {
  /** Identifies this as removable diagnostics rather than product output. */
  temporary: true;
  pages: RawPromotionPageDiagnostics[];
  duplicatePromotionProvenance: DuplicatePromotionProvenance[];
  targetRawPromotionRecords: TargetRawPromotionRecord[];
}

type Occurrence = { count: number; pages: Set<number> };

function isRecord(value: unknown): value is RawRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function envelopeValue(body: unknown, key: string): string | null {
  return isRecord(body) ? stringValue(body[key]) : null;
}

function promotionRecords(body: unknown): RawRecord[] {
  if (!isRecord(body) || !Array.isArray(body.Promotions)) return [];
  return body.Promotions.filter(isRecord);
}

function parseUrl(value: string): { url: URL; absolute: boolean } | null {
  try {
    return { url: new URL(value, "https://impact.invalid"), absolute: /^https?:\/\//i.test(value) };
  } catch {
    return null;
  }
}

function maskAccountSid(segment: string): string {
  if (!segment) return segment;
  return `${"•".repeat(Math.min(4, segment.length))}${segment.slice(-4)}`;
}

function sanitizedUrlParts(
  value: string,
): { path: string; query: Map<string, string[]>; sanitized: string } | null {
  const parsed = parseUrl(value);
  if (!parsed) return null;
  const { url, absolute } = parsed;
  url.username = "";
  url.password = "";
  url.hash = "";
  const parts = url.pathname.split("/");
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index].toLowerCase() === "mediapartners")
      parts[index + 1] = maskAccountSid(parts[index + 1]);
  }
  const query = new Map<string, string[]>();
  for (const [key, value] of url.searchParams) {
    if (SECRET_QUERY_KEY.test(key)) continue;
    const values = query.get(key) ?? [];
    values.push(value);
    query.set(key, values);
  }
  const queryText = new URLSearchParams();
  for (const [key, values] of query) for (const value of values) queryText.append(key, value);
  const path = parts.join("/");
  const suffix = queryText.size ? `?${queryText.toString()}` : "";
  return {
    path,
    query,
    sanitized: absolute ? `${url.protocol}//${url.host}${path}${suffix}` : `${path}${suffix}`,
  };
}

/** Exposed for focused safety tests; no headers or credentials enter diagnostics. */
export function sanitizePromotionDiagnosticUrl(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  return sanitizedUrlParts(text)?.sanitized ?? null;
}

function pageFromNextUri(value: string | null): number | null {
  if (!value) return null;
  const parsed = parseUrl(value);
  if (!parsed) return null;
  for (const [key, rawPage] of parsed.url.searchParams) {
    if (key.toLowerCase() !== "page" || !/^\d+$/.test(rawPage)) continue;
    const page = Number(rawPage);
    return Number.isSafeInteger(page) && page > 0 ? page : null;
  }
  return null;
}

function reconstructedNextUrl(
  requestedUrl: string,
  nextPage: number,
  pageSize: number | null,
): string | null {
  const parsed = parseUrl(requestedUrl);
  if (!parsed) return null;
  parsed.url.searchParams.set("Page", String(nextPage));
  if (pageSize != null) parsed.url.searchParams.set("PageSize", String(pageSize));
  return parsed.url.toString();
}

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareNextPageUrls(
  reconstructed: string,
  nextPageUri: string,
): PromotionNextPageComparison | null {
  const left = sanitizedUrlParts(reconstructed);
  const right = sanitizedUrlParts(nextPageUri);
  if (!left || !right) return null;
  const leftKeys = new Set(left.query.keys());
  const rightKeys = new Set(right.query.keys());
  const common = [...leftKeys].filter((key) => rightKeys.has(key));
  return {
    sanitizedReconstructedNextUrl: left.sanitized,
    sanitizedNextPageUri: right.sanitized,
    samePath: left.path === right.path,
    sameQueryParameters:
      leftKeys.size === rightKeys.size &&
      common.length === leftKeys.size &&
      common.every((key) => sameValues(left.query.get(key) ?? [], right.query.get(key) ?? [])),
    parametersOnlyInNextPageUri: [...rightKeys].filter((key) => !leftKeys.has(key)),
    parametersOnlyInReconstructedRequest: [...leftKeys].filter((key) => !rightKeys.has(key)),
    parametersWithDifferentValues: common.filter(
      (key) => !sameValues(left.query.get(key) ?? [], right.query.get(key) ?? []),
    ),
  };
}

function advertiserCounts(records: RawRecord[]): RawPromotionAdvertiserCount[] {
  const counts = new Map<string, RawPromotionAdvertiserCount>();
  for (const record of records) {
    const advertiserId = stringValue(record.AdvertiserId);
    const advertiserName = stringValue(record.AdvertiserName);
    const key = `${advertiserId ?? ""}\u0000${advertiserName ?? ""}`;
    const current = counts.get(key) ?? { advertiserId, advertiserName, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        (left.advertiserId ?? "").localeCompare(right.advertiserId ?? ""),
    )
    .slice(0, 10);
}

function pageNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Collects a compact snapshot from Promotions responses already fetched by the
 * adapter. It never retains complete raw records and never issues HTTP calls.
 */
export class RawPromotionDiagnosticsCollector {
  private readonly pages: RawPromotionPageDiagnostics[] = [];
  private readonly duplicates = new Map<string, Occurrence>();
  private readonly targets: TargetRawPromotionRecord[] = [];

  recordPage(input: {
    requestedPage?: number;
    requestedPageSize?: number;
    requestedUrl: string;
    body: unknown;
  }): void {
    const records = promotionRecords(input.body);
    const currentPage = pageNumber(input.requestedPage);
    const promotionIds = records
      .map((record) => stringValue(record.PromotionIds))
      .filter((id): id is string => !!id);
    const advertiserIds = new Set(
      records.map((record) => stringValue(record.AdvertiserId)).filter((id): id is string => !!id),
    );
    const nextPageUri = envelopeValue(input.body, "@nextpageuri");
    const nextPage = pageFromNextUri(nextPageUri);
    const reconstructed =
      nextPage == null
        ? null
        : reconstructedNextUrl(input.requestedUrl, nextPage, pageNumber(input.requestedPageSize));

    for (const record of records) {
      const promotionId = stringValue(record.PromotionIds);
      if (!promotionId) continue;
      const occurrence = this.duplicates.get(promotionId) ?? { count: 0, pages: new Set<number>() };
      occurrence.count += 1;
      if (currentPage != null) occurrence.pages.add(currentPage);
      this.duplicates.set(promotionId, occurrence);
      if (!TARGET_PROMOTION_IDS.has(promotionId)) continue;
      this.targets.push({
        promotionIds: promotionId,
        promotionTitle: stringValue(record.PromotionTitle),
        advertiserId: stringValue(record.AdvertiserId),
        advertiserName: stringValue(record.AdvertiserName),
        campaignId: stringValue(record.CampaignId),
        programId: stringValue(record.ProgramId),
        sanitizedUri: sanitizePromotionDiagnosticUrl(record.Uri),
        pageNumber: currentPage,
      });
    }

    this.pages.push({
      requestedPageNumber: currentPage,
      sanitizedRequestedUrl: sanitizePromotionDiagnosticUrl(input.requestedUrl) ?? "",
      responsePage: envelopeValue(input.body, "@page"),
      responsePageSize: envelopeValue(input.body, "@pagesize"),
      responseTotal: envelopeValue(input.body, "@total"),
      responseNumPages: envelopeValue(input.body, "@numpages"),
      sanitizedResponseUri: sanitizePromotionDiagnosticUrl(envelopeValue(input.body, "@uri")),
      sanitizedResponseNextPageUri: sanitizePromotionDiagnosticUrl(nextPageUri),
      promotionCount: records.length,
      uniquePromotionIdCount: new Set(promotionIds).size,
      uniqueAdvertiserIdCount: advertiserIds.size,
      topAdvertisers: advertiserCounts(records),
      firstPromotionIds: promotionIds.slice(0, 5),
      lastPromotionIds: promotionIds.slice(-5),
      nextPageComparison:
        reconstructed && nextPageUri ? compareNextPageUrls(reconstructed, nextPageUri) : null,
    });
  }

  snapshot(): RawPromotionDiagnostics {
    return {
      temporary: true,
      pages: this.pages.map((page) => ({
        ...page,
        topAdvertisers: page.topAdvertisers.map((row) => ({ ...row })),
        firstPromotionIds: [...page.firstPromotionIds],
        lastPromotionIds: [...page.lastPromotionIds],
      })),
      duplicatePromotionProvenance: [...this.duplicates.entries()]
        .filter(([, occurrence]) => occurrence.count > 1)
        .slice(0, 50)
        .map(([providerId, occurrence]) => ({
          providerId,
          occurrenceCount: occurrence.count,
          pages: [...occurrence.pages],
        })),
      targetRawPromotionRecords: this.targets.map((record) => ({ ...record })),
    };
  }
}
