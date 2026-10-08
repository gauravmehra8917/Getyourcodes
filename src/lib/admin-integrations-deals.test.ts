import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { format } from "prettier";
import type {
  ImpactDealsApplyResult,
  ImpactDealsPreviewResult,
} from "./affiliate-sync-deals.client.ts";

type Element = { type: unknown; props: Record<string, unknown> };
type RecordRow = {
  id: string;
  integration_name: string;
  provider_name: string;
  provider_type: string;
  is_enabled: boolean;
};
type MutationOptions = {
  retry?: boolean;
  mutationFn: (rec: RecordRow) => Promise<unknown>;
  onSuccess?: (result: unknown, rec: RecordRow) => void;
  onError?: (error: unknown, rec: RecordRow) => void;
  onSettled?: () => void;
};
const rec: RecordRow = {
  id: "11111111-1111-4111-8111-111111111111",
  integration_name: "Impact",
  provider_name: "impact",
  provider_type: "affiliate_network",
  is_enabled: true,
};
const review: ImpactDealsPreviewResult = {
  status: "ready",
  evaluationTimestamp: "2026-10-08T00:00:00Z",
  deals: { normalized: 12, selected: 5, held: 4, unresolved: 3, existing: 2, proposedCreate: 3 },
  stores: { withSelectedOffers: 2, qualified: 1 },
  identityIntegrity: { identityCollapseDetected: false },
};
const applied: ImpactDealsApplyResult = {
  status: "committed",
  scope: "deals",
  mode: "full",
  runId: "22222222-2222-4222-8222-222222222222",
  evaluationTimestamp: "2026-10-08T00:00:00Z",
  refreshedPlan: true,
  createdDeals: 3,
  noopDeals: 2,
  createdStores: 1,
  noopStores: 1,
  ledgerRows: 7,
  counts: {
    expected: {
      stores: { create: 1, noopExisting: 1, blockedAmbiguous: 0, noopUnmatched: 0 },
      offers: { create: 3, noopExisting: 2, noopHeld: 4, noopUnresolved: 3 },
      writableStores: 1,
      writableOffers: 3,
      writableEntities: 4,
    },
    actual: {
      storesCreated: 1,
      storesNoopExisting: 1,
      offersCreated: 3,
      offersNoopExisting: 2,
      ledgerRows: 7,
    },
  },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return Array.from(value).flatMap(elements);
  if (!value || typeof value !== "object") return [];
  const node = value as Element;
  if (typeof node.type === "function") return [node, ...elements(node.type(node.props))];
  return [node, ...elements(node.props?.children), ...elements(node.props?.action)];
}
function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return Array.from(value).map(textOf).join(" ");
  if (!value || typeof value !== "object") return "";
  const node = value as Element;
  if (typeof node.type === "function") return textOf(node.type(node.props));
  return `${textOf(node.props?.children)} ${textOf(node.props?.action)}`
    .replace(/\s+/g, " ")
    .trim();
}

// Execute the real route, following the repository's node:test + transpile/VM
// convention. Hooks, Radix primitives and network boundaries are mocked only.
function harness(rows = [rec]) {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const mutations: Array<{ pending: boolean; options: MutationOptions }> = [];
  const calls: Array<{ action: "review" | "apply" | "coupon"; id: string }> = [];
  const invalidations: unknown[][] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let mutationIndex = 0;
  let reviewResult: unknown = review;
  let applyResult: unknown = applied;
  let couponResult: unknown = { status: "blocked" };
  let route!: { component: () => Element };
  let restoredFocus = 0;
  let fallbackFocus = 0;
  const opener = {
    isConnected: true,
    disabled: false,
    focus: () => {
      restoredFocus++;
    },
  };
  const boundary = (action: "review" | "apply" | "coupon", id: string) => {
    calls.push({ action, id });
    return Promise.resolve(
      action === "review" ? reviewResult : action === "apply" ? applyResult : couponResult,
    );
  };
  const jsx = (type: unknown, props: Element["props"]) => ({ type, props });
  const source = readFileSync(new URL("../routes/admin.integrations.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  runInNewContext(output, {
    exports: {},
    require(id: string) {
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (id === "react")
        return {
          useState(initial: unknown) {
            const index = stateIndex++;
            if (!(index in states)) states[index] = initial;
            return [
              states[index],
              (value: unknown) => {
                states[index] = value;
              },
            ];
          },
          useRef(initial: unknown) {
            const index = refIndex++;
            refs[index] ??= { current: initial };
            return refs[index];
          },
          useMemo: (fn: () => unknown) => fn(),
          useEffect: () => {},
        };
      if (id === "@tanstack/react-router")
        return {
          createFileRoute: () => (options: typeof route) => {
            route = options;
            return options;
          },
        };
      if (id === "@tanstack/react-start")
        return { createClientOnlyFn: (fn: unknown) => fn, useServerFn: (fn: unknown) => fn };
      if (id === "@tanstack/react-query")
        return {
          useQuery: () => ({ data: rows, isLoading: false }),
          useQueryClient: () => ({
            invalidateQueries: (options: { queryKey: unknown[] }) => {
              invalidations.push(Array.from(options.queryKey));
              return Promise.resolve();
            },
          }),
          useMutation(options: MutationOptions) {
            const index = mutationIndex++;
            mutations[index] ??= { pending: false, options };
            const mutation = mutations[index];
            mutation.options = options;
            return {
              isPending: mutation.pending,
              mutate(record: RecordRow) {
                mutation.pending = true;
                void Promise.resolve()
                  .then(() => options.mutationFn(record))
                  .then(
                    (result) => options.onSuccess?.(result, record),
                    (error) => options.onError?.(error, record),
                  )
                  .finally(() => {
                    options.onSettled?.();
                    mutation.pending = false;
                  });
              },
            };
          },
        };
      if (id === "@/lib/affiliate-sync-deals.client")
        return {
          reviewImpactDeals: (id: string) => boundary("review", id),
          importImpactDeals: (id: string) => boundary("apply", id),
        };
      if (id === "@/lib/affiliate-sync-ads-apply-v2.client")
        return { importImpactCoupons: (id: string) => boundary("coupon", id) };
      if (id === "@radix-ui/react-dialog")
        return {
          Root: "DialogRoot",
          Portal: "DialogPortal",
          Overlay: "DialogOverlay",
          Content: "DialogContent",
          Title: "DialogTitle",
          Description: "DialogDescription",
        };
      if (id === "lucide-react") return new Proxy({}, { get: (_target, key) => String(key) });
      if (id === "sonner") return { toast: { error: () => {}, success: () => {} } };
      if (id === "@/components/admin/page-header") return { PageHeader: "PageHeader" };
      if (id === "@/components/admin/integration-wizard")
        return { IntegrationWizard: "IntegrationWizard" };
      if (id.endsWith(".functions")) return {};
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  const render = () => {
    stateIndex = refIndex = mutationIndex = 0;
    const root = route.component();
    (root.props.ref as { current: unknown }).current = {
      focus: () => {
        fallbackFocus++;
      },
    };
    return root;
  };
  const nodes = () => elements(render());
  const button = (label: string) => {
    const found = nodes().find((node) => node.type === "button" && textOf(node) === label);
    assert.ok(found, `Missing button: ${label}`);
    return found;
  };
  const find = (type: string) => nodes().find((node) => node.type === type);
  const dialog = () =>
    nodes().find(
      (node) => typeof node.type === "function" && node.type.name === "ImpactDealsDialog",
    );
  const click = (node: Element) =>
    (node.props.onClick as ((event: unknown) => void) | undefined)?.({ currentTarget: opener });
  render();
  return {
    render,
    nodes,
    button,
    find,
    dialog,
    click,
    calls,
    invalidations,
    mutations,
    opener,
    reviewResult: (result: unknown) => {
      reviewResult = result;
    },
    applyResult: (result: unknown) => {
      applyResult = result;
    },
    couponResult: (result: unknown) => {
      couponResult = result;
    },
    restoredFocus: () => restoredFocus,
    fallbackFocus: () => fallbackFocus,
  };
}

for (const provider of ["impact", " Impact.com ", "IMPACT RADIUS"]) {
  test(`enabled exact ${provider} card has adjacent real Coupon and Deals buttons`, () => {
    const f = harness([{ ...rec, provider_name: provider }]);
    assert.equal(f.button("Import Impact Coupons").type, "button");
    assert.equal(f.button("Import Impact Deals").type, "button");
    const labels = f
      .nodes()
      .filter((node) => node.type === "button")
      .map(textOf);
    assert.equal(labels[labels.indexOf("Import Impact Coupons") + 1], "Import Impact Deals");
  });
}
for (const record of [
  { ...rec, is_enabled: false },
  ...["other", "impact affiliate", "impact.com.au", "impact-radius"].map((provider_name) => ({
    ...rec,
    provider_name,
  })),
]) {
  test(`disabled/non-Impact ${record.provider_name}/${record.is_enabled} card hides Deals import`, () => {
    assert.ok(
      !harness([record])
        .nodes()
        .some((node) => node.type === "button" && textOf(node) === "Import Impact Deals"),
    );
  });
}
test("review runs before apply; an unsuccessful or pending review cannot be confirmed", async () => {
  const f = harness();
  const pending = deferred<ImpactDealsPreviewResult>();
  f.reviewResult(pending.promise);
  f.click(f.button("Import Impact Deals"));
  (f.dialog()!.props.onConfirm as () => void)();
  await tick();
  assert.deepEqual(
    f.calls.map((call) => call.action),
    ["review"],
  );
  assert.match(textOf(f.render()), /Reviewing Impact Deals… This may take a couple of minutes/);
  assert.ok(
    !f.nodes().some((node) => node.type === "button" && /^Import \d+ Deals$/.test(textOf(node))),
  );
  pending.resolve(review);
  await tick();
  assert.equal(f.button("Import 3 Deals").props.disabled, false);
  assert.deepEqual(
    f.calls.map((call) => call.action),
    ["review"],
  );
  f.click(f.button("Import 3 Deals"));
  await tick();
  assert.deepEqual(
    f.calls.map((call) => call.action),
    ["review", "apply"],
  );
});
test("zero new Deals is successful no work, includes existing/held/unresolved and cannot apply", async () => {
  const f = harness();
  f.reviewResult({
    ...review,
    deals: { normalized: 9, selected: 2, held: 4, unresolved: 3, existing: 2, proposedCreate: 0 },
  });
  f.click(f.button("Import Impact Deals"));
  await tick();
  assert.match(textOf(f.render()), /No new Deals are ready to import/);
  for (const copy of ["Already on site 2", "Held by policy 4", "Unresolved 3"])
    assert.ok(textOf(f.render()).includes(copy));
  assert.equal(f.button("Import 0 Deals").props.disabled, true);
  f.click(f.button("Import 0 Deals"));
  (f.dialog()!.props.onConfirm as () => void)();
  await tick();
  assert.equal(f.calls.filter((call) => call.action === "apply").length, 0);
});
test("duplicate review clicks are blocked synchronously before React rerenders", async () => {
  const f = harness();
  const pending = deferred<ImpactDealsPreviewResult>();
  f.reviewResult(pending.promise);
  const stale = f.button("Import Impact Deals");
  f.click(stale);
  f.click(stale);
  await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.button("Import Impact Deals").props.disabled, true);
  assert.equal(f.button("Import Impact Coupons").props.disabled, true);
  pending.resolve(review);
  await tick();
});
test("duplicate applies and stale confirmation after completion cannot apply twice", async () => {
  const f = harness();
  f.click(f.button("Import Impact Deals"));
  await tick();
  const pending = deferred<ImpactDealsApplyResult>();
  f.applyResult(pending.promise);
  const stale = f.button("Import 3 Deals");
  f.click(stale);
  f.click(stale);
  await tick();
  assert.equal(f.calls.filter((call) => call.action === "apply").length, 1);
  assert.equal(f.button("Import Impact Deals").props.disabled, true);
  assert.equal(f.button("Import Impact Coupons").props.disabled, true);
  assert.match(textOf(f.render()), /Importing Impact Deals…/);
  pending.resolve(applied);
  await tick();
  f.click(stale);
  await tick();
  assert.equal(f.calls.filter((call) => call.action === "apply").length, 1);
});
test("pending Coupon import disables Deals on every Impact card and prevents stale review", async () => {
  const f = harness([rec, { ...rec, id: "33333333-3333-4333-8333-333333333333" }]);
  const staleDeals = f.button("Import Impact Deals");
  const pending = deferred<unknown>();
  f.couponResult(pending.promise);
  f.click(f.button("Import Impact Coupons"));
  const confirm = f.button("Confirm Import");
  f.click(confirm);
  f.click(confirm);
  f.click(staleDeals);
  await tick();
  assert.deepEqual(
    f.calls.map((call) => call.action),
    ["coupon"],
  );
  for (const node of f
    .nodes()
    .filter(
      (node) =>
        node.type === "button" && ["Import Impact Deals", "Importing…"].includes(textOf(node)),
    ))
    assert.equal(node.props.disabled, true);
  pending.resolve({ status: "blocked" });
  await tick();
});
test("pending Deals review prevents a stale Coupon opener from importing", async () => {
  const f = harness();
  const staleCoupon = f.button("Import Impact Coupons");
  const pending = deferred<ImpactDealsPreviewResult>();
  f.reviewResult(pending.promise);
  f.click(f.button("Import Impact Deals"));
  f.click(staleCoupon);
  await tick();
  assert.deepEqual(
    f.calls.map((call) => call.action),
    ["review"],
  );
  assert.ok(!f.nodes().some((node) => node.type === "button" && textOf(node) === "Confirm Import"));
  pending.resolve(review);
  await tick();
});
test("modal describes Deals only, unchanged Coupon-code offers, exact identities and parent stores", async () => {
  const f = harness();
  f.click(f.button("Import Impact Deals"));
  await tick();
  const copy = textOf(f.find("DialogDescription"));
  for (const expected of [
    "no-code Impact Promotions as Deals",
    "Coupon-code offers are not changed",
    "Existing exact provider identities are not recreated",
    "Campaign-backed stores may be created",
  ])
    assert.ok(copy.includes(expected));
  assert.equal(f.find("DialogContent")!.props["aria-modal"], "true");
  assert.equal(textOf(f.find("DialogTitle")), "Import Impact Deals");
  assert.equal(f.button("Cancel").props.disabled, false);
});
test("failed review offers manual read-only retry and cannot apply", async () => {
  const f = harness();
  f.reviewResult({
    status: "failed",
    message: "Impact could not be fully read. No Deals were imported.",
  });
  f.click(f.button("Import Impact Deals"));
  await tick();
  (f.dialog()!.props.onConfirm as () => void)();
  const retry = f.button("Retry Review");
  f.reviewResult(review);
  f.click(retry);
  f.click(retry);
  await tick();
  assert.deepEqual(
    f.calls.map((call) => call.action),
    ["review", "review"],
  );
  assert.equal(f.button("Import 3 Deals").props.disabled, false);
});
test("thrown review errors remain safe and manually retryable", async () => {
  const f = harness();
  const pending = deferred<ImpactDealsPreviewResult>();
  f.reviewResult(pending.promise);
  f.click(f.button("Import Impact Deals"));
  await tick();
  pending.reject(new Error("private"));
  await tick();
  assert.equal(f.calls.length, 1);
  assert.doesNotMatch(textOf(f.render()), /private/);
  assert.ok(f.button("Retry Review"));
});
for (const phase of ["reviewing", "applying"] as const) {
  test(`${phase} blocks Close, Escape, backdrop, focus-out and root dismissal`, async () => {
    const f = harness();
    const pending = deferred<ImpactDealsPreviewResult | ImpactDealsApplyResult>();
    if (phase === "reviewing") f.reviewResult(pending.promise);
    f.click(f.button("Import Impact Deals"));
    await tick();
    if (phase === "applying") {
      f.applyResult(pending.promise);
      f.click(f.button("Import 3 Deals"));
      await tick();
    }
    assert.equal(f.button("Close").props.disabled, true);
    assert.equal(f.find("DialogContent")!.props["aria-busy"], true);
    f.click(f.button("Close"));
    (f.find("DialogRoot")!.props.onOpenChange as (open: boolean) => void)(false);
    let prevented = 0;
    for (const key of ["onEscapeKeyDown", "onPointerDownOutside", "onInteractOutside"]) {
      (f.find("DialogContent")!.props[key] as (event: unknown) => void)({
        preventDefault: () => {
          prevented++;
        },
      });
    }
    assert.equal(prevented, 3);
    assert.ok(f.dialog());
    pending.resolve(phase === "reviewing" ? review : applied);
    await tick();
    f.click(f.button(phase === "reviewing" ? "Cancel" : "Close"));
    assert.equal(f.dialog(), undefined);
  });
}
for (const status of ["committed", "replayed_existing"] as const) {
  test(`${status} shows verified result and invalidates exact Import History query`, async () => {
    const f = harness();
    f.applyResult({ ...applied, status });
    f.click(f.button("Import Impact Deals"));
    await tick();
    f.click(f.button("Import 3 Deals"));
    await tick();
    assert.equal(textOf(f.find("DialogTitle")), "Impact Deals Import Complete");
    for (const text of [
      "Deals created 3",
      "Deals already existing 2",
      "Stores created 1",
      "Stores already existing 1",
      "Deals held by policy 4",
    ])
      assert.ok(textOf(f.render()).includes(text));
    assert.deepEqual(f.invalidations, [["integration-imports", rec.id]]);
    assert.equal(f.button("Close").props.disabled, false);
  });
}
for (const status of ["blocked", "failed", "indeterminate"] as const) {
  test(`${status} apply does not retry, enable reapply or claim success`, async () => {
    const f = harness();
    const message =
      status === "indeterminate"
        ? "The final import outcome could not be confirmed. Do not retry immediately. Check Deals and Import History first."
        : "The Deals import was blocked by safety or catalog checks.";
    f.applyResult({ status, message });
    f.click(f.button("Import Impact Deals"));
    await tick();
    f.click(f.button("Import 3 Deals"));
    await tick();
    assert.equal(f.calls.filter((call) => call.action === "apply").length, 1);
    assert.equal(f.invalidations.length, 0);
    assert.ok(textOf(f.render()).includes(message));
    assert.ok(
      !f
        .nodes()
        .some(
          (node) => node.type === "button" && /Retry Review|Import \d+ Deals/.test(textOf(node)),
        ),
    );
    assert.equal(f.button("Close").props.disabled, false);
  });
}
test("thrown apply ambiguity gives the strong check-history warning, with retry false", async () => {
  const f = harness();
  f.click(f.button("Import Impact Deals"));
  await tick();
  const pending = deferred<ImpactDealsApplyResult>();
  f.applyResult(pending.promise);
  f.click(f.button("Import 3 Deals"));
  await tick();
  pending.reject(new Error("private transport"));
  await tick();
  assert.match(
    textOf(f.render()),
    /Do not retry immediately\. Check Deals and Import History first/,
  );
  assert.doesNotMatch(textOf(f.render()), /private|try again/);
  const impactMutations = f.mutations.slice(-3);
  assert.ok(impactMutations.every((mutation) => mutation.options.retry === false));
  assert.equal(f.calls.filter((call) => call.action === "apply").length, 1);
});
test("integration disabled during review cannot apply from a stale confirmation", async () => {
  const rows = [{ ...rec }];
  const f = harness(rows);
  f.click(f.button("Import Impact Deals"));
  await tick();
  rows[0].is_enabled = false;
  f.click(f.button("Import 3 Deals"));
  await tick();
  assert.equal(f.calls.filter((call) => call.action === "apply").length, 0);
  assert.match(textOf(f.render()), /Enable this Impact integration/);
});
test("normal close restores keyboard focus and falls back if the opener disappears", async () => {
  const f = harness();
  f.click(f.button("Import Impact Deals"));
  await tick();
  let prevented = 0;
  const closeAutoFocus = f.find("DialogContent")!.props.onCloseAutoFocus as (
    event: unknown,
  ) => void;
  closeAutoFocus({
    preventDefault: () => {
      prevented++;
    },
  });
  assert.equal(f.restoredFocus(), 1);
  f.opener.isConnected = false;
  closeAutoFocus({
    preventDefault: () => {
      prevented++;
    },
  });
  assert.equal(f.fallbackFocus(), 1);
  assert.equal(prevented, 2);
});
test("Coupon client stays byte-identical and result presentation changes only formatting", async () => {
  const base = "62179453c113abc9ef7a6d1503eb2b5763a0fa1b";
  const file = "src/lib/affiliate-sync-ads-apply-v2.client.ts";
  assert.deepEqual(readFileSync(file), execFileSync("git", ["show", `${base}:${file}`]));
  const routeFile = "src/routes/admin.integrations.tsx";
  const old = execFileSync("git", ["show", `${base}:${routeFile}`], { encoding: "utf8" });
  const current = readFileSync(routeFile, "utf8");
  const couponResult = (source: string) =>
    source.slice(
      source.indexOf("function ImpactImportResultBody"),
      source.indexOf("function TestResultModal"),
    );
  assert.equal(
    await format(couponResult(current), { parser: "typescript" }),
    await format(couponResult(old), { parser: "typescript" }),
  );
  assert.match(current, /getAffiliateImportHistory/);
  assert.doesNotMatch(
    current,
    /mode\s*:\s*["']canary["']|affiliate_import_runs.*(?:insert|update)|admin_activity_log.*(?:insert|update)/,
  );
});
