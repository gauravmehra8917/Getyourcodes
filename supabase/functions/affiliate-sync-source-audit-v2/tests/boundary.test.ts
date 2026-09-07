import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname ?? ".", "../../../..");
const SUPABASE_ROOT = resolve(ROOT, "supabase");
const HOST_ROOT = resolve(
  ROOT,
  "supabase/functions/affiliate-sync-source-audit-v2",
);
const ENTRY = resolve(HOST_ROOT, "index.ts");

function runtimeImportsOf(source: string): string[] {
  const imports: string[] = [];
  for (
    const match of source.matchAll(
      /(?:^|\n)\s*((?:import|export)\s+[^;]*?\s+from\s+|import\s*)["']([^"']+)["']\s*;/g,
    )
  ) {
    const statement = match[0];
    if (/^\s*import\s+type\b/.test(statement)) continue;
    imports.push(match[2]!);
  }
  return imports;
}

function productionClosure(): Map<string, string> {
  const pending = [ENTRY];
  const visited = new Map<string, string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    assert.equal(
      file.startsWith(`${SUPABASE_ROOT}${sep}`),
      true,
      `production import escaped supabase: ${file}`,
    );
    const source = readFileSync(file, "utf8");
    visited.set(file, source);
    for (const specifier of runtimeImportsOf(source)) {
      if (specifier.startsWith("https://")) continue;
      assert.equal(
        specifier.startsWith("."),
        true,
        `unsupported import ${specifier}`,
      );
      assert.equal(
        specifier.endsWith(".ts"),
        true,
        `missing .ts extension: ${specifier}`,
      );
      const next = resolve(dirname(file), specifier);
      assert.equal(
        statSync(next).isFile(),
        true,
        `missing local module: ${next}`,
      );
      pending.push(next);
    }
  }
  return visited;
}

test("deployable audit runtime closure is Deno-safe and fully resolved", () => {
  const closure = productionClosure();
  assert.equal(closure.has(ENTRY), true);
  assert.equal(
    closure.has(resolve(HOST_ROOT, "ImpactCouponAdsAuditClient.ts")),
    true,
  );
  assert.equal(
    closure.has(resolve(HOST_ROOT, "supabase-read-boundary.ts")),
    true,
  );
  for (const [file, source] of closure) {
    assert.equal(source.includes("src/"), false, `${file} imports src`);
    assert.equal(source.includes("@/"), false, `${file} imports alias`);
    assert.equal(source.includes("node:"), false, `${file} imports Node`);
    assert.equal(/\bprocess\b/.test(source), false, `${file} uses process`);
    assert.equal(/\bBuffer\b/.test(source), false, `${file} uses Buffer`);
    assert.equal(
      /\bDeno\.(?:chdir|chmod|chown|copyFile|create|cwd|link|lstat|makeTemp|mkdir|open|readDir|readFile|readLink|realPath|remove|rename|stat|symlink|truncate|writeFile)\b/
        .test(source),
      false,
      `${file} uses Deno filesystem APIs`,
    );
    assert.equal(
      /\bimport\s*\(/.test(source),
      false,
      `${file} uses dynamic import`,
    );
  }
});

test("complete production closure has no database mutation or persistence path", () => {
  const closure = productionClosure();
  const combined = [...closure.values()].join("\n");
  for (
    const prohibited of [
      /\.\s*(?:insert|update|upsert|delete|rpc)\s*(?:\?\.)?\s*\(/,
      /\[\s*["'](?:insert|update|upsert|delete|rpc)["']\s*\]\s*(?:\?\.)?\s*\(/,
    ]
  ) {
    assert.equal(
      prohibited.test(combined),
      false,
      `mutation primitive ${prohibited}`,
    );
  }
  for (
    const prohibited of [
      "affiliate_import_runs",
      "affiliate_import_run_mutations_v2",
      "publishing_rotation_state",
      "request_log",
      "apply_affiliate_persistence_plan_v2",
      "ImportExecutor",
    ]
  ) {
    assert.equal(
      combined.includes(prohibited),
      false,
      `persistence token ${prohibited}`,
    );
  }

  const readBoundary = readFileSync(
    resolve(HOST_ROOT, "supabase-read-boundary.ts"),
    "utf8",
  );
  const tableMatches = [...readBoundary.matchAll(
    /\.\s*from\s*\(\s*["']([^"']+)["']\s*\)/g,
  )]
    .map((match) => match[1]!)
    .sort();
  const allFromCalls = readBoundary.match(/\.\s*from\s*\(/g) ?? [];
  assert.equal(
    tableMatches.length,
    allFromCalls.length,
    "every database table selection must be one literal string",
  );
  assert.deepEqual(tableMatches, [
    "affiliate_integration_credentials",
    "affiliate_integrations",
    "user_roles",
  ]);
});

test("audit host is isolated from Preview, Apply, V1, UI and persistence modules", () => {
  const closure = productionClosure();
  const source = [...closure.values()].join("\n");
  for (
    const prohibited of [
      "affiliate-sync-preview-v2",
      "affiliate-sync-apply-v2",
      "affiliate-sync-preview/",
      "affiliate-sync-preflight",
      "affiliate-sync-core",
      "PersistencePlannerV2",
      "PreviewPlanner",
      "src/routes",
      "src/components",
      "supabase/migrations",
    ]
  ) assert.equal(source.includes(prohibited), false, prohibited);
  for (const file of closure.keys()) {
    for (
      const prohibitedPath of [
        "affiliate-sync-preview-v2",
        "affiliate-sync-apply-v2",
        "affiliate-sync-core",
        `${sep}src${sep}`,
        `${sep}migrations${sep}`,
      ]
    ) assert.equal(file.includes(prohibitedPath), false, file);
  }
  assert.equal(
    (readFileSync(ENTRY, "utf8").match(/Deno\.serve\(/g) ?? []).length,
    1,
  );
});

test("audit production source contains no logging or raw-response serialization path", () => {
  const source = [...productionClosure().values()].join("\n");
  for (
    const prohibited of [
      "console.",
      "rawEnvelope",
      "continuationUrl:",
      "providerMessage",
      "stack",
    ]
  ) assert.equal(source.includes(prohibited), false, prohibited);
});

test("function config opts into explicit in-host JWT verification only", () => {
  const config = readFileSync(resolve(SUPABASE_ROOT, "config.toml"), "utf8");
  const section = config.match(
    /\[functions\.affiliate-sync-source-audit-v2\]\s*\nverify_jwt\s*=\s*(true|false)/,
  );
  assert.equal(section?.[1], "false");
  assert.equal(
    (config.match(/\[functions\.affiliate-sync-source-audit-v2\]/g) ?? [])
      .length,
    1,
  );
});
