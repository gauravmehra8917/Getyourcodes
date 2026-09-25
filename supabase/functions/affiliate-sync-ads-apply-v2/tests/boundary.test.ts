import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import {
  adsRefreshPersistenceRpcArgsV2,
  type ApplyAffiliateAdsRefreshPersistencePlanV2Args,
  type PreparedAdsRefreshPersistenceExecutionV2,
} from "../persistence-refresh-execution.ts";
import type { AdsApplyV2DataSource } from "../types.ts";

const ROOT = resolve(import.meta.dirname ?? ".", "../../../..");
const ENTRY = resolve(
  ROOT,
  "supabase/functions/affiliate-sync-ads-apply-v2/index.ts",
);
const HOST_ROOT = resolve(
  ROOT,
  "supabase/functions/affiliate-sync-ads-apply-v2",
);
const CONFIG = resolve(ROOT, "supabase/config.toml");

function importsOf(source: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.push(match[1]!);
  }
  return imports;
}

function localDependencyClosure(entry: string): Map<string, string> {
  const result = new Map<string, string>();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop()!;
    if (result.has(file)) continue;
    const source = readFileSync(file, "utf8");
    result.set(file, source);
    for (const specifier of importsOf(source)) {
      if (!specifier.startsWith(".")) continue;
      let dependency = resolve(dirname(file), specifier);
      if (!extname(dependency)) dependency += ".ts";
      pending.push(dependency);
    }
  }
  return result;
}

test("Ads Apply executable closure has zero V1 execution dependency", () => {
  const closure = localDependencyClosure(ENTRY);
  const forbiddenPaths = [
    "/src/",
    "/supabase/functions/_shared/affiliate-sync-core/",
    "/supabase/functions/affiliate-sync-preview/",
  ];
  const forbiddenSymbols = [
    "runProviderSync",
    "ImportPipeline",
    "ImportExecutor",
    "public.import_apply",
    "affiliate_sync_v2_apply_ads_refresh_plan_internal",
  ];
  for (const [file, source] of closure) {
    const normalized = file.replaceAll("\\", "/");
    for (const path of forbiddenPaths) {
      assert.equal(normalized.includes(path), false, `${file} enters ${path}`);
    }
    for (const symbol of forbiddenSymbols) {
      assert.equal(
        source.includes(symbol),
        false,
        `${file} references ${symbol}`,
      );
    }
  }
  assert.equal(closure.has(ENTRY), true);
  assert.equal(
    [...closure.keys()].some((file) =>
      file.includes("affiliate-sync-v2-ads-persistence")
    ),
    true,
  );
  assert.equal(
    [...closure.keys()].some((file) =>
      file.includes("affiliate-presentation-v2")
    ),
    true,
  );
});

test("host boundary exposes one named transactional RPC and no direct mutation query", () => {
  const boundaryFile = resolve(HOST_ROOT, "supabase-persistence-boundary.ts");
  const source = readFileSync(boundaryFile, "utf8");
  assert.equal(
    (source.match(/\.rpc\s*\(/g) ?? []).length,
    1,
  );
  assert.match(source, /"apply_affiliate_persistence_plan_v2"/);
  assert.match(source, /prepared: PreparedAdsRefreshPersistenceExecutionV2/);
  assert.match(source, /adsRefreshPersistenceRpcArgsV2\(prepared\)/);
  assert.ok(
    source.indexOf("adsRefreshPersistenceRpcArgsV2(prepared)") <
      source.indexOf("this.db.rpc("),
  );
  for (const mutation of [".insert(", ".update(", ".upsert(", ".delete("]) {
    assert.equal(source.includes(mutation), false);
  }
});

test("active entry uses approved refresh materialization, preparation and result validation only", () => {
  const entry = readFileSync(ENTRY, "utf8");
  const handler = readFileSync(resolve(HOST_ROOT, "handler.ts"), "utf8");
  assert.match(
    entry,
    /persistencePlan: \(input\) => materializeAdsRefreshPersistencePlanV2\(input\)/,
  );
  assert.match(
    entry,
    /prepareAdsRefreshPersistenceExecutionV2\(plan, triggeredBy\)/,
  );
  assert.match(
    handler,
    /parseAdsRefreshPersistenceSuccessV2\(value, prepared\)/,
  );
  assert.doesNotMatch(
    entry + handler,
    /prepareAdsPersistenceExecutionV2|adsPersistenceRpcArgsV2/,
  );
  assert.ok(
    handler.indexOf('if (plan.status === "blocked")') <
      handler.indexOf("dependencies.prepareExecution(plan, user.id)"),
  );
});

test("plain RPC args are not capabilities and forged objects fail the exact boundary accessor", () => {
  type BoundaryInput = Parameters<
    AdsApplyV2DataSource["applyPersistencePlan"]
  >[0];
  const onlyOpaque: BoundaryInput extends
    PreparedAdsRefreshPersistenceExecutionV2 ? true : false = true;
  const argsAssignable: ApplyAffiliateAdsRefreshPersistencePlanV2Args extends
    BoundaryInput ? true : false = false;
  const objectAssignable: Record<string, unknown> extends BoundaryInput ? true
    : false = false;
  assert.equal(onlyOpaque, true);
  assert.equal(argsAssignable, false);
  assert.equal(objectAssignable, false);
  for (
    const forged of [{}, { rpcArgs: {} }, {
      _persistence_contract_version: "v2-a11-ads-2",
    }]
  ) {
    assert.throws(() =>
      Reflect.apply(adsRefreshPersistenceRpcArgsV2, undefined, [forged])
    );
  }
});

test("handler contains no logging or browser-supplied persistence material path", () => {
  const source = readFileSync(resolve(HOST_ROOT, "handler.ts"), "utf8");
  assert.equal(
    /console\.(?:log|info|warn|error|debug)\s*\(/.test(source),
    false,
  );
  assert.equal(source.includes('request.headers.get("Authorization")'), true);
  assert.equal(source.includes("strictBearer"), true);
  assert.equal(source.includes("dataSource.hasAdminRole(user.id)"), true);
  assert.equal(
    (source.match(/dataSource\.hasAdminRole\(user\.id\)/g) ?? []).length,
    2,
  );
  assert.equal(
    (source.match(/dataSource\.applyPersistencePlan\(prepared\)/g) ?? [])
      .length,
    1,
  );
  assert.equal(source.includes("couponCode"), false);
  assert.equal(source.includes("storePlan"), false);
  assert.equal(source.includes("offerPlan"), false);
});

test("Supabase config uses handler-owned JWT verification for Ads Apply only", () => {
  const config = readFileSync(CONFIG, "utf8");
  const matches = [...config.matchAll(
    /\[functions\.affiliate-sync-ads-apply-v2\]\s*\nverify_jwt\s*=\s*(true|false)/g,
  )];
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.[1], "false");
});
