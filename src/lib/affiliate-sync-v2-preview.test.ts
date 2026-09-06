import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AFFILIATE_SYNC_PREVIEW_V2_FUNCTION,
  AffiliateSyncPreviewV2ClientError,
  buildAffiliateSyncPreviewV2Sections,
  getAdminV2PreviewOperatorStatus,
  parseAffiliateSyncPreviewV2HostResponse,
  requestAffiliateSyncPreviewV2,
  type AffiliateSyncPreviewV2Invoke,
} from "./affiliate-sync-v2-preview.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";

function stream(stream: "promotions" | "campaigns") {
  return {
    stream,
    pagesFetched: 1,
    rawRecordCount: stream === "promotions" ? 3 : 1,
    acceptedRecordCount: stream === "promotions" ? 3 : 1,
    quarantinedRecordCount: 0,
    quarantineReasonCounts: {
      malformed_record: 0,
      missing_promotion_id: 0,
      missing_campaign_id: 0,
    },
    stopReason: "completed" as const,
    parseFailureReason: null,
    pageErrors: [],
    pages: [],
    retries: [],
  };
}

function validResponse(integrationId = INTEGRATION_ID) {
  return {
    host: { version: "v2-a8a", readOnly: true, integrationId },
    preview: {
      provider: "impact",
      evaluationTimestamp: "2026-09-06T00:00:00.000Z",
      rawFetchDiagnostics: {
        promotions: stream("promotions"),
        campaigns: stream("campaigns"),
        uniquePromotionCount: 2,
        duplicatePromotionCount: 1,
        duplicatedPromotionIdentities: 1,
        duplicates: [],
        duplicateDetailsReturned: 0,
        duplicateDetailsTruncated: false,
        quarantinedRecords: [],
        quarantinedDetailsReturned: 0,
        quarantinedDetailsTruncated: false,
      },
      parserDiagnostics: {
        quarantinedRecords: 0,
        quarantinedPromotions: 0,
        quarantinedCampaigns: 0,
        quarantineDetails: [],
        quarantineDetailsReturned: 0,
        quarantineDetailsTruncated: false,
      },
      deduplicationDiagnostics: {
        acceptedInputRecords: 3,
        uniquePromotions: 2,
        duplicateRecordsRemoved: 1,
        duplicatedIdentities: 1,
        identitiesWithConflictingProviderFields: 0,
        duplicateDetails: [],
        duplicateDetailsReturned: 0,
        duplicateDetailsTruncated: false,
      },
      merchantIdentityDiagnostics: {
        advertiserCount: 1,
        campaignCount: 1,
        unresolvedAssociationCount: 0,
        matchMethodCounts: {
          campaign_id: 2,
          advertiser_id: 0,
          explicit_provider_relation: 0,
          unmatched: 0,
        },
        unresolvedReasonCounts: {
          unknown_campaign_id: 0,
          campaign_advertiser_conflict: 0,
          unknown_advertiser_id: 0,
          ambiguous_advertiser_id: 0,
          missing_merchant_identity: 0,
        },
        promotionsEvaluated: 2,
        resolvedByCampaignId: 2,
        resolvedByAdvertiserId: 0,
        unmatchedTotal: 0,
        distinctCampaignIdsReferencedByPromotions: 1,
        distinctAdvertiserIdsReferencedByPromotions: 1,
        distinctResolvedProviderStoreKeys: 1,
        advertiserCrossCheckUnavailableCount: 0,
        campaignAdvertiserConflicts: [],
        campaignAdvertiserConflictDetailsReturned: 0,
        campaignAdvertiserConflictDetailsTruncated: false,
        campaignIndex: {
          acceptedCampaignRecords: 1,
          indexedCampaigns: 1,
          duplicateCampaignRecords: 0,
          duplicatedCampaignIdentities: 0,
          campaignIdentitiesWithConflictingFields: 0,
          duplicateCampaignDetails: [],
          duplicateCampaignDetailsReturned: 0,
          duplicateCampaignDetailsTruncated: false,
          advertisersMappingToExactlyOneCampaign: 1,
          advertisersMappingToMultipleCampaigns: 0,
          campaignsMissingAdvertiserId: 0,
        },
      },
      normalizationDiagnostics: {
        deduplicatedPromotionsEvaluated: 2,
        couponsNormalized: 1,
        dealsNormalized: 1,
        offersUnresolvedFromA4: 0,
        offersWithResolvedProviderStoreKey: 2,
        storesNormalized: 1,
      },
      storeMatchDiagnostics: {
        offersEvaluated: 2,
        offersUnresolvedFromA4: 0,
        offersWithResolvedProviderStoreKey: 2,
        offersMatchedToExistingStore: 0,
        resolvedProviderStoreKeysWithNoExistingStore: 1,
        ambiguousSnapshotStoreKeys: 0,
        newPromotionIdentities: 2,
        existingPromotionIdentities: 0,
      },
      offerQualificationDiagnostics: {
        offersEvaluated: 2,
        eligibleOffers: 2,
        ineligibleOffers: 0,
        ineligibleReasonCounts: {
          unresolved_store: 0,
          not_started: 0,
          expired: 0,
          invalid_date: 0,
          invalid_date_range: 0,
          missing_title: 0,
        },
      },
      existingOfferIdentityDiagnostics: {
        normalizedOffers: 2,
        existingPromotionIdentities: 0,
        newPromotionIdentities: 2,
      },
      topAdvertiserDistribution: [],
      advertiserDistributionTotal: 2,
      advertiserDistributionDetailsReturned: 0,
      advertiserDistributionDetailsTruncated: false,
      storeCoverage: {
        campaignBackedStoresDiscovered: 1,
        providerStoreKeysReferencedByPromotions: 1,
        storesWithResolvedOffers: 1,
        storesMatchedToExisting: 0,
        newStoreCandidates: 1,
        storesWithSelectedOffers: 1,
        qualifiedStores: 1,
        unresolvedOffers: 0,
        ambiguousSnapshotKeys: 0,
      },
      identityIntegrityDiagnostics: {
        distinctResolvedProviderStoreKeys: 1,
        normalizedProviderStoreKeys: 1,
        matchedProviderStoreKeys: 1,
        policyProviderStoreKeys: 1,
        qualificationProviderStoreKeys: 1,
        identityCollapseDetected: false,
      },
      normalizedStores: [],
      normalizedCoupons: [],
      normalizedDeals: [],
      associations: [],
      publishingPolicy: {
        stores: [],
        unresolvedHeldCoupons: [],
        unresolvedHeldDeals: [],
        selectedCoupons: [],
        selectedDeals: [],
        heldCoupons: [],
        heldDeals: [],
        diagnostics: {
          offersEvaluated: 2,
          eligibleOffers: 2,
          ineligibleOffers: 0,
          selectedOffers: 2,
          heldOffers: 0,
          couponsSelected: 1,
          couponsHeld: 0,
          dealsSelected: 1,
          dealsHeld: 0,
          storesCovered: 1,
          holdReasonCounts: {
            unresolved_store: 0,
            not_started: 0,
            expired: 0,
            invalid_date: 0,
            invalid_date_range: 0,
            missing_title: 0,
            over_coupon_limit: 0,
            over_deal_limit: 0,
          },
        },
      },
      storeQualification: [],
      proposedActions: {
        stores: [],
        offers: [],
        counts: {
          stores: {
            discovered: 1,
            matchedExisting: 0,
            newCandidates: 1,
            unmatchedAssociations: 0,
            ambiguousSnapshot: 0,
            qualified: 1,
          },
          coupons: {
            normalized: 1,
            selected: 1,
            held: 0,
            unresolved: 0,
            existing: 0,
            proposedCreate: 1,
          },
          deals: {
            normalized: 1,
            selected: 1,
            held: 0,
            unresolved: 0,
            existing: 0,
            proposedCreate: 1,
          },
          offers: {
            normalized: 2,
            selected: 2,
            held: 0,
            unresolved: 0,
            existing: 0,
            proposedCreate: 2,
            duplicateRecordsRemoved: 1,
            quarantined: 0,
          },
        },
      },
    },
  };
}

test("V2 preview invokes only the read-only host with the exact request body", async () => {
  const calls: Array<{ functionName: string; options: unknown }> = [];
  const invoke: AffiliateSyncPreviewV2Invoke = async (functionName, options) => {
    calls.push({ functionName, options });
    return { data: validResponse(), error: null };
  };

  const result = await requestAffiliateSyncPreviewV2(INTEGRATION_ID, invoke);

  assert.equal(result.host.readOnly, true);
  assert.deepEqual(calls, [
    {
      functionName: AFFILIATE_SYNC_PREVIEW_V2_FUNCTION,
      options: { body: { integrationId: INTEGRATION_ID, preview: true } },
    },
  ]);
});

test("V2 preview response validation fails closed", async (t) => {
  await t.test("provider or host error is not treated as success", async () => {
    await assert.rejects(
      requestAffiliateSyncPreviewV2(INTEGRATION_ID, async () => ({
        data: validResponse(),
        error: { arbitrary: "not exposed" },
      })),
      (error) =>
        error instanceof AffiliateSyncPreviewV2ClientError && error.code === "invoke_failed",
    );
  });

  await t.test("malformed preview is rejected", () => {
    assert.throws(
      () =>
        parseAffiliateSyncPreviewV2HostResponse(
          {
            host: { version: "v2-a8a", readOnly: true, integrationId: INTEGRATION_ID },
            preview: {},
          },
          INTEGRATION_ID,
        ),
      (error) =>
        error instanceof AffiliateSyncPreviewV2ClientError && error.code === "invalid_response",
    );
  });

  await t.test("host readOnly must be literal true", () => {
    const response: unknown = {
      ...validResponse(),
      host: { version: "v2-a8a", readOnly: false, integrationId: INTEGRATION_ID },
    };
    assert.throws(
      () => parseAffiliateSyncPreviewV2HostResponse(response, INTEGRATION_ID),
      (error) =>
        error instanceof AffiliateSyncPreviewV2ClientError && error.code === "invalid_response",
    );
  });

  await t.test("host version must be the settled V2 host version", () => {
    const response = validResponse();
    Reflect.set(response.host, "version", "v2-other");
    assert.throws(
      () => parseAffiliateSyncPreviewV2HostResponse(response, INTEGRATION_ID),
      (error) =>
        error instanceof AffiliateSyncPreviewV2ClientError && error.code === "invalid_response",
    );
  });

  await t.test("integration identity must match the request", () => {
    assert.throws(
      () =>
        parseAffiliateSyncPreviewV2HostResponse(
          validResponse("22222222-2222-4222-8222-222222222222"),
          INTEGRATION_ID,
        ),
      (error) =>
        error instanceof AffiliateSyncPreviewV2ClientError && error.code === "invalid_response",
    );
  });
});

test("nested V2 diagnostics are validated before constructing the admin DTO", async (t) => {
  const rejects = (response: unknown) => {
    assert.throws(
      () => parseAffiliateSyncPreviewV2HostResponse(response, INTEGRATION_ID),
      (error) =>
        error instanceof AffiliateSyncPreviewV2ClientError && error.code === "invalid_response",
    );
  };

  await t.test("wrong Promotions stream identity fails closed", () => {
    const response = structuredClone(validResponse());
    Reflect.set(response.preview.rawFetchDiagnostics.promotions, "stream", "campaigns");
    rejects(response);
  });

  await t.test("wrong Campaigns stream identity fails closed", () => {
    const response = structuredClone(validResponse());
    Reflect.set(response.preview.rawFetchDiagnostics.campaigns, "stream", "promotions");
    rejects(response);
  });

  await t.test("unknown displayed stream stop reason fails closed", () => {
    const response = structuredClone(validResponse());
    Reflect.set(response.preview.rawFetchDiagnostics.promotions, "stopReason", "unexpected");
    rejects(response);
  });

  await t.test("missing and empty required reason maps fail closed", () => {
    const missing = structuredClone(validResponse());
    Reflect.deleteProperty(
      missing.preview.rawFetchDiagnostics.promotions,
      "quarantineReasonCounts",
    );
    rejects(missing);

    const emptyMapTargets = [
      (response: ReturnType<typeof validResponse>) =>
        response.preview.rawFetchDiagnostics.promotions,
      (response: ReturnType<typeof validResponse>) => response.preview.merchantIdentityDiagnostics,
      (response: ReturnType<typeof validResponse>) =>
        response.preview.offerQualificationDiagnostics,
      (response: ReturnType<typeof validResponse>) => response.preview.publishingPolicy.diagnostics,
    ];
    const mapNames = [
      "quarantineReasonCounts",
      "matchMethodCounts",
      "ineligibleReasonCounts",
      "holdReasonCounts",
    ];
    for (const [index, target] of emptyMapTargets.entries()) {
      const response = structuredClone(validResponse());
      Reflect.set(target(response), mapNames[index], {});
      rejects(response);
    }

    const unresolved = structuredClone(validResponse());
    Reflect.set(unresolved.preview.merchantIdentityDiagnostics, "unresolvedReasonCounts", {});
    rejects(unresolved);
  });

  await t.test("malformed displayed counts fail closed", () => {
    for (const malformed of [-1, 1.5, Number.POSITIVE_INFINITY]) {
      const response = structuredClone(validResponse());
      Reflect.set(response.preview.proposedActions.counts.offers, "unresolved", malformed);
      rejects(response);
    }
  });

  await t.test("malformed required reason-map counts fail closed", () => {
    const response = structuredClone(validResponse());
    Reflect.set(
      response.preview.merchantIdentityDiagnostics.matchMethodCounts,
      "campaign_id",
      Number.NaN,
    );
    rejects(response);
  });
});

test("parser constructs only the narrow trusted admin DTO", () => {
  const parsed = parseAffiliateSyncPreviewV2HostResponse(validResponse(), INTEGRATION_ID);
  assert.deepEqual(Object.keys(parsed.preview).sort(), [
    "deduplicationDiagnostics",
    "existingOfferIdentityDiagnostics",
    "identityIntegrityDiagnostics",
    "merchantIdentityDiagnostics",
    "normalizationDiagnostics",
    "offerQualificationDiagnostics",
    "parserDiagnostics",
    "proposedActions",
    "publishingPolicy",
    "rawFetchDiagnostics",
    "storeCoverage",
    "storeMatchDiagnostics",
  ]);
  assert.equal("provider" in parsed.preview, false);
  assert.equal("evaluationTimestamp" in parsed.preview, false);
  assert.equal("normalizedStores" in parsed.preview, false);
  assert.equal("pages" in parsed.preview.rawFetchDiagnostics.promotions, false);
});

test("representative V2 data projects directly into modal sections", () => {
  const response = parseAffiliateSyncPreviewV2HostResponse(validResponse(), INTEGRATION_ID);
  const sections = buildAffiliateSyncPreviewV2Sections(response);
  const metric = (label: string) =>
    sections.flatMap((section) => section.metrics).find((row) => row.label === label);

  assert.equal(sections[0]?.title, "Provider fetch");
  assert.equal(metric("Unique promotions")?.value, 2);
  assert.equal(metric("Normalized coupons")?.value, 1);
  assert.equal(metric("Normalized deals")?.value, 1);
  assert.equal(metric("Identity collapse detected")?.value, "None");
  assert.equal(metric("Proposed create")?.value, 1);
  assert.equal(
    sections.some((section) => section.title === "Proposed actions — all offers"),
    true,
  );
});

test("operator status uses only authoritative V2 diagnostics", async (t) => {
  const preview = () =>
    structuredClone(
      parseAffiliateSyncPreviewV2HostResponse(validResponse(), INTEGRATION_ID).preview,
    );

  await t.test("ambiguous snapshot is a red persistence blocker", () => {
    const value = preview();
    value.proposedActions.counts.stores.ambiguousSnapshot = 1;
    assert.deepEqual(getAdminV2PreviewOperatorStatus(value), {
      severity: "blocker",
      title: "V2 preview contains a persistence blocker",
      tone: "bad",
    });
  });

  await t.test("identity collapse is a red persistence blocker", () => {
    const value = preview();
    value.identityIntegrityDiagnostics.identityCollapseDetected = true;
    assert.equal(getAdminV2PreviewOperatorStatus(value).severity, "blocker");
  });

  await t.test("unresolved, quarantined, or conflicting identities are amber", () => {
    const cases = [
      (value: ReturnType<typeof preview>) => {
        value.proposedActions.counts.offers.unresolved = 1;
      },
      (value: ReturnType<typeof preview>) => {
        value.proposedActions.counts.offers.quarantined = 1;
      },
      (value: ReturnType<typeof preview>) => {
        value.deduplicationDiagnostics.identitiesWithConflictingProviderFields = 1;
      },
    ];
    for (const mutate of cases) {
      const value = preview();
      mutate(value);
      assert.equal(getAdminV2PreviewOperatorStatus(value).severity, "diagnostics");
    }
  });

  await t.test("ordinary publishing holds alone remain green", () => {
    const value = preview();
    value.publishingPolicy.diagnostics.couponsHeld = 2;
    value.proposedActions.counts.coupons.held = 2;
    value.proposedActions.counts.offers.held = 2;
    Reflect.set(value.publishingPolicy.diagnostics.holdReasonCounts, "over_coupon_limit", 2);
    assert.equal(getAdminV2PreviewOperatorStatus(value).severity, "clean");
  });

  await t.test("clean preview is green", () => {
    assert.deepEqual(getAdminV2PreviewOperatorStatus(preview()), {
      severity: "clean",
      title: "V2 preview completed",
      tone: "ok",
    });
  });
});

test("admin source keeps V2 preview and legacy import architectures separate", () => {
  const read = (relativePath: string) =>
    readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const route = read("../routes/admin.integrations.tsx");
  const client = read("./affiliate-sync-v2-preview.client.ts");
  const contract = read("./affiliate-sync-v2-preview.ts");
  const modal = read("../components/admin/v2-preview-result-modal.tsx");
  const legacyModal = read("../components/admin/import-result-modal.tsx");
  const legacySync = read("./sync-execution.functions.ts");

  const previewStart = route.indexOf("const runV2Preview");
  const previewEnd = route.indexOf("// Derived summary", previewStart);
  assert.notEqual(previewStart, -1);
  assert.notEqual(previewEnd, -1);
  const previewPath = route.slice(previewStart, previewEnd);

  assert.match(previewPath, /previewAffiliateSyncV2\(rec\.id\)/);
  assert.doesNotMatch(previewPath, /runProviderSync|legacySyncFn/);
  assert.match(previewPath, /getAdminV2PreviewOperatorStatus\(response\.preview\)/);
  assert.match(
    previewPath,
    /status\.severity === "blocker"[\s\S]*toast\.error\(status\.title\)/,
  );
  assert.match(
    previewPath,
    /status\.severity === "diagnostics"[\s\S]*toast\.warning\(status\.title\)/,
  );
  assert.match(previewPath, /else toast\.success\(status\.title\)/);
  assert.doesNotMatch(previewPath, /toast\.success\("V2 preview completed"\)/);
  assert.match(route, /toast\.success\("Legacy import completed"\)/);
  assert.match(route, /createClientOnlyFn\(async \(integrationId: string\)/);
  assert.match(route, /import\("@\/lib\/affiliate-sync-v2-preview\.client"\)/);
  assert.doesNotMatch(route, /from "@\/lib\/affiliate-sync-v2-preview\.client"/);
  assert.match(route, /legacySyncFn\(\{ data: \{ integrationId: rec\.id, preview: false \} \}\)/);
  assert.match(route, />\s*V2 Preview\s*</);
  assert.match(route, />\s*Legacy Import \(V1\)\s*</);

  assert.match(client, /supabase\.functions\.invoke\(functionName, options\)/);
  assert.match(contract, /"affiliate-sync-preview-v2" as const/);
  assert.doesNotMatch(contract, /value is AffiliateSyncPreviewV2\b/);
  assert.doesNotMatch(contract, /preview: AffiliateSyncPreviewV2;/);
  assert.doesNotMatch(contract, /affiliate-sync-v2\/models\.ts/);
  for (const source of [client, contract, modal]) {
    assert.doesNotMatch(
      source,
      /affiliate-sync-apply-v2|SyncRunReport|runProviderSync|execute\s*:\s*true/,
    );
    assert.doesNotMatch(source, /\.(?:from|insert|upsert|update|delete)\s*\(/);
  }

  assert.match(modal, /response: AdminV2PreviewHostResponse \| null/);
  assert.match(modal, /identityIntegrityDiagnostics\.identityCollapseDetected/);
  assert.match(modal, /getAdminV2PreviewOperatorStatus\(response\.preview\)/);
  assert.match(modal, /buildAffiliateSyncPreviewV2Sections\(response\)/);
  assert.doesNotMatch(modal, /affiliate-sync-core|ImportPlan|ImportResult|SyncResult/);

  assert.doesNotMatch(legacyModal, /Affiliate Sync V2/);
  assert.match(legacyModal, /Legacy Affiliate Sync V1 Preview/);

  assert.match(legacySync, /createServerSyncEngine/);
  assert.match(legacySync, /engine\.run\(\)/);
  assert.match(legacySync, /runImport\(sync/);
  assert.match(legacySync, /projectSync\(report, sync\)/);
  assert.match(legacySync, /projectImport\(report, sync, body\)/);
});
