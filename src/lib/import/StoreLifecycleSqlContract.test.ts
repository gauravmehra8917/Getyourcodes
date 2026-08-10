import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260810110000_store_lifecycle_persistence.sql", import.meta.url),
  "utf8",
);

test("store lifecycle SQL accepts only explicit writable actions", () => {
  assert.match(migration, /'create_store'/);
  assert.match(migration, /'update_store'/);
  assert.match(migration, /'lifecycle_hide_store'/);
  assert.match(migration, /'lifecycle_republish_store'/);
  assert.match(migration, /RAISE EXCEPTION 'invalid_store_lifecycle_action/);
});

test("store lifecycle SQL prevents double writes and protects unmanaged rows", () => {
  assert.match(migration, /IF _payload \? 'store_lifecycle' THEN/);
  assert.match(migration, /ELSE\n    -- Backward-compatible path for callers that predate `store_lifecycle`/);
  assert.match(migration, /store_lifecycle_unmanaged_store/);
  assert.match(migration, /store_lifecycle_not_hidden/);
  assert.match(migration, /store_lifecycle_existing_id_mismatch/);
});

test("store lifecycle SQL keeps lifecycle mutations narrow and transactional", () => {
  assert.match(migration, /SET lifecycle_hidden = true,\n            last_qualification_result = 'unqualified'/);
  assert.match(migration, /SET lifecycle_hidden = false,\n            last_qualification_result = 'qualified'/);
  assert.match(migration, /RAISE EXCEPTION 'invalid_store_lifecycle_payload'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.import_apply\(_payload jsonb\)/);
});
