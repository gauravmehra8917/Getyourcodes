import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as visibility from "../lib/catalog-visibility.ts";
import { normalizeSearchTerm } from "../lib/search-normalization.ts";

type SearchQuery = {
  queryKey: string[];
  enabled: boolean;
  queryFn: () => Promise<{ stores: unknown[]; coupons: unknown[]; categories: unknown[] }>;
};

type Element = {
  type: unknown;
  props: {
    children?: Element | Element[];
    onSubmit?: (event: { preventDefault: () => void }) => void;
  };
};

function loadComponent<T>(file: string, mocks: Record<string, unknown>): T {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  const jsx = (type: unknown, props: Element["props"]) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@tanstack/react-router": {},
    "lucide-react": {},
    "@/lib/search-normalization": { normalizeSearchTerm },
    ...mocks,
  };
  runInNewContext(outputText, {
    exports,
    require(id: string) {
      assert.ok(Object.hasOwn(modules, id), `Unexpected import: ${id}`);
      return modules[id as keyof typeof modules];
    },
  });
  return exports as T;
}

function directSearchFixture(term: string) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const { useDirectSearch: search } = loadComponent<{
    useDirectSearch: (term: string) => SearchQuery;
  }>("./hero-search-results.tsx", {
    "@tanstack/react-query": { useQuery: (options: SearchQuery) => options },
    "@/lib/catalog-visibility": visibility,
    "@/lib/coupon-actions": {},
    "@/components/coupon-card": {},
    "@/components/store-card": {},
    "@/lib/db": {
      sb: {
        from(table: string) {
          calls.push({ table, method: "from", args: [] });
          const query = Object.fromEntries(
            ["select", "or", "eq", "ilike", "limit"].map((method) => [
              method,
              (...args: unknown[]) => {
                calls.push({ table, method, args });
                return method === "limit" ? { data: [] } : query;
              },
            ]),
          );
          return query;
        },
      },
    },
  });
  return { query: search(term), calls };
}

test("direct search disables empty normalized input and guards explicit refetches", async () => {
  for (const term of ["", " \n\t ", "%", "_", " % _ %% __ "]) {
    const { query, calls } = directSearchFixture(term);
    assert.equal(query.enabled, false);
    assert.equal(query.queryKey[1], "");
    const result = await query.queryFn();
    assert.equal(result.stores.length + result.coupons.length + result.categories.length, 0);
    assert.deepEqual(calls, []);
  }
});

test("direct search keys and database filters use the same bounded normalized term", async () => {
  for (const term of [" % Ac_me Deals_% ", ` % ${"a".repeat(120)} tail_% `]) {
    const normalized = normalizeSearchTerm(term);
    const { query, calls } = directSearchFixture(term);
    assert.equal(query.enabled, true);
    assert.equal(query.queryKey.join("|"), `hero-search|${normalized}`);
    await query.queryFn();
    assert.deepEqual(
      calls.filter(({ method }) => method === "ilike").map(({ args }) => args),
      [
        ["name", `%${normalized}%`],
        ["name", `%${normalized}%`],
      ],
    );
    assert.ok(
      calls.some(
        ({ method, args }) =>
          method === "or" &&
          args[0] === `title.ilike.%${normalized}%,coupon_code.ilike.%${normalized}%`,
      ),
    );
    assert.deepEqual(
      calls.filter(({ method }) => method === "limit").map(({ args }) => args[0]),
      [6, 6, 6],
    );
    assert.ok(
      calls.some(
        ({ table, method, args }) =>
          table === "stores" &&
          method === "or" &&
          args[0] === visibility.PUBLIC_STORE_VISIBILITY_FILTER,
      ),
    );
    assert.ok(
      calls.some(
        ({ table, method, args }) =>
          table === "coupons" && method === "eq" && args[0] === "status" && args[1] === "active",
      ),
    );
  }
});

test("header submission ignores empty normalized input and normalizes tracking and navigation", () => {
  for (const term of [" % _ ", " % Ac_me Deals_% ", "a".repeat(120)]) {
    const tracked: unknown[][] = [];
    const navigated: unknown[] = [];
    let stateIndex = 0;
    const { SiteHeader } = loadComponent<{ SiteHeader: () => Element }>("./site-header.tsx", {
      react: {
        useEffect: () => {},
        useRef: () => ({ current: null }),
        useState: (initial: unknown) => [stateIndex++ === 0 ? term : initial, () => {}],
      },
      "@tanstack/react-router": {
        useNavigate: () => (options: unknown) => navigated.push(options),
        useRouterState: () => "/",
      },
      "@/integrations/supabase/client": {},
      "@/lib/db": { trackSearch: (...args: unknown[]) => tracked.push(args) },
      "@/components/theme-toggle": {},
      "@/components/ai-assistant-provider": { useAssistant: () => ({ open: () => {} }) },
    });
    const header = SiteHeader();
    const row = header.props.children as Element[];
    const children = row[0].props.children as Element[];
    let prevented = false;
    children.find(({ type }) => type === "form")!.props.onSubmit!({
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    const normalized = normalizeSearchTerm(term);
    assert.deepEqual(tracked, normalized ? [[normalized, "search"]] : []);
    assert.equal(
      JSON.stringify(navigated),
      JSON.stringify(normalized ? [{ to: "/search", search: { q: normalized } }] : []),
    );
  }
});
