import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthentication } from "./authentication.ts";

test("runtime-neutral Basic authentication preserves UTF-8 Node Base64 semantics", () => {
  const username = "mérchant";
  const password = "päss:秘密";
  const auth = applyAuthentication("basic", { username, password });
  const expected = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  assert.deepEqual(auth, { headers: { Authorization: `Basic ${expected}` }, query: {}, configured: true });
});
