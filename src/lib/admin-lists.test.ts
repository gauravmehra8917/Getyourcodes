import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { deleteAdminCatalogRow } from "./admin-catalog-delete.ts";
import * as ownership from "./admin-entity-ownership.ts";

type Element = {
  type: unknown;
  props: Record<string, unknown>;
};
type TestRow = { id: string; name: string; slug: string } & ownership.ProviderEntityIdentity;
type QueryState = { data: TestRow[]; isPending: boolean; isError: boolean; isFetching: boolean };
const routes = {
  coupons: "admin.coupons.index.tsx",
  stores: "admin.stores.index.tsx",
  categories: "admin.categories.tsx",
  users: "admin.users.tsx",
};
type Page = keyof typeof routes;

function elements(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const element = node as Element;
  return [element, ...elements(element.props?.children)];
}

// Existing node:test + transpile/VM convention: real route/controller code, fake hooks and clients.
function harness(page: Page) {
  const errors: string[] = [];
  const dbCalls: unknown[][] = [];
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let queryFn!: () => Promise<unknown>;
  let queryState: QueryState = { data: [], isPending: false, isError: false, isFetching: false };
  let dbError: unknown = null;
  let loadError: unknown = null;
  let confirmed = true;
  let refreshes = 0;
  let retries = 0;
  let serverCalls = 0;
  let route!: { component: () => Element };
  const exports: Record<string, unknown> = {};
  const jsx = (type: unknown, props: Element["props"]) => ({ type, props });
  const source = readFileSync(new URL(`../routes/${routes[page]}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  runInNewContext(outputText, {
    exports,
    confirm: () => confirmed,
    require(id: string) {
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (id === "react")
        return {
          useRef(initial: unknown) {
            const index = refIndex++;
            refs[index] ??= { current: initial };
            return refs[index];
          },
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
        };
      if (id === "@tanstack/react-router")
        return {
          Link: "Link",
          createFileRoute: () => (options: typeof route) => {
            route = options;
            return options;
          },
        };
      if (id === "@tanstack/react-query")
        return {
          useQuery(options: { queryFn: typeof queryFn }) {
            queryFn = options.queryFn;
            return {
              ...queryState,
              refetch: () => {
                retries++;
              },
            };
          },
          useQueryClient: () => ({
            invalidateQueries: () => {
              refreshes++;
            },
          }),
        };
      if (id === "@tanstack/react-start") return { useServerFn: (fn: unknown) => fn };
      if (id === "@/lib/admin.functions")
        return {
          listAdminUsers: async () => {
            serverCalls++;
            if (loadError) throw loadError;
            return queryState.data;
          },
        };
      if (id === "@/lib/db")
        return {
          sb: {
            from(table: string) {
              assert.equal(table, page, "route may only access its catalog table");
              dbCalls.push(["from", table]);
              const query = {
                select: () => query,
                order: () => query,
                delete: () => {
                  dbCalls.push(["delete", table]);
                  return query;
                },
                eq: (column: string, value: string) => {
                  dbCalls.push(["eq", column, value]);
                  return query;
                },
                then(resolve: (result: unknown) => unknown) {
                  return Promise.resolve({ data: queryState.data, error: dbError }).then(resolve);
                },
              };
              return query;
            },
          },
        };
      if (id === "@/lib/admin-catalog-delete") return { deleteAdminCatalogRow };
      if (id === "@/lib/admin-entity-ownership") return ownership;
      if (id === "sonner") return { toast: { error: (message: string) => errors.push(message) } };
      if (id === "@/components/admin/page-header") return { PageHeader: "PageHeader" };
      if (id === "@/components/admin/data-table") return { DataTable: "DataTable" };
      if (id === "@/components/admin/status-icons")
        return { YesIcon: "YesIcon", NoIcon: "NoIcon", StatusPill: "StatusPill" };
      if (id === "@/components/admin/form-fields")
        return { Field: "Field", TextInput: "TextInput" };
      if (id === "@/components/admin/seo-settings")
        return { SeoSettings: "SeoSettings", emptySeo: {}, fromRow: () => ({}) };
      if (id === "@/lib/seo") return { abs: (path: string) => path };
      if (id === "@/lib/coupon-actions") return { categorySlug: (slug: string) => slug };
      if (id === "lucide-react")
        return { Pencil: "Pencil", Trash2: "Trash2", Plus: "Plus", X: "X" };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return route.component();
  };
  const row: TestRow = { id: "record", name: "Record", slug: "record" };
  const actions = () => {
    const table = elements(render()).find((node) => node.type === "DataTable");
    assert.ok(table);
    const columns = table.props.columns as Array<{
      key: string;
      render: (row: TestRow) => Element;
    }>;
    const column = columns.find((column) => column.key === "actions");
    assert.ok(column);
    return elements(column.render(row));
  };
  const clickDelete = async () => {
    const button = actions().find((node) => node.type === "button" && node.props["aria-label"]);
    assert.ok(button);
    (button.props.onClick as () => void)();
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return {
    render,
    row,
    actions,
    clickDelete,
    errors,
    dbCalls,
    query: () => queryFn(),
    setQueryState: (state: Partial<QueryState>) => {
      queryState = { ...queryState, ...state };
    },
    setDbError: (error: unknown) => {
      dbError = error;
    },
    setLoadError: (error: unknown) => {
      loadError = error;
    },
    cancel: () => {
      confirmed = false;
    },
    refreshes: () => refreshes,
    retries: () => retries,
    serverCalls: () => serverCalls,
  };
}

for (const page of Object.keys(routes) as Page[]) {
  test(`${page} loading does not render an empty table`, () => {
    const fixture = harness(page);
    fixture.setQueryState({ isPending: true });
    const tree = elements(fixture.render());
    assert.ok(tree.some((node) => node.props.role === "status"));
    assert.ok(!tree.some((node) => node.type === "DataTable"));
  });

  test(`${page} query failure is visible, distinct from empty success, and retryable`, async () => {
    const fixture = harness(page);
    fixture.render();
    if (page === "users") fixture.setLoadError(new Error("Users server failure"));
    else fixture.setDbError({ code: "42501", message: "private DB details" });
    await assert.rejects(fixture.query());
    fixture.setQueryState({ isError: true });
    const tree = elements(fixture.render());
    assert.ok(tree.some((node) => node.props.role === "alert"));
    assert.ok(!tree.some((node) => node.type === "DataTable"));
    const retry = tree.find((node) => node.type === "button" && node.props.children === "Retry");
    assert.ok(retry);
    (retry.props.onClick as () => void)();
    assert.equal(fixture.retries(), 1);
    fixture.setQueryState({ isFetching: true });
    assert.ok(
      elements(fixture.render()).some(
        (node) => node.type === "button" && node.props.disabled === true,
      ),
    );
    fixture.setQueryState({ isError: false, isFetching: false });
    assert.ok(elements(fixture.render()).some((node) => node.type === "DataTable"));
  });
}

test("Users route calls the authenticated server function without browser profile/role queries", async () => {
  const fixture = harness("users");
  fixture.render();
  await fixture.query();
  assert.equal(fixture.serverCalls(), 1);
  assert.deepEqual(fixture.dbCalls, []);
});

for (const page of ["coupons", "stores"] as const) {
  test(`${page} provider-managed Delete is disabled and explained while Edit remains available`, async () => {
    const fixture = harness(page);
    Object.assign(fixture.row, {
      provider: "impact",
      provider_entity_namespace: page === "stores" ? "campaign" : "ad",
      provider_entity_id: "123",
    });
    const actions = fixture.actions();
    const button = actions.find((node) => node.type === "button");
    assert.equal(button?.props.disabled, true);
    assert.match(
      String(button?.props.title),
      /Provider-managed records cannot be deleted manually/,
    );
    assert.match(String(button?.props["aria-label"]), /Provider-managed/);
    const edit = actions.find((node) => node.type === "Link");
    assert.equal(edit?.props.to, `/admin/${page}/$id`);
    assert.equal(edit?.props.disabled, undefined);
    await fixture.clickDelete(); // Direct invocation also refuses despite bypassing the disabled UI.
    assert.deepEqual(fixture.dbCalls, []);
    assert.match(fixture.errors[0], /Provider-managed/);
    assert.equal(fixture.refreshes(), 0);
  });
}

for (const page of ["coupons", "stores", "categories"] as const) {
  test(`${page} manual Delete stays enabled and successful deletion refreshes`, async () => {
    const fixture = harness(page);
    assert.equal(
      fixture.actions().find((node) => node.type === "button" && node.props["aria-label"])?.props
        .disabled,
      false,
    );
    await fixture.clickDelete();
    assert.equal(fixture.dbCalls.filter((call) => call[0] === "delete").length, 1);
    assert.ok(
      fixture.dbCalls.some((call) => call[0] === "eq" && call[1] === "id" && call[2] === "record"),
    );
    assert.equal(fixture.refreshes(), 1);
    assert.deepEqual(fixture.errors, []);
  });

  test(`${page} DB delete errors reach the visible toast and do not refresh`, async () => {
    const fixture = harness(page);
    fixture.setDbError({ code: "23503", message: "private_fk_name" });
    await fixture.clickDelete();
    assert.match(fixture.errors[0], /still referenced.*cannot be deleted/);
    assert.equal(fixture.refreshes(), 0);
    assert.equal(fixture.dbCalls.filter((call) => call[0] === "delete").length, 1);
  });

  test(`${page} cancelled confirmation does not call DB delete`, async () => {
    const fixture = harness(page);
    fixture.cancel();
    await fixture.clickDelete();
    assert.deepEqual(fixture.dbCalls, []);
    assert.equal(fixture.refreshes(), 0);
  });
}

test("category FK delete failure leaves an open edit form intact", async () => {
  const fixture = harness("categories");
  const edit = fixture
    .actions()
    .find((node) => node.type === "button" && node.props.title === "Edit");
  assert.ok(edit);
  (edit.props.onClick as () => void)();
  assert.ok(elements(fixture.render()).some((node) => node.type === "form"));
  fixture.setDbError({ code: "23503" });
  await fixture.clickDelete();
  const tree = elements(fixture.render());
  assert.ok(tree.some((node) => node.type === "form"));
  assert.ok(tree.some((node) => node.type === "TextInput" && node.props.value === "Record"));
  assert.equal(fixture.refreshes(), 0);
});
