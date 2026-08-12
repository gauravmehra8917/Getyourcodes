import assert from "node:assert/strict";
import test from "node:test";
import type {
  ImpactTransport,
  ImpactTransportRequest,
  ImpactTransportResult,
} from "../../_shared/affiliate-sync-v2/index.ts";
import {
  loadExistingCatalogSnapshotV2,
  mapExistingCatalogSnapshotV2,
} from "../catalog-snapshot.ts";
import { createAffiliateSyncPreviewV2Handler } from "../handler.ts";
import {
  HostConfigurationError,
  parseImpactHostCredentials,
  resolveImpactHostConfig,
} from "../impact-configuration.ts";
import {
  ImpactTransportHost,
  parseRetryAfterMs,
} from "../ImpactTransportHost.ts";
import type {
  PreviewV2DataSource,
  PreviewV2HostDependencies,
  StoredIntegrationV2,
  StoredPublishingPolicyV2,
} from "../types.ts";

const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_SID = "account-sensitive";
const AUTH_TOKEN = "token-sensitive";
const CIPHERTEXT = "ciphertext-sensitive";

const healthyIntegration: StoredIntegrationV2 = {
  id: INTEGRATION_ID,
  providerName: "Impact.com",
  authenticationType: "basic",
  baseUrl: "https://api.impact.com",
  endpointConfiguration: {
    stores: "/Mediapartners/{AccountSID}/Campaigns",
    deals: "/Mediapartners/{AccountSID}/Promotions",
  },
  isEnabled: true,
  timeoutSeconds: 30,
  retryAttempts: 0,
  pageSize: 100,
  maxPages: 10,
  publishingPolicyId: null,
};

const policy: StoredPublishingPolicyV2 = {
  enabled: true,
  minimumCouponsPerStore: 0,
  maximumCouponsPerStore: 0,
  minimumDealsPerStore: 0,
  maximumDealsPerStore: 0,
};

const promotionsPage = {
  "@page": "1",
  "@pagesize": "100",
  Promotions: [
    {
      PromotionIds: "promotion-acme-coupon",
      AdvertiserId: "advertiser-acme",
      AdvertiserName: "Acme",
      CampaignId: "campaign-acme",
      PromotionTitle: "Acme 10% off",
      GenericRedemptionCode: "ACME10",
      StartDate: "2026-01-01T00:00:00Z",
      EndDate: "2026-12-31T23:59:59Z",
      Uri: `/Mediapartners/${ACCOUNT_SID}/Promotions/promotion-acme-coupon`,
    },
    {
      PromotionIds: "promotion-bravo-deal",
      AdvertiserId: "advertiser-bravo",
      AdvertiserName: "Bravo",
      CampaignId: "campaign-bravo",
      PromotionTitle: "Bravo free shipping",
      StartDate: "2026-01-01T00:00:00Z",
      EndDate: "2026-12-31T23:59:59Z",
    },
  ],
};

const campaignsPage = {
  "@page": "1",
  "@pagesize": "100",
  Campaigns: [
    {
      CampaignId: "campaign-acme",
      AdvertiserId: "advertiser-acme",
      CampaignName: "Acme",
      Uri: `/Mediapartners/${ACCOUNT_SID}/Campaigns/campaign-acme`,
    },
    {
      CampaignId: "campaign-bravo",
      AdvertiserId: "advertiser-bravo",
      CampaignName: "Bravo",
    },
  ],
};

class PageTransport implements ImpactTransport {
  readonly requests: ImpactTransportRequest[] = [];
  readonly waits: number[] = [];
  private readonly mode: "healthy" | "transport_error" | "malformed";

  constructor(mode: "healthy" | "transport_error" | "malformed" = "healthy") {
    this.mode = mode;
  }

  async execute(
    request: ImpactTransportRequest,
  ): Promise<ImpactTransportResult> {
    this.requests.push(request);
    if (this.mode === "transport_error") {
      return { kind: "transport_error", errorCode: "fixture_failure" };
    }
    const promotions = request.url.includes("/Promotions");
    return {
      kind: "response",
      status: 200,
      bodyText: JSON.stringify(
        this.mode === "malformed" && promotions
          ? { Ads: [] }
          : promotions
          ? promotionsPage
          : campaignsPage,
      ),
      retryAfterMs: null,
    };
  }

  async wait(delayMs: number): Promise<void> {
    this.waits.push(delayMs);
  }
}

class FakeDataSource implements PreviewV2DataSource {
  readonly operations: string[] = [];
  admin = true;
  integration: StoredIntegrationV2 | null = structuredClone(healthyIntegration);
  ciphertext: string | null = CIPHERTEXT;
  publishingPolicy: StoredPublishingPolicyV2 | null = structuredClone(policy);
  stores = [{ id: "store-acme", providerEntityId: "campaign-acme" }];
  offers = [{ id: "offer-acme", providerEntityId: "promotion-acme-coupon" }];
  failCatalog = false;

  async hasAdminRole(): Promise<boolean> {
    this.operations.push("read:user_roles");
    return this.admin;
  }

  async readIntegration(): Promise<StoredIntegrationV2 | null> {
    this.operations.push("read:affiliate_integrations");
    return this.integration;
  }

  async readCredentialCiphertext(): Promise<string | null> {
    this.operations.push("read:affiliate_integration_credentials");
    return this.ciphertext;
  }

  async readPublishingPolicy(): Promise<StoredPublishingPolicyV2 | null> {
    this.operations.push("read:publishing_policies");
    return this.publishingPolicy;
  }

  async readImpactStoreIdentityRows() {
    this.operations.push("read:stores");
    if (this.failCatalog) {
      throw new Error("catalog failure containing token-sensitive");
    }
    return this.stores;
  }

  async readImpactOfferIdentityRows() {
    this.operations.push("read:coupons");
    if (this.failCatalog) {
      throw new Error("catalog failure containing account-sensitive");
    }
    return this.offers;
  }
}

function dependencies(input: {
  dataSource?: FakeDataSource;
  user?: { id: string } | null;
  transport?: PageTransport;
  decrypt?: (ciphertext: string) => Promise<string>;
} = {}): {
  deps: PreviewV2HostDependencies;
  dataSource: FakeDataSource;
  transport: PageTransport;
  verified: string[];
} {
  const dataSource = input.dataSource ?? new FakeDataSource();
  const transport = input.transport ?? new PageTransport();
  const verified: string[] = [];
  return {
    dataSource,
    transport,
    verified,
    deps: {
      async verifyUser(authorization, jwt) {
        verified.push(`${authorization}:${jwt}`);
        return input.user === undefined ? { id: "admin-user" } : input.user;
      },
      createDataSource: () => dataSource,
      decryptCredentialEnvelope: input.decrypt ?? (async (ciphertext) => {
        assert.equal(ciphertext, CIPHERTEXT);
        return JSON.stringify({ username: ACCOUNT_SID, password: AUTH_TOKEN });
      }),
      createImpactTransport: (credentials, origin) => {
        assert.deepEqual(credentials, {
          accountSid: ACCOUNT_SID,
          authToken: AUTH_TOKEN,
        });
        assert.equal(origin, "https://api.impact.com");
        return transport;
      },
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      siteUrl: "https://admin.example",
    },
  };
}

function previewRequest(
  body: unknown = { integrationId: INTEGRATION_ID, preview: true },
  authorization = "Bearer verified-jwt",
): Request {
  return new Request("https://edge.example/affiliate-sync-preview-v2", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

test("rejects missing JWT before privileged access", async () => {
  const fixture = dependencies();
  const response = await createAffiliateSyncPreviewV2Handler(fixture.deps)(
    previewRequest(undefined, ""),
  );
  assert.equal(response.status, 401);
  assert.equal((await responseBody(response)).error instanceof Object, true);
  assert.deepEqual(fixture.verified, []);
  assert.deepEqual(fixture.dataSource.operations, []);
});

test("rejects a verified non-admin and accepts an admin", async () => {
  const forbidden = dependencies();
  forbidden.dataSource.admin = false;
  const rejected = await createAffiliateSyncPreviewV2Handler(forbidden.deps)(
    previewRequest(),
  );
  assert.equal(rejected.status, 403);
  assert.deepEqual(forbidden.dataSource.operations, ["read:user_roles"]);

  const accepted = dependencies();
  const response = await createAffiliateSyncPreviewV2Handler(accepted.deps)(
    previewRequest(),
  );
  assert.equal(response.status, 200);
  assert.equal(accepted.verified.length, 1);
});

test("validates the narrow method and request contract", async () => {
  const fixture = dependencies();
  const handler = createAffiliateSyncPreviewV2Handler(fixture.deps);
  const get = await handler(
    new Request("https://edge.example", { method: "GET" }),
  );
  assert.equal(get.status, 405);
  const options = await handler(
    new Request("https://edge.example", { method: "OPTIONS" }),
  );
  assert.equal(options.status, 204);
  assert.equal(await options.text(), "");
  const extra = await handler(
    previewRequest({
      integrationId: INTEGRATION_ID,
      preview: true,
      accountSid: "supplied",
    }),
  );
  assert.equal(extra.status, 400);
  const notPreview = await handler(
    previewRequest({ integrationId: INTEGRATION_ID, preview: false }),
  );
  assert.equal(notPreview.status, 400);
});

test("classifies missing, disabled, and non-Impact integrations without credential leakage", async () => {
  const missing = dependencies();
  missing.dataSource.integration = null;
  assert.equal(
    (await createAffiliateSyncPreviewV2Handler(missing.deps)(previewRequest()))
      .status,
    404,
  );

  const disabled = dependencies();
  disabled.dataSource.integration = { ...healthyIntegration, isEnabled: false };
  assert.equal(
    (await createAffiliateSyncPreviewV2Handler(disabled.deps)(previewRequest()))
      .status,
    409,
  );

  const wrongProvider = dependencies();
  wrongProvider.dataSource.integration = {
    ...healthyIntegration,
    providerName: "Awin",
  };
  const response = await createAffiliateSyncPreviewV2Handler(
    wrongProvider.deps,
  )(previewRequest());
  assert.equal(response.status, 422);
  const serialized = JSON.stringify(await responseBody(response));
  assert.equal(serialized.includes(ACCOUNT_SID), false);
  assert.equal(serialized.includes(AUTH_TOKEN), false);
  assert.equal(
    wrongProvider.dataSource.operations.includes(
      "read:affiliate_integration_credentials",
    ),
    false,
  );
});

test("classifies invalid stored endpoints and unavailable credentials", async () => {
  const invalid = dependencies();
  invalid.dataSource.integration = {
    ...healthyIntegration,
    endpointConfiguration: { deals: "https://evil.example/Promotions" },
  };
  const invalidResponse = await createAffiliateSyncPreviewV2Handler(
    invalid.deps,
  )(previewRequest());
  assert.equal(invalidResponse.status, 422);
  assert.equal(
    (await responseBody(invalidResponse)).error instanceof Object,
    true,
  );

  const missing = dependencies();
  missing.dataSource.ciphertext = null;
  const missingResponse = await createAffiliateSyncPreviewV2Handler(
    missing.deps,
  )(previewRequest());
  assert.equal(missingResponse.status, 422);

  const failed = dependencies({
    decrypt: async () => {
      throw new Error(`decrypt failed ${AUTH_TOKEN}`);
    },
  });
  const failedResponse = await createAffiliateSyncPreviewV2Handler(failed.deps)(
    previewRequest(),
  );
  const serialized = JSON.stringify(await responseBody(failedResponse));
  assert.equal(failedResponse.status, 422);
  assert.equal(serialized.includes(AUTH_TOKEN), false);
  assert.equal(serialized.includes(CIPHERTEXT), false);
});

test("classifies catalog, provider, and malformed-page failures with sanitized errors", async () => {
  const catalog = dependencies();
  catalog.dataSource.failCatalog = true;
  const catalogResponse = await createAffiliateSyncPreviewV2Handler(
    catalog.deps,
  )(previewRequest());
  assert.equal(catalogResponse.status, 500);
  assert.equal(
    JSON.stringify(await responseBody(catalogResponse)).includes(AUTH_TOKEN),
    false,
  );

  const provider = dependencies({
    transport: new PageTransport("transport_error"),
  });
  const providerResponse = await createAffiliateSyncPreviewV2Handler(
    provider.deps,
  )(previewRequest());
  assert.equal(providerResponse.status, 502);

  const malformed = dependencies({ transport: new PageTransport("malformed") });
  const malformedResponse = await createAffiliateSyncPreviewV2Handler(
    malformed.deps,
  )(previewRequest());
  assert.equal(malformedResponse.status, 502);
  const error = (await responseBody(malformedResponse)).error as Record<
    string,
    unknown
  >;
  assert.equal(error.code, "malformed_provider_response");
});

test("healthy multi-brand host preview preserves independent campaign stores and performs reads only", async () => {
  const fixture = dependencies();
  const response = await createAffiliateSyncPreviewV2Handler(fixture.deps)(
    previewRequest(),
  );
  assert.equal(response.status, 200);
  const body = await responseBody(response);
  const preview = body.preview as Record<string, unknown>;
  const integrity = preview.identityIntegrityDiagnostics as Record<
    string,
    unknown
  >;
  assert.equal(integrity.distinctResolvedProviderStoreKeys, 2);
  assert.equal(integrity.identityCollapseDetected, false);
  const stores = preview.normalizedStores as Array<Record<string, unknown>>;
  assert.deepEqual(
    stores.map((store) =>
      (store.providerStoreKey as Record<string, unknown>).id
    ).sort(),
    ["campaign-acme", "campaign-bravo"],
  );
  assert.deepEqual(fixture.dataSource.operations, [
    "read:user_roles",
    "read:affiliate_integrations",
    "read:affiliate_integration_credentials",
    "read:publishing_policies",
    "read:stores",
    "read:coupons",
  ]);
  assert.equal(
    fixture.dataSource.operations.some((operation) =>
      /write|insert|update|delete|upsert|rpc/i.test(operation)
    ),
    false,
  );
  const serialized = JSON.stringify(body);
  for (const secret of [ACCOUNT_SID, AUTH_TOKEN, CIPHERTEXT, "verified-jwt"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("snapshot loader preserves exact keys, PromotionIds, and ambiguity without fuzzy fallback", async () => {
  const storeRows = [
    { id: "store-one", providerEntityId: "campaign-exact" },
    { id: "store-two", providerEntityId: "campaign-exact" },
    { id: "store-name-only", providerEntityId: null, name: "campaign-exact" },
  ];
  const offerRows = [
    { id: "offer-one", providerEntityId: "promotion-exact" },
    {
      id: "offer-title-only",
      providerEntityId: null,
      title: "promotion-exact",
    },
  ];
  const snapshot = mapExistingCatalogSnapshotV2(
    storeRows,
    offerRows,
  );
  assert.deepEqual(snapshot, {
    stores: [
      {
        id: "store-one",
        providerStoreKey: {
          provider: "impact",
          namespace: "campaign",
          id: "campaign-exact",
        },
      },
      {
        id: "store-two",
        providerStoreKey: {
          provider: "impact",
          namespace: "campaign",
          id: "campaign-exact",
        },
      },
    ],
    offers: [{ id: "offer-one", promotionId: "promotion-exact" }],
  });

  const reader = new FakeDataSource();
  reader.stores = [
    { id: "store-one", providerEntityId: "campaign-exact" },
    { id: "store-two", providerEntityId: "campaign-exact" },
  ];
  const loaded = await loadExistingCatalogSnapshotV2(reader);
  assert.equal(loaded.stores.length, 2);
});

test("credential and integration mapping are explicit and reject ambiguity", () => {
  assert.deepEqual(
    parseImpactHostCredentials(
      JSON.stringify({ accountSid: "sid", authToken: "token" }),
    ),
    { accountSid: "sid", authToken: "token" },
  );
  assert.throws(
    () =>
      parseImpactHostCredentials(
        JSON.stringify({
          accountSid: "one",
          username: "two",
          authToken: "token",
        }),
      ),
    HostConfigurationError,
  );
  const resolved = resolveImpactHostConfig(
    healthyIntegration,
    { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN },
    policy,
  );
  assert.equal(
    resolved.promotionsInitialUrl.includes(encodeURIComponent(ACCOUNT_SID)),
    true,
  );
  assert.deepEqual(resolved.continuationPolicy.allowedOrigins, [
    "https://api.impact.com",
  ]);
  assert.equal(resolved.limits.maxPages, 10);
});

test("host transport attaches Basic auth only on approved same-origin requests", async () => {
  const observations: Array<
    {
      url: string;
      authorization: string | null;
      redirect: RequestRedirect | undefined;
    }
  > = [];
  const transport = new ImpactTransportHost({
    credentials: { accountSid: "sid", authToken: "token" },
    approvedCredentialOrigin: "https://api.impact.com",
    fetchImplementation: async (input, init) => {
      observations.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("Authorization"),
        redirect: init?.redirect,
      });
      return new Response("{}", { status: 200 });
    },
  });
  await transport.execute({
    method: "GET",
    url: "https://api.impact.com/Promotions",
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  await transport.execute({
    method: "GET",
    url: "https://api-us.impact.com/Promotions",
    credentialDisposition: "omit",
    redirect: "error",
  });
  assert.match(observations[0]!.authorization ?? "", /^Basic /);
  assert.equal(observations[0]!.redirect, "error");
  assert.equal(observations[1]!.authorization, null);
  const mismatch = await transport.execute({
    method: "GET",
    url: "https://evil.example/Promotions",
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  assert.deepEqual(mismatch, {
    kind: "transport_error",
    errorCode: "credential_origin_mismatch",
  });
  assert.equal(observations.length, 2);
});

test("host transport maps Retry-After, redirect policy, injected waits, aborts, and timeouts", async () => {
  assert.equal(parseRetryAfterMs("2.5", 0), 2_500);
  assert.equal(
    parseRetryAfterMs(
      "Wed, 21 Oct 2015 07:28:00 GMT",
      Date.parse("Wed, 21 Oct 2015 07:27:58 GMT"),
    ),
    2_000,
  );
  const waits: number[] = [];
  const response = new Response("retry", {
    status: 429,
    headers: { "Retry-After": "3" },
  });
  const retrying = new ImpactTransportHost({
    credentials: { accountSid: "sid", authToken: "token" },
    approvedCredentialOrigin: "https://api.impact.com",
    fetchImplementation: async (_input, init) => {
      assert.equal(init?.redirect, "error");
      return response;
    },
    waitImplementation: async (delay) => {
      waits.push(delay);
    },
    now: () => 0,
  });
  const result = await retrying.execute({
    method: "GET",
    url: "https://api.impact.com/Promotions",
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  assert.equal(result.kind === "response" ? result.retryAfterMs : null, 3_000);
  await retrying.wait(750);
  assert.deepEqual(waits, [750]);

  const redirectedResponse = new Response("redirected", { status: 200 });
  Object.defineProperty(redirectedResponse, "redirected", { value: true });
  const redirecting = new ImpactTransportHost({
    credentials: { accountSid: "sid", authToken: "token" },
    approvedCredentialOrigin: "https://api.impact.com",
    fetchImplementation: async () => redirectedResponse,
  });
  assert.deepEqual(
    await redirecting.execute({
      method: "GET",
      url: "https://api.impact.com/Promotions",
      credentialDisposition: "attach_if_same_origin",
      redirect: "error",
    }),
    { kind: "transport_error", errorCode: "redirect_rejected" },
  );

  const controller = new AbortController();
  controller.abort();
  const aborting = new ImpactTransportHost({
    credentials: { accountSid: "sid", authToken: "token" },
    approvedCredentialOrigin: "https://api.impact.com",
    fetchImplementation: async () => {
      throw new DOMException("secret", "AbortError");
    },
  });
  assert.deepEqual(
    await aborting.execute({
      method: "GET",
      url: "https://api.impact.com/Promotions",
      credentialDisposition: "attach_if_same_origin",
      redirect: "error",
      signal: controller.signal,
    }),
    { kind: "aborted", errorCode: "request_aborted" },
  );
  const timingOut = new ImpactTransportHost({
    credentials: { accountSid: "sid", authToken: "token" },
    approvedCredentialOrigin: "https://api.impact.com",
    fetchImplementation: async () => {
      throw new DOMException("secret", "TimeoutError");
    },
  });
  assert.deepEqual(
    await timingOut.execute({
      method: "GET",
      url: "https://api.impact.com/Promotions",
      credentialDisposition: "attach_if_same_origin",
      redirect: "error",
    }),
    { kind: "timeout", errorCode: "request_timeout" },
  );
});
