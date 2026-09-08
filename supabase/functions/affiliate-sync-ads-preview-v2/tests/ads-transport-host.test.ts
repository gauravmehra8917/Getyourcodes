import assert from "node:assert/strict";
import test from "node:test";
import type { HostFetchV2 } from "../../_shared/affiliate-sync-v2-host/ImpactTransportHost.ts";
import { ImpactAdsTransportHost } from "../ads-transport-host.ts";

const credentials = {
  accountSid: "account-sensitive",
  authToken: "token-sensitive",
};

test("transport delegates IR-Version 15 and attaches credentials only on approved origin", async () => {
  const observations: Array<{ url: string; headers: Headers }> = [];
  const fetchImplementation: HostFetchV2 = async (input, init) => {
    observations.push({
      url: String(input),
      headers: new Headers(init?.headers),
    });
    return new Response("{}", {
      status: 200,
      headers: {
        "X-RateLimit-Limit": "1000",
        "X-RateLimit-Remaining": "999",
        "X-RateLimit-Reset": "60",
      },
    });
  };
  const transport = new ImpactAdsTransportHost({
    credentials,
    approvedCredentialOrigin: "https://api.impact.com",
    maxResponseBytes: 1024,
    fetchImplementation,
  });

  const sameOrigin = await transport.execute({
    method: "GET",
    url: "https://api.impact.com/Mediapartners/account-sensitive/Ads",
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  assert.equal(sameOrigin.kind, "response");
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.headers.get("IR-Version"), "15");
  assert.match(observations[0]?.headers.get("Authorization") ?? "", /^Basic /);

  const omitted = await transport.execute({
    method: "GET",
    url: "https://continuation.impact.com/page/2",
    credentialDisposition: "omit",
    redirect: "error",
  });
  assert.equal(omitted.kind, "response");
  assert.equal(observations.length, 2);
  assert.equal(observations[1]?.headers.has("Authorization"), false);
  assert.deepEqual(transport.readRateSnapshot(), {
    limit: 1000,
    remaining: 999,
    reset: 60,
  });
});

test("same-origin credential disposition rejects cross-origin transport before fetch", async () => {
  let fetches = 0;
  const transport = new ImpactAdsTransportHost({
    credentials,
    approvedCredentialOrigin: "https://api.impact.com",
    maxResponseBytes: 1024,
    fetchImplementation: async () => {
      fetches += 1;
      return new Response("{}");
    },
  });
  const result = await transport.execute({
    method: "GET",
    url: "https://evil.example/page/2",
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  assert.deepEqual(result, {
    kind: "transport_error",
    errorCode: "credential_origin_mismatch",
  });
  assert.equal(fetches, 0);
});

test("streaming response cap aborts oversized bodies with a fixed classification", async () => {
  const transport = new ImpactAdsTransportHost({
    credentials,
    approvedCredentialOrigin: "https://api.impact.com",
    maxResponseBytes: 4,
    fetchImplementation: async () => new Response("12345"),
  });
  const result = await transport.execute({
    method: "GET",
    url: "https://api.impact.com/Mediapartners/account-sensitive/Ads",
    credentialDisposition: "attach_if_same_origin",
    redirect: "error",
  });
  assert.equal(result.kind, "transport_error");
  assert.equal(transport.consumeResponseSizeLimitExceeded(), true);
  assert.equal(transport.consumeResponseSizeLimitExceeded(), false);
  assert.equal(JSON.stringify(result).includes(credentials.authToken), false);
});

test("malformed rate headers are bounded to null and do not erase unmentioned fields", async () => {
  let request = 0;
  const transport = new ImpactAdsTransportHost({
    credentials,
    approvedCredentialOrigin: "https://api.impact.com",
    maxResponseBytes: 1024,
    fetchImplementation: async () => {
      request += 1;
      return request === 1
        ? new Response("{}", {
          headers: {
            "X-RateLimit-Limit": "100",
            "X-RateLimit-Remaining": "90",
          },
        })
        : new Response("{}", {
          headers: { "X-RateLimit-Remaining": "secret-not-a-number" },
        });
    },
  });
  const input = {
    method: "GET" as const,
    url: "https://api.impact.com/Mediapartners/account-sensitive/Ads",
    credentialDisposition: "attach_if_same_origin" as const,
    redirect: "error" as const,
  };
  await transport.execute(input);
  assert.deepEqual(transport.readRateSnapshot(), {
    limit: 100,
    remaining: 90,
    reset: null,
  });
  await transport.execute(input);
  assert.deepEqual(transport.readRateSnapshot(), {
    limit: 100,
    remaining: null,
    reset: null,
  });
});
