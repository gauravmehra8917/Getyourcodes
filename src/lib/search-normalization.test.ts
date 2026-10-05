import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSearchTerm } from "./search-normalization.ts";

test("search trims whitespace and removes LIKE wildcard characters", () => {
  assert.equal(normalizeSearchTerm(" \n Acme %_ Deals \t "), "Acme  Deals");
  assert.equal(normalizeSearchTerm("50% off_brand"), "50 offbrand");
  assert.equal(normalizeSearchTerm("Health & Beauty / 家居"), "Health & Beauty / 家居");
});

test("empty and wildcard-only searches normalize to empty", () => {
  for (const value of ["", " \n\t ", "%", "_", " % _ %% __ "]) {
    assert.equal(normalizeSearchTerm(value), "");
  }
});

test("search is bounded to 100 characters and normalization is stable", () => {
  const normalized = normalizeSearchTerm(` % ${"a".repeat(100)} tail_% `);
  assert.equal(normalized, "a".repeat(100));
  assert.equal(normalizeSearchTerm(normalized), normalized);
  assert.equal(normalizeSearchTerm(`${"a".repeat(99)} tail`), "a".repeat(99));
});
