import assert from "node:assert/strict";
import test from "node:test";
import { encryptCredentials } from "../../../src/lib/integration-crypto.server.ts";
import { decryptCredentialsWebCrypto } from "./integration-crypto.ts";
import { resolvePrivilegedEdgeKey } from "./edge-credentials.ts";

test("Web Crypto decrypts the existing Node AES-GCM credential envelope", async () => {
  const priorSecret = process.env.INTEGRATION_CREDENTIAL_SECRET;
  const secret = "edge-compatibility-test-secret";
  const plaintext = JSON.stringify({ apiKey: "test-key", accessToken: "test-token" });
  try {
    process.env.INTEGRATION_CREDENTIAL_SECRET = secret;
    const ciphertextProducedByNode = encryptCredentials(plaintext);
    assert.equal(
      await decryptCredentialsWebCrypto(ciphertextProducedByNode, secret),
      plaintext,
    );
  } finally {
    if (priorSecret === undefined) delete process.env.INTEGRATION_CREDENTIAL_SECRET;
    else process.env.INTEGRATION_CREDENTIAL_SECRET = priorSecret;
  }
});

test("the platform secret-key map wins over the hosted legacy fallback", () => {
  const environment = (name: string) => ({
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: "platform-secret" }),
    SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role",
  }[name] ?? null);
  assert.equal(resolvePrivilegedEdgeKey(environment), "platform-secret");
});

test("the legacy service-role key remains a compatibility fallback", () => {
  const environment = (name: string) => ({ SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role" }[name] ?? null);
  assert.equal(resolvePrivilegedEdgeKey(environment), "legacy-service-role");
});
