import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the real helper with a database stub; never import a live client.
function harness(track: (id: string, page: string) => Promise<void>) {
  const calls: string[][] = [];
  const exports: Record<string, unknown> = {};
  const source = readFileSync(new URL("./coupon-actions.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    exports,
    require(id: string) {
      assert.equal(id, "@/lib/db");
      return { trackClick: track };
    },
    window: {
      location: { pathname: "/merchant-coupons" },
      open(...args: string[]) {
        calls.push(args);
      },
    },
  });
  return {
    calls,
    activate: exports.activateCoupon as typeof import("./coupon-actions").activateCoupon,
    storeSlug: exports.storeSlug as (slug: string) => string,
    categorySlug: exports.categorySlug as (slug: string) => string,
  };
}

test("deal opens synchronously before tracking and does not await tracking", async () => {
  const tracked: string[][] = [];
  const fixture = harness((id, page) => {
    assert.equal(fixture.calls.length, 1);
    tracked.push([id, page]);
    return new Promise(() => {});
  });
  const result = fixture.activate({
    id: "deal",
    coupon_type: "deal",
    affiliate_url: "https://affiliate.example/exact?offer=1",
  });
  assert.deepEqual(fixture.calls, [
    ["https://affiliate.example/exact?offer=1", "_blank", "noopener,noreferrer"],
  ]);
  assert.equal(await result, "opened");
  assert.deepEqual(tracked, [["deal", "/merchant-coupons"]]);
});

test("coupon reveal resolves immediately while tracking is pending", async () => {
  const fixture = harness(() => new Promise(() => {}));
  assert.equal(
    await fixture.activate({
      id: "code",
      coupon_type: "code",
      affiliate_url: "https://affiliate.example",
    }),
    "reveal",
  );
  assert.deepEqual(fixture.calls, []);
});

test("tracking rejection cannot prevent deal navigation or code reveal", async () => {
  for (const coupon_type of ["deal", "code"] as const) {
    const fixture = harness(() => Promise.reject(new Error("tracking unavailable")));
    assert.equal(
      await fixture.activate({
        id: "offer",
        coupon_type,
        affiliate_url: "https://affiliate.example",
      }),
      coupon_type === "deal" ? "opened" : "reveal",
    );
    assert.equal(fixture.calls.length, coupon_type === "deal" ? 1 : 0);
    await Promise.resolve();
  }
});

test("deal without an affiliate URL remains safe and tracks best-effort", async () => {
  const tracked: string[] = [];
  const fixture = harness(async (id) => {
    tracked.push(id);
  });
  assert.equal(
    await fixture.activate({ id: "offer", coupon_type: "deal", affiliate_url: null }),
    "opened",
  );
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(tracked, ["offer"]);
});

test("canonical route suffix helpers do not duplicate existing suffixes", () => {
  const fixture = harness(async () => {});
  assert.equal(fixture.storeSlug("merchant"), "merchant-coupons");
  assert.equal(fixture.storeSlug("merchant-coupons"), "merchant-coupons");
  assert.equal(fixture.categorySlug("beauty"), "beauty-offers");
  assert.equal(fixture.categorySlug("beauty-offers"), "beauty-offers");
});
