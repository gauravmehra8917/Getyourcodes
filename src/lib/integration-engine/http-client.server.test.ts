import assert from "node:assert/strict";
import test from "node:test";
import { executeRequest } from "./http-client.server.ts";
import type { IntegrationConfig } from "./types";

const config: IntegrationConfig = {
  id: "integration",
  name: "Test integration",
  providerName: "impact",
  providerType: "impact",
  authenticationType: "custom_headers",
  baseUrl: "https://api.example.test",
  timeoutMs: 1_000,
  retryAttempts: 0,
  customHeaders: [],
  endpoints: {},
  environment: "test",
  isEnabled: true,
  credentials: {},
};

test("server request logging is composed after the runtime-neutral response", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs: unknown[] = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  console.log = (...args: unknown[]) => { logs.push(args[0]); };
  try {
    const response = await executeRequest(config, { method: "GET", path: "/campaigns", persistLog: false });
    assert.deepEqual(response.body, { ok: true });
    assert.equal(response.success, true);
    assert.equal(
      logs.filter((entry) => typeof entry === "string" && entry.startsWith("[integration-engine] ")).length,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});
