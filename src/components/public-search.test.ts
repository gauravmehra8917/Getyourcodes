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
    [key: string]: unknown;
    children?: Element | Element[] | string;
    onSubmit?: (event: { preventDefault: () => void }) => void;
    onClick?: () => void | Promise<void>;
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

function headerFixture() {
  const state: unknown[] = ["", null, false, false, false];
  const effects: (() => unknown)[] = [];
  const navigated: unknown[] = [];
  let stateIndex = 0;
  let pathname = "/";
  let authChanged: (event: string, session: unknown) => void;
  let unsubscribed = false;
  let signedOut = false;
  let assistantOpened = false;
  const { SiteHeader } = loadComponent<{ SiteHeader: () => Element }>("./site-header.tsx", {
    react: {
      useEffect: (effect: () => unknown) => effects.push(effect),
      useRef: () => ({ current: null }),
      useState: () => {
        const index = stateIndex++;
        return [
          state[index],
          (value: unknown) => {
            state[index] = typeof value === "function" ? value(state[index]) : value;
          },
        ];
      },
    },
    "@tanstack/react-router": {
      Link: "router-link",
      useNavigate: () => (options: unknown) => navigated.push(options),
      useRouterState: () => pathname,
    },
    "@/integrations/supabase/client": {
      supabase: {
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: (callback: typeof authChanged) => {
            authChanged = callback;
            return {
              data: { subscription: { unsubscribe: () => (unsubscribed = true) } },
            };
          },
          signOut: async () => {
            signedOut = true;
            authChanged("SIGNED_OUT", null);
          },
        },
      },
    },
    "@/lib/db": {},
    "@/components/theme-toggle": { ThemeToggle: "theme-toggle" },
    "@/components/ai-assistant-provider": {
      useAssistant: () => ({ open: () => (assistantOpened = true) }),
    },
  });
  return {
    render() {
      stateIndex = 0;
      effects.length = 0;
      return SiteHeader();
    },
    effects,
    navigated,
    routeChanged() {
      pathname = "/stores";
    },
    signIn() {
      authChanged("SIGNED_IN", {
        user: { email: "fixture@example.test", user_metadata: { display_name: "Gaurav" } },
      });
    },
    unsubscribed: () => unsubscribed,
    signedOut: () => signedOut,
    assistantOpened: () => assistantOpened,
  };
}

function elements(element: Element): Element[] {
  const children = [element.props.children].flat();
  return [
    element,
    ...children.flatMap((child) => (child && typeof child === "object" ? elements(child) : [])),
  ];
}

function navEntries(nav: Element) {
  return elements(nav)
    .filter(({ type }) => type === "router-link")
    .map(({ props }) => [props.children, props.to]);
}

const expectedNav = [
  ["Home", "/"],
  ["Categories", "/categories"],
  ["Stores", "/stores"],
  ["Coupons", "/coupons"],
  ["Deals", "/deals"],
  ["Blog", "/blog"],
];

test("persistent primary navigation is a separate md+ ribbon with exact Home activation", () => {
  const header = headerFixture().render();
  const [row, ribbon] = header.props.children as Element[];
  assert.equal(ribbon.type, "nav");
  assert.equal(ribbon.props["aria-label"], "Primary navigation");
  assert.match(String(ribbon.props.className), /\bhidden\b.*\bmd:block\b/);
  assert.deepEqual(navEntries(ribbon), expectedNav);
  assert.ok(!elements(row).some(({ type }) => type === "nav"));
  assert.ok(!elements(header).some(({ props }) => String(props.className).includes("lg:flex")));
  assert.match(String(header.props.className), /\bsticky top-0\b/);
  for (const { props } of elements(ribbon).filter(({ type }) => type === "router-link")) {
    assert.equal(props.hash, undefined);
    assert.equal((props.activeOptions as { exact: boolean }).exact, props.to === "/");
    assert.match(String((props.activeProps as { className: string }).className), /text-foreground/);
    assert.match(String(props.className), /\bfocus-ring\b/);
  }
  const rowElements = elements(row);
  assert.ok(rowElements.some(({ props }) => props["aria-label"] === "Getyourcodes home"));
  assert.ok(
    rowElements.some(
      ({ type, props }) => type === "form" && String(props.className).includes("md:flex"),
    ),
  );
  assert.ok(rowElements.some(({ props }) => props["aria-label"] === "Ask Dealio AI assistant"));
  assert.ok(rowElements.some(({ type }) => type === "theme-toggle"));
  assert.ok(rowElements.some(({ props }) => props.to === "/auth"));
});

test("mobile navigation retains every route, focus rings, and accessible md-hidden menu controls", () => {
  const fixture = headerFixture();
  let header = fixture.render();
  let toggle = elements(header).find(({ props }) => props["aria-label"] === "Open menu")!;
  assert.equal(toggle.props["aria-expanded"], false);
  assert.match(String(toggle.props.className), /\bmd:hidden\b/);
  assert.ok(!String(toggle.props.className).includes("lg:hidden"));
  assert.ok(!elements(header).some(({ props }) => props["aria-label"] === "Mobile navigation"));
  toggle.props.onClick!();
  header = fixture.render();
  toggle = elements(header).find(({ props }) => props["aria-label"] === "Close menu")!;
  assert.equal(toggle.props["aria-expanded"], true);
  const panel = (header.props.children as Element[])[2];
  assert.match(String(panel.props.className), /\bmd:hidden\b/);
  const nav = elements(panel).find(({ type }) => type === "nav")!;
  assert.equal(nav.props["aria-label"], "Mobile navigation");
  assert.deepEqual(navEntries(nav), expectedNav);
  for (const link of elements(nav).filter(({ type }) => type === "router-link")) {
    assert.match(String(link.props.className), /\bfocus-ring\b/);
  }
  elements(nav).find(({ props }) => props.to === "/stores")!.props.onClick!();
  assert.ok(
    !elements(fixture.render()).some(({ props }) => props["aria-label"] === "Mobile navigation"),
  );
});

test("a route change closes the mobile panel and account dropdown", async () => {
  const fixture = headerFixture();
  let header = fixture.render();
  const cleanup = fixture.effects[0]() as () => void;
  await Promise.resolve();
  fixture.signIn();
  header = fixture.render();
  elements(header).find(({ props }) => props["aria-label"] === "Open menu")!.props.onClick!();
  elements(header).find(({ props }) => props["aria-label"] === "Account menu")!.props.onClick!();
  assert.ok(elements(fixture.render()).some(({ props }) => props.to === "/analytics"));
  fixture.routeChanged();
  fixture.render();
  fixture.effects[2]();
  header = fixture.render();
  assert.ok(!elements(header).some(({ props }) => props["aria-label"] === "Mobile navigation"));
  assert.ok(!elements(header).some(({ props }) => props.to === "/analytics"));
  assert.equal(
    elements(header).find(({ props }) => props["aria-label"] === "Open menu")!.props[
      "aria-expanded"
    ],
    false,
  );
  cleanup();
});

test("auth subscription, account links and sign out remain intact", async () => {
  const fixture = headerFixture();
  fixture.render();
  const cleanup = fixture.effects[0]() as () => void;
  await Promise.resolve();
  fixture.signIn();
  let header = fixture.render();
  const account = elements(header).find(({ props }) => props["aria-label"] === "Account menu")!;
  assert.equal(account.props.children, "G");
  account.props.onClick!();
  header = fixture.render();
  for (const [label, to] of [
    ["My account", "/account"],
    ["Saved", "/account"],
    ["Deal analytics", "/analytics"],
  ]) {
    assert.ok(
      elements(header).some(
        ({ props }) => props.to === to && JSON.stringify(props.children).includes(label),
      ),
    );
  }
  const signOut = elements(header).find(
    ({ type, props }) => type === "button" && JSON.stringify(props.children).includes("Sign out"),
  )!;
  await signOut.props.onClick!();
  assert.equal(fixture.signedOut(), true);
  assert.equal(JSON.stringify(fixture.navigated), JSON.stringify([{ to: "/" }]));
  assert.ok(elements(fixture.render()).some(({ props }) => props.to === "/auth"));
  cleanup();
  assert.equal(fixture.unsubscribed(), true);
});

test("Dealio still opens through its first-row control", () => {
  const fixture = headerFixture();
  const row = (fixture.render().props.children as Element[])[0];
  elements(row).find(({ props }) => props["aria-label"] === "Ask Dealio AI assistant")!.props
    .onClick!();
  assert.equal(fixture.assistantOpened(), true);
});
