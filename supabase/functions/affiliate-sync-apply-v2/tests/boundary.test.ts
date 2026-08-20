import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import test from "node:test";
import {
  loadCatalogPlanningContextV2,
  mapCatalogPlanningContextV2,
} from "../catalog-planning-context.ts";
import { createAffiliateSyncApplyV2Handler } from "../handler.ts";
import {
  type CanonicalPersistencePlanMaterialV2,
  PERSISTENCE_CONTRACT_VERSION_V2,
  type PersistencePlanPreconditionV2,
  type PersistencePlanV2,
} from "../../_shared/affiliate-sync-v2/persistence-models.ts";
import {
  persistenceRpcArgs,
  preparePersistenceExecution,
} from "../persistence-execution.ts";
import type { ApplyV2HostDependencies } from "../types.ts";

const ROOT = resolve(import.meta.dirname ?? ".", "../../../..");
const SUPABASE_ROOT = resolve(ROOT, "supabase");
const ENTRY = resolve(
  ROOT,
  "supabase/functions/affiliate-sync-apply-v2/index.ts",
);
const HOST_ROOT = resolve(
  ROOT,
  "supabase/functions/affiliate-sync-apply-v2",
);
const RPC_BOUNDARY = resolve(HOST_ROOT, "supabase-persistence-boundary.ts");
const LEGACY_CORE_ROOT = resolve(
  ROOT,
  "supabase/functions/_shared/affiliate-sync-core",
);
const APPROVED_RPC = "apply_affiliate_persistence_plan_v2";
const POLICY_SELECT =
  "enabled,min_coupons_per_store,max_coupons_per_store,min_deals_per_store,max_deals_per_store";
const DENO_RUNTIME = Reflect.has(globalThis, "Deno");

type CatalogTable = "stores" | "coupons";
type FakeCatalogRow = Record<string, unknown> & { id: string };

interface CatalogQueryAudit {
  table: CatalogTable;
  columns: string;
  equals: Array<readonly [string, unknown]>;
  nots: Array<readonly [string, string, unknown]>;
  afterId: string | null;
  orderColumn: string;
  ascending: boolean;
  requestedLimit: number;
  returnedIds: string[];
}

interface CatalogPageMutation {
  table: CatalogTable;
  pageIndex: number;
  returnedRows: readonly FakeCatalogRow[];
  mutableRows: FakeCatalogRow[];
}

interface FakeCatalogState {
  rows: Record<CatalogTable, FakeCatalogRow[]>;
  requests: CatalogQueryAudit[];
  serverCap: number;
  mutateAfterPage?: (page: CatalogPageMutation) => void;
}

interface FakeQueryResult {
  data: FakeCatalogRow[];
  error: null;
}

class FakeCatalogQuery {
  private readonly table: CatalogTable;
  private readonly state: FakeCatalogState;
  private columns = "";
  private readonly equals: Array<readonly [string, unknown]> = [];
  private readonly nots: Array<readonly [string, string, unknown]> = [];
  private afterId: string | null = null;
  private orderColumn = "";
  private ascending = false;
  private requestedLimit = Number.POSITIVE_INFINITY;

  constructor(table: CatalogTable, state: FakeCatalogState) {
    this.table = table;
    this.state = state;
  }

  select(columns: string): this {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.equals.push([column, value]);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.nots.push([column, operator, value]);
    return this;
  }

  gt(column: string, value: string): this {
    assert.equal(column, "id");
    this.afterId = value;
    return this;
  }

  order(column: string, options: { ascending: boolean }): this {
    this.orderColumn = column;
    this.ascending = options.ascending;
    return this;
  }

  limit(value: number): this {
    this.requestedLimit = value;
    return this;
  }

  then<TResult1 = FakeQueryResult, TResult2 = never>(
    onfulfilled?:
      | (
        (value: FakeQueryResult) => TResult1 | PromiseLike<TResult1>
      )
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<FakeQueryResult> {
    assert.equal(this.orderColumn, "id");
    assert.equal(this.ascending, true);
    assert.equal(this.requestedLimit, 1_000);

    let candidates = [...this.state.rows[this.table]];
    for (const [column, value] of this.equals) {
      candidates = candidates.filter((row) => row[column] === value);
    }
    for (const [column, operator, value] of this.nots) {
      assert.equal(operator, "is");
      assert.equal(value, null);
      candidates = candidates.filter((row) => row[column] !== null);
    }
    if (this.afterId !== null) {
      candidates = candidates.filter((row) => row.id > this.afterId!);
    }
    candidates.sort((left, right) => left.id < right.id ? -1 : 1);
    const page = candidates.slice(
      0,
      Math.min(this.requestedLimit, this.state.serverCap),
    );
    const tableRequests = this.state.requests.filter((request) =>
      request.table === this.table
    );
    this.state.requests.push({
      table: this.table,
      columns: this.columns,
      equals: [...this.equals],
      nots: [...this.nots],
      afterId: this.afterId,
      orderColumn: this.orderColumn,
      ascending: this.ascending,
      requestedLimit: this.requestedLimit,
      returnedIds: page.map((row) => row.id),
    });
    this.state.mutateAfterPage?.({
      table: this.table,
      pageIndex: tableRequests.length,
      returnedRows: page,
      mutableRows: this.state.rows[this.table],
    });
    return {
      data: page.map((row) => ({ ...row })),
      error: null,
    };
  }
}

function createCatalogHarness(options: {
  storeRows: FakeCatalogRow[];
  offerRows: FakeCatalogRow[];
  serverCap?: number;
  mutateAfterPage?: (page: CatalogPageMutation) => void;
}) {
  const state: FakeCatalogState = {
    rows: {
      stores: options.storeRows,
      coupons: options.offerRows,
    },
    requests: [],
    serverCap: options.serverCap ?? 1_000,
    mutateAfterPage: options.mutateAfterPage,
  };
  const db = {
    from(table: string): FakeCatalogQuery {
      assert.equal(table === "stores" || table === "coupons", true);
      return new FakeCatalogQuery(table as CatalogTable, state);
    },
  };
  return { db, state };
}

function catalogUuid(table: CatalogTable, ordinal: number): string {
  assert.equal(Number.isSafeInteger(ordinal) && ordinal >= 0, true);
  const prefix = table === "stores" ? "10000000" : "20000000";
  return `${prefix}-0000-4000-8000-${ordinal.toString(16).padStart(12, "0")}`;
}

function storeRow(ordinal: number): FakeCatalogRow {
  return {
    id: catalogUuid("stores", ordinal),
    slug: `store-${ordinal}`,
    provider: "impact",
    provider_entity_id: `campaign-${ordinal}`,
  };
}

function offerRow(ordinal: number): FakeCatalogRow {
  return {
    id: catalogUuid("coupons", ordinal),
    provider: "impact",
    provider_entity_id: `promotion-${ordinal}`,
    coupon_type: ordinal % 2 === 0 ? "code" : "deal",
  };
}

function catalogRows(count: number, start = 1): {
  stores: FakeCatalogRow[];
  offers: FakeCatalogRow[];
} {
  return {
    stores: Array.from(
      { length: count },
      (_, index) => storeRow(start + index),
    ),
    offers: Array.from(
      { length: count },
      (_, index) => offerRow(start + index),
    ),
  };
}

function requestsFor(
  requests: readonly CatalogQueryAudit[],
  table: CatalogTable,
): CatalogQueryAudit[] {
  return requests.filter((request) => request.table === table);
}

function assertKeysetTrace(
  requests: readonly CatalogQueryAudit[],
  table: CatalogTable,
  rowCount: number,
  effectivePageSize: number,
): void {
  const tableRequests = requestsFor(requests, table);
  assert.equal(
    tableRequests.length,
    Math.ceil(rowCount / effectivePageSize) + 1,
  );
  assert.equal(tableRequests[0]?.afterId, null);
  for (let index = 0; index < tableRequests.length; index += 1) {
    const request = tableRequests[index]!;
    assert.equal(request.orderColumn, "id");
    assert.equal(request.ascending, true);
    assert.equal(request.requestedLimit, 1_000);
    if (index > 0) {
      assert.equal(
        request.afterId,
        tableRequests[index - 1]!.returnedIds.at(-1),
      );
    }
  }
  assert.deepEqual(tableRequests.at(-1)?.returnedIds, []);
  if (table === "stores") {
    assert.equal(
      tableRequests[0]?.columns,
      "id,slug,provider,provider_entity_id",
    );
    assert.deepEqual(tableRequests[0]?.equals, []);
    assert.deepEqual(tableRequests[0]?.nots, []);
  } else {
    assert.equal(
      tableRequests[0]?.columns,
      "id,provider_entity_id,coupon_type",
    );
    assert.deepEqual(tableRequests[0]?.equals, [["provider", "impact"]]);
    assert.deepEqual(tableRequests[0]?.nots, [[
      "provider_entity_id",
      "is",
      null,
    ]]);
  }
}

const PRECONDITION_CODES = [
  "provider_is_impact",
  "context_is_consistent",
  "provider_fetches_completed",
  "provider_parse_succeeded",
  "identity_not_collapsed",
  "store_identities_unique",
  "promotion_identities_unique",
  "writable_offers_resolved",
  "writable_parents_unambiguous",
  "writable_parents_qualified",
  "store_projections_valid",
  "offer_projections_valid",
  "existing_store_ids_consistent",
  "existing_offer_ids_consistent",
  "offer_kinds_consistent",
  "slug_candidates_available",
  "nonwritable_actions_preserved",
  "instruction_counts_reconcile",
] as const;

function emptyReadyPlan(): PersistencePlanV2 {
  const preconditions: PersistencePlanPreconditionV2[] = PRECONDITION_CODES.map(
    (code) => ({ code, satisfied: true }),
  );
  const material: CanonicalPersistencePlanMaterialV2 = {
    persistenceContractVersion: PERSISTENCE_CONTRACT_VERSION_V2,
    provider: "impact",
    integrationId: "11111111-1111-4111-8111-111111111111",
    evaluationTimestamp: "2026-08-20T12:34:56.000Z",
    status: "ready",
    blockers: [],
    preconditions,
    storeInstructions: [],
    offerInstructions: [],
    counts: {
      stores: {
        create: 0,
        noopExisting: 0,
        blockedAmbiguous: 0,
        noopUnmatched: 0,
      },
      offers: {
        create: 0,
        noopExisting: 0,
        noopHeld: 0,
        noopUnresolved: 0,
      },
      writableStores: 0,
      writableOffers: 0,
      writableEntities: 0,
    },
  };
  return {
    ...material,
    canonicalPlanMaterial: material,
    canonicalPlanMaterialString: JSON.stringify(material),
  };
}

interface PolicyReadAudit {
  table: string;
  columns: string;
  equals: Array<readonly [string, unknown]>;
}

function createPolicyHarness(
  responses: Array<{ data: Record<string, unknown> | null; error: unknown }>,
) {
  const requests: PolicyReadAudit[] = [];
  const db = {
    from(table: string) {
      let columns = "";
      const equals: Array<readonly [string, unknown]> = [];
      const query = {
        select(value: string) {
          columns = value;
          return query;
        },
        eq(column: string, value: unknown) {
          equals.push([column, value]);
          return query;
        },
        async maybeSingle() {
          requests.push({ table, columns, equals: [...equals] });
          const response = responses.shift();
          assert.notEqual(response, undefined, "unexpected policy query");
          return response!;
        },
      };
      return query;
    },
  };
  return { db, requests, responses };
}

function importsOf(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?["']([^"']+)["']\s*;/g,
    ),
  ].map((match) => match[1]!);
}

function isWithin(file: string, directory: string): boolean {
  return file === directory || file.startsWith(`${directory}${sep}`);
}

function productionClosure(): Map<string, string> {
  const pending = [ENTRY];
  const visited = new Map<string, string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    assert.equal(
      isWithin(file, SUPABASE_ROOT),
      true,
      `production import escaped supabase: ${file}`,
    );
    const source = readFileSync(file, "utf8");
    visited.set(file, source);

    assert.doesNotMatch(source, /\bimport\s*\(/, `${file} imports dynamically`);
    for (const specifier of importsOf(source)) {
      if (specifier.startsWith("https://")) continue;
      assert.equal(
        specifier.startsWith("."),
        true,
        `${file} has unsupported import ${specifier}`,
      );
      assert.equal(
        specifier.endsWith(".ts"),
        true,
        `${file} lacks explicit .ts: ${specifier}`,
      );
      const imported = resolve(dirname(file), specifier);
      readFileSync(imported, "utf8");
      pending.push(imported);
    }
  }
  return visited;
}

function countOccurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

test("apply-v2 production imports are explicit, resolvable, and isolated from Node, filesystems, src, and V1", () => {
  const closure = productionClosure();
  const forbiddenSource: readonly [RegExp, string][] = [
    [/node:/, "node:"],
    [/\bprocess\b/, "process"],
    [/\bBuffer\b/, "Buffer"],
    [
      /\b(?:readFile|writeFile|appendFile|readdir|mkdir|unlink|rename|copyFile|stat|lstat)(?:Sync)?\s*\(/,
      "filesystem API",
    ],
    [
      /\bDeno\.(?:readFile|readTextFile|writeFile|writeTextFile|open|stat|lstat|mkdir|remove|rename|copyFile)\b/,
      "Deno filesystem API",
    ],
    [/\bsrc\//, "src/"],
    [/@\//, "@/"],
    [/\.server\b/, ".server"],
    [/affiliate-sync-core/, "V1 affiliate-sync-core"],
    [/affiliate-sync-preview\//, "V1 affiliate-sync-preview"],
    [/affiliate-sync-preflight/, "V1 affiliate-sync-preflight"],
    [/\b(?:ImportExecutor|ImportLogger|import_apply)\b/, "V1 apply path"],
  ];

  for (const [file, source] of closure) {
    for (const [pattern, label] of forbiddenSource) {
      assert.doesNotMatch(source, pattern, `${file} contains ${label}`);
    }
    assert.equal(
      isWithin(file, LEGACY_CORE_ROOT),
      false,
      `${file} entered the legacy core`,
    );
  }

  for (
    const required of [
      "supabase/functions/affiliate-sync-apply-v2/handler.ts",
      "supabase/functions/affiliate-sync-apply-v2/supabase-persistence-boundary.ts",
      "supabase/functions/affiliate-sync-preview-v2/supabase-read-boundary.ts",
      "supabase/functions/_shared/affiliate-sync-v2/PersistencePlannerV2.ts",
      "supabase/functions/_shared/edge-supabase.ts",
    ]
  ) {
    assert.equal(
      closure.has(resolve(ROOT, required)),
      true,
      `closure did not reach ${required}`,
    );
  }
});

test("the sole production mutation is one literal call to the approved V2 RPC", () => {
  const closure = productionClosure();
  const rpcCalls: { file: string; name: string }[] = [];
  let allRpcInvocationCount = 0;
  let approvedNameCount = 0;

  for (const [file, source] of closure) {
    assert.doesNotMatch(
      source,
      /\.(?:insert|update|upsert|delete)\s*\(/,
      `${file} contains a direct mutation`,
    );
    allRpcInvocationCount += [...source.matchAll(/\.\s*rpc\s*\(/g)].length;
    approvedNameCount += countOccurrences(source, APPROVED_RPC);
    for (
      const match of source.matchAll(
        /\.\s*rpc\s*\(\s*(["'])([^"']+)\1/g,
      )
    ) {
      rpcCalls.push({ file, name: match[2]! });
    }
  }

  assert.equal(
    rpcCalls.length,
    allRpcInvocationCount,
    "every RPC call must use a reviewable literal name",
  );
  assert.deepEqual(rpcCalls, [{ file: RPC_BOUNDARY, name: APPROVED_RPC }]);
  assert.equal(
    approvedNameCount,
    1,
    "the approved mutation capability must occur exactly once",
  );
});

test("request-host failures are bounded and do not log or echo secrets", async () => {
  const closure = productionClosure();
  for (const [file, source] of closure) {
    if (!isWithin(file, HOST_ROOT)) continue;
    assert.doesNotMatch(source, /\bconsole\s*\./, `${file} uses console`);
    assert.doesNotMatch(
      source,
      /\b(?:logger|logging|request_log)\b/i,
      `${file} contains a logging path`,
    );
    assert.doesNotMatch(
      source,
      /JSON\.stringify\s*\(\s*(?:authorization|jwt|ciphertext|plaintext|credentials|secret|request|error)\b/i,
      `${file} serializes secret-bearing host state`,
    );
  }

  const token = "boundary-private-bearer-token";
  const bodySecret = "boundary-private-request-body";
  const userId = "11111111-1111-4111-8111-111111111111";
  const unreachable = (): never => {
    throw new Error("unexpected dependency call");
  };
  const unreachableAsync = async (): Promise<never> => unreachable();
  const dependencies: ApplyV2HostDependencies = {
    async verifyUser(authorization, jwt) {
      assert.equal(authorization, `Bearer ${token}`);
      assert.equal(jwt, token);
      return { id: userId };
    },
    createDataSource: () => ({
      hasAdminRole: async (candidate) => {
        assert.equal(candidate, userId);
        return true;
      },
      readIntegration: unreachableAsync,
      readCredentialCiphertext: unreachableAsync,
      readPublishingPolicy: unreachableAsync,
      loadCatalogPlanningContext: unreachableAsync,
      applyPersistencePlan: unreachableAsync,
    }),
    decryptCredentialEnvelope: unreachableAsync,
    createImpactTransport: unreachable,
    retrieveImpact: unreachableAsync,
    previewPlan: unreachable,
    persistencePlan: unreachable,
    prepareExecution: unreachableAsync,
    now: () => new Date("2026-08-20T00:00:00.000Z"),
    siteUrl: "https://admin.example",
  };
  const handler = createAffiliateSyncApplyV2Handler(dependencies);
  const response = await handler(
    new Request("https://functions.example/apply", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: "https://admin.example",
      },
      body: JSON.stringify({
        integrationId: userId,
        execute: true,
        secret: bodySecret,
      }),
    }),
  );
  const responseText = await response.text();

  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(responseText), {
    status: "failed",
    stage: "response",
    reason: "invalid_request",
  });
  assert.equal(responseText.includes(token), false);
  assert.equal(responseText.includes(bodySecret), false);
});

test("catalog planning mapping preserves every exact slug, kind, and duplicate identity", () => {
  const mapped = mapCatalogPlanningContextV2(
    [
      {
        id: "store-a",
        slug: "same-slug",
        provider: "impact",
        providerEntityId: "campaign-a",
      },
      {
        id: "store-b",
        slug: "same-slug",
        provider: "impact",
        providerEntityId: "campaign-a",
      },
      {
        id: "store-c",
        slug: "case-sensitive-provider",
        provider: "Impact",
        providerEntityId: "campaign-c",
      },
      {
        id: "store-d",
        slug: "invalid-provider-identity",
        provider: "impact",
        providerEntityId: " campaign-d ",
      },
    ],
    [
      {
        id: "offer-a",
        providerEntityId: "promotion-a",
        couponType: "code",
      },
      {
        id: "offer-b",
        providerEntityId: "promotion-a",
        couponType: "deal",
      },
      {
        id: "offer-c",
        providerEntityId: "promotion-c",
        couponType: "deal",
      },
      {
        id: "offer-without-identity",
        providerEntityId: null,
        couponType: "not-evaluated",
      },
    ],
  );

  assert.deepEqual(mapped, {
    existingCatalogSnapshot: {
      stores: [
        {
          id: "store-a",
          providerStoreKey: {
            provider: "impact",
            namespace: "campaign",
            id: "campaign-a",
          },
        },
        {
          id: "store-b",
          providerStoreKey: {
            provider: "impact",
            namespace: "campaign",
            id: "campaign-a",
          },
        },
      ],
      offers: [
        { id: "offer-a", promotionId: "promotion-a" },
        { id: "offer-b", promotionId: "promotion-a" },
        { id: "offer-c", promotionId: "promotion-c" },
      ],
    },
    knownStoreSlugs: [
      {
        storeId: "store-a",
        slug: "same-slug",
        providerStoreKey: {
          provider: "impact",
          namespace: "campaign",
          id: "campaign-a",
        },
      },
      {
        storeId: "store-b",
        slug: "same-slug",
        providerStoreKey: {
          provider: "impact",
          namespace: "campaign",
          id: "campaign-a",
        },
      },
      {
        storeId: "store-c",
        slug: "case-sensitive-provider",
        providerStoreKey: null,
      },
      {
        storeId: "store-d",
        slug: "invalid-provider-identity",
        providerStoreKey: null,
      },
    ],
    knownOfferKinds: [
      { offerId: "offer-a", promotionId: "promotion-a", kind: "coupon" },
      { offerId: "offer-b", promotionId: "promotion-a", kind: "deal" },
      { offerId: "offer-c", promotionId: "promotion-c", kind: "deal" },
    ],
  });
});

test("catalog planning mapping rejects malformed exact evidence", () => {
  assert.throws(
    () =>
      mapCatalogPlanningContextV2([{
        id: " store-a ",
        slug: "store-a",
        provider: "impact",
        providerEntityId: "campaign-a",
      }], []),
    /catalog_store_id_invalid/,
  );
  assert.throws(
    () =>
      mapCatalogPlanningContextV2([{
        id: "store-a",
        slug: "",
        provider: "impact",
        providerEntityId: "campaign-a",
      }], []),
    /catalog_store_slug_invalid/,
  );
  assert.throws(
    () =>
      mapCatalogPlanningContextV2([], [{
        id: " offer-a ",
        providerEntityId: null,
        couponType: "code",
      }]),
    /catalog_offer_id_invalid/,
  );
  assert.throws(
    () =>
      mapCatalogPlanningContextV2([], [{
        id: "offer-a",
        providerEntityId: "promotion-a",
        couponType: "coupon",
      }]),
    /catalog_offer_kind_invalid/,
  );
});

test("catalog loader preserves complete UUID-ordered evidence at 1,001, 5,000, and 20,000 rows", async () => {
  for (const count of [1_001, 5_000, 20_000]) {
    const fixture = catalogRows(count);
    const harness = createCatalogHarness({
      storeRows: fixture.stores,
      offerRows: fixture.offers,
    });
    const context = await loadCatalogPlanningContextV2(harness.db as never);

    assert.deepEqual(
      context.knownStoreSlugs.map((row) => row.storeId),
      fixture.stores.map((row) => row.id),
      `store evidence was incomplete at ${count} rows`,
    );
    assert.deepEqual(
      context.existingCatalogSnapshot.stores.map((row) => row.id),
      fixture.stores.map((row) => row.id),
      `store snapshot was incomplete at ${count} rows`,
    );
    assert.deepEqual(
      context.knownOfferKinds.map((row) => ({
        id: row.offerId,
        promotionId: row.promotionId,
        kind: row.kind,
      })),
      fixture.offers.map((row, index) => ({
        id: row.id,
        promotionId: row.provider_entity_id,
        kind: (index + 1) % 2 === 0 ? "coupon" : "deal",
      })),
      `offer kind evidence was incomplete at ${count} rows`,
    );
    assert.deepEqual(
      context.existingCatalogSnapshot.offers.map((row) => row.id),
      fixture.offers.map((row) => row.id),
      `offer snapshot was incomplete at ${count} rows`,
    );
    assertKeysetTrace(harness.state.requests, "stores", count, 1_000);
    assertKeysetTrace(harness.state.requests, "coupons", count, 1_000);
  }
});

test("catalog loader is complete under a simulated 500-row server cap and probes final empty pages", async () => {
  const fixture = catalogRows(1_001);
  const harness = createCatalogHarness({
    storeRows: fixture.stores,
    offerRows: fixture.offers,
    serverCap: 500,
  });
  const context = await loadCatalogPlanningContextV2(harness.db as never);

  assert.deepEqual(
    context.knownStoreSlugs.map((row) => row.storeId),
    fixture.stores.map((row) => row.id),
  );
  assert.deepEqual(
    context.knownOfferKinds.map((row) => row.offerId),
    fixture.offers.map((row) => row.id),
  );
  assertKeysetTrace(harness.state.requests, "stores", 1_001, 500);
  assertKeysetTrace(harness.state.requests, "coupons", 1_001, 500);
});

test("catalog keyset paging does not duplicate or omit the starting evidence after an insert behind the cursor", async () => {
  const fixture = catalogRows(1_500, 1_000);
  const originalIds = fixture.stores.map((row) => row.id);
  const inserted = storeRow(1);
  const harness = createCatalogHarness({
    storeRows: fixture.stores,
    offerRows: [],
    mutateAfterPage(page) {
      if (page.table === "stores" && page.pageIndex === 0) {
        page.mutableRows.push(inserted);
      }
    },
  });
  const context = await loadCatalogPlanningContextV2(harness.db as never);
  const loadedIds = context.knownStoreSlugs.map((row) => row.storeId);

  assert.deepEqual(loadedIds, originalIds);
  assert.equal(loadedIds.includes(inserted.id), false);
  assert.equal(new Set(loadedIds).size, originalIds.length);
  assert.deepEqual(
    requestsFor(harness.state.requests, "stores").at(-1)?.returnedIds,
    [],
  );
});

test("catalog keyset paging does not omit starting offer evidence after a consumed row is deleted", async () => {
  const fixture = catalogRows(1_500, 1_000);
  const originalIds = fixture.offers.map((row) => row.id);
  const deletedId = originalIds[100]!;
  const harness = createCatalogHarness({
    storeRows: [],
    offerRows: fixture.offers,
    mutateAfterPage(page) {
      if (page.table !== "coupons" || page.pageIndex !== 0) return;
      const deletedIndex = page.mutableRows.findIndex((row) =>
        row.id === deletedId
      );
      assert.notEqual(deletedIndex, -1);
      page.mutableRows.splice(deletedIndex, 1);
    },
  });
  const context = await loadCatalogPlanningContextV2(harness.db as never);
  const loadedIds = context.knownOfferKinds.map((row) => row.offerId);

  assert.deepEqual(loadedIds, originalIds);
  assert.equal(new Set(loadedIds).size, originalIds.length);
  assert.deepEqual(
    requestsFor(harness.state.requests, "coupons").at(-1)?.returnedIds,
    [],
  );
});

test(
  "concrete Supabase adapter makes one exact RPC attempt and returns only transport state",
  {
    skip: !DENO_RUNTIME,
  },
  async () => {
    const { SupabaseApplyV2DataSource } = await import(
      "../supabase-persistence-boundary.ts"
    );
    const prepared = await preparePersistenceExecution(
      emptyReadyPlan(),
      "22222222-2222-4222-8222-222222222222",
    );
    const args = persistenceRpcArgs(prepared);
    const validValue = {
      status: "committed",
      runId: "33333333-3333-4333-8333-333333333333",
      provider: args._provider,
      integrationId: args._integration_id,
      persistenceContractVersion: args._persistence_contract_version,
      planFingerprintAlgorithm: args._plan_fingerprint_algorithm,
      planFingerprint: args._plan_fingerprint,
      evaluationTimestamp: args._evaluation_timestamp,
      counts: {
        expected: args._expected_counts,
        actual: {
          storesCreated: 0,
          storesNoopExisting: 0,
          offersCreated: 0,
          offersNoopExisting: 0,
          ledgerRows: 0,
        },
      },
      createdStores: [],
      createdOffers: [],
      noops: { stores: 0, offers: 0 },
      ledger: [],
    };
    const malformedValue = { status: "committed" };
    const scenarios = [
      {
        name: "valid response",
        invoke: async () => ({ data: validValue, error: null }),
        expected: { kind: "response", value: validValue },
      },
      {
        name: "returned transport error",
        invoke: async () => ({
          data: validValue,
          error: { message: "database rejected call" },
        }),
        expected: { kind: "transport_error" },
      },
      {
        name: "thrown transport error",
        invoke: async (): Promise<never> => {
          throw new Error("transport unavailable");
        },
        expected: { kind: "transport_error" },
      },
      {
        name: "malformed response data",
        // This boundary deliberately preserves the response; handler tests own
        // and verify the resulting indeterminate classification.
        invoke: async () => ({ data: malformedValue, error: null }),
        expected: { kind: "response", value: malformedValue },
      },
    ];

    for (const scenario of scenarios) {
      const calls: Array<{ name: string; args: unknown }> = [];
      const db = {
        async rpc(name: string, rpcArgs: unknown) {
          calls.push({ name, args: rpcArgs });
          return await scenario.invoke();
        },
      };
      const dataSource = new SupabaseApplyV2DataSource(db as never);
      const result = await dataSource.applyPersistencePlan(prepared);

      assert.deepEqual(result, scenario.expected, scenario.name);
      assert.equal(calls.length, 1, `${scenario.name} retried the RPC`);
      assert.equal(calls[0]?.name, APPROVED_RPC);
      assert.equal(calls[0]?.args, args);
    }
  },
);

test(
  "apply-local Supabase policy reader preserves raw malformed values and assigned-then-default lookup",
  {
    skip: !DENO_RUNTIME,
  },
  async () => {
    const { SupabaseApplyV2DataSource } = await import(
      "../supabase-persistence-boundary.ts"
    );
    const assignedId = "44444444-4444-4444-8444-444444444444";
    const rawMalformed = {
      enabled: { malformed: true },
      min_coupons_per_store: -1,
      max_coupons_per_store: "5",
      min_deals_per_store: null,
      max_deals_per_store: [10],
    };
    const assigned = createPolicyHarness([{
      data: rawMalformed,
      error: null,
    }]);
    const assignedReader = new SupabaseApplyV2DataSource(assigned.db as never);

    assert.deepEqual(await assignedReader.readPublishingPolicy(assignedId), {
      enabled: rawMalformed.enabled,
      minimumCouponsPerStore: -1,
      maximumCouponsPerStore: "5",
      minimumDealsPerStore: null,
      maximumDealsPerStore: rawMalformed.max_deals_per_store,
    });
    assert.deepEqual(assigned.requests, [{
      table: "publishing_policies",
      columns: POLICY_SELECT,
      equals: [["id", assignedId]],
    }]);
    assert.deepEqual(assigned.responses, []);

    const rawDefault = {
      enabled: false,
      min_coupons_per_store: 1,
      max_coupons_per_store: 2,
      min_deals_per_store: 3,
      max_deals_per_store: 4,
    };
    const fallback = createPolicyHarness([
      { data: null, error: null },
      { data: rawDefault, error: null },
    ]);
    const fallbackReader = new SupabaseApplyV2DataSource(fallback.db as never);

    assert.deepEqual(await fallbackReader.readPublishingPolicy(assignedId), {
      enabled: false,
      minimumCouponsPerStore: 1,
      maximumCouponsPerStore: 2,
      minimumDealsPerStore: 3,
      maximumDealsPerStore: 4,
    });
    assert.deepEqual(fallback.requests, [
      {
        table: "publishing_policies",
        columns: POLICY_SELECT,
        equals: [["id", assignedId]],
      },
      {
        table: "publishing_policies",
        columns: POLICY_SELECT,
        equals: [["is_default", true]],
      },
    ]);
    assert.deepEqual(fallback.responses, []);
  },
);
