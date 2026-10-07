import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as actions from "./admin-secondary-actions.ts";

type Element = { type: unknown; props: Record<string, unknown> };
type QueryState = {
  data?: unknown[];
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  dataUpdatedAt?: number;
};
type QueryOptions = { queryKey: unknown[]; queryFn: () => Promise<unknown[]>; enabled?: boolean };
type DbResult = { data: unknown[] | null; error: unknown };
type Column = {
  key: string;
  searchValue?: (row: TestRow) => string;
  render: (row: TestRow) => Element;
};
type TestRow = {
  id: string;
  email: string;
  active: boolean;
  created_at: string;
  title: string;
  slug: string;
  status: string;
  published_at: string;
  name: string;
  description: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string;
  meta: { name: string };
  actor_name?: string;
};
const files = {
  subscribers: "admin.subscribers.tsx",
  posts: "admin.posts.index.tsx",
  blog: "admin.blog-categories.tsx",
  reports: "admin.reports.tsx",
  activity: "admin.activity.tsx",
};
type Page = keyof typeof files;
const keys = {
  subscribers: "admin-subscribers",
  posts: "admin-posts",
  blog: "admin-blog-categories",
  reports: "admin-clicks",
  activity: "admin-activity",
};
const tables = {
  subscribers: "subscribers",
  posts: "posts",
  blog: "blog_categories",
  reports: "coupon_clicks",
  activity: "admin_activity_log",
};

function elements(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return Array.from(node).flatMap(elements);
  const element = node as Element;
  if (typeof element.type === "function") {
    return [element, ...elements(element.type(element.props))];
  }
  return [element, ...elements(element.props?.children), ...elements(element.props?.action)];
}
function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return Array.from(node).map(textOf).join(" ");
  if (!node || typeof node !== "object") return "";
  const element = node as Element;
  if (typeof element.type === "function") return textOf(element.type(element.props));
  return `${textOf(element.props?.children)} ${textOf(element.props?.action)}`
    .replace(/\s+/g, " ")
    .trim();
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Follow the repository node:test + transpile/VM convention, executing actual routes and handlers.
// Only hooks, JSX and database/network boundaries are mocked; no live requests are made.
function harness(page: Page) {
  const errors: string[] = [];
  const dbCalls: unknown[][] = [];
  const refreshes: Array<{ filter: { queryKey: string[] }; options: { throwOnError?: boolean } }> =
    [];
  const retries: string[] = [];
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const queryStates = new Map<string, QueryState>();
  const queries = new Map<string, QueryOptions>();
  const results = new Map<string, DbResult>();
  let stateIndex = 0;
  let refIndex = 0;
  let confirmed = true;
  let confirmations = 0;
  let mutationResult: DbResult | Promise<DbResult> = { data: null, error: null };
  let refreshResult: Promise<unknown> = Promise.resolve();
  let retryResult: Promise<unknown> = Promise.resolve();
  const downloads: { filename: string; blob: Blob }[] = [];
  let blob!: Blob;
  let route!: { component: () => Element };
  const jsx = (type: unknown, props: Element["props"]) => ({ type, props });
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(`../routes/${files[page]}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  runInNewContext(outputText, {
    exports: {},
    Blob,
    URL: {
      createObjectURL(value: Blob) {
        blob = value;
        return "blob:test";
      },
      revokeObjectURL: () => {},
    },
    document: {
      createElement: () => {
        const link = {
          href: "",
          download: "",
          click: () => downloads.push({ filename: link.download, blob }),
        };
        return link;
      },
    },
    confirm: () => {
      confirmations++;
      return confirmed;
    },
    require(id: string) {
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (id === "react")
        return {
          useRef(initial: unknown) {
            const i = refIndex++;
            refs[i] ??= { current: initial };
            return refs[i];
          },
          useState(initial: unknown) {
            const i = stateIndex++;
            if (!(i in states)) states[i] = initial;
            return [
              states[i],
              (value: unknown) => {
                states[i] = value;
              },
            ];
          },
          useMemo: (fn: () => unknown) => fn(),
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
          useQuery(options: QueryOptions) {
            const key = String(options.queryKey[0]);
            queries.set(key, options);
            return {
              data: [],
              isPending: options.enabled === false,
              isError: false,
              isFetching: false,
              ...queryStates.get(key),
              refetch: () => {
                retries.push(key);
                return retryResult;
              },
            };
          },
          useQueryClient: () => ({
            invalidateQueries: (
              filter: { queryKey: string[] },
              options: { throwOnError?: boolean },
            ) => {
              refreshes.push({ filter, options });
              return refreshResult;
            },
          }),
        };
      if (id === "@/lib/db")
        return {
          sb: {
            from(table: string) {
              let mutation = false;
              dbCalls.push(["from", table]);
              const query = {
                select: (columns: string) => {
                  dbCalls.push(["select", table, columns]);
                  return query;
                },
                order: (column: string, options?: unknown) => {
                  dbCalls.push(["order", table, column, options]);
                  return query;
                },
                limit: (limit: number) => {
                  dbCalls.push(["limit", table, limit]);
                  return query;
                },
                in: (column: string, ids: string[]) => {
                  dbCalls.push(["in", table, column, Array.from(ids)]);
                  return query;
                },
                gte: (column: string, from: string) => {
                  dbCalls.push(["gte", table, column, from]);
                  return query;
                },
                eq: (column: string, value: string) => {
                  dbCalls.push(["eq", table, column, value]);
                  return query;
                },
                update: (payload: unknown) => {
                  mutation = true;
                  dbCalls.push(["update", table, payload]);
                  return query;
                },
                insert: (payload: unknown) => {
                  mutation = true;
                  dbCalls.push(["insert", table, payload]);
                  return query;
                },
                delete: () => {
                  mutation = true;
                  dbCalls.push(["delete", table]);
                  return query;
                },
                then: (
                  resolve: (result: DbResult) => unknown,
                  reject?: (error: unknown) => unknown,
                ) =>
                  Promise.resolve(
                    mutation ? mutationResult : (results.get(table) ?? { data: [], error: null }),
                  ).then(resolve, reject),
              };
              return query;
            },
          },
        };
      if (id === "@/lib/admin-secondary-actions") return actions;
      if (id === "sonner") return { toast: { error: (message: string) => errors.push(message) } };
      if (id === "@/components/admin/page-header") return { PageHeader: "PageHeader" };
      if (id === "@/components/admin/data-table") return { DataTable: "DataTable" };
      if (id === "@/components/admin/form-fields")
        return { Field: "Field", TextInput: "TextInput", TextArea: "TextArea" };
      if (id === "lucide-react")
        return { Pencil: "Pencil", Trash2: "Trash2", Plus: "Plus", X: "X", Check: "Check" };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return route.component();
  };
  const row: TestRow = {
    id: "record",
    email: "reader@example.test",
    active: true,
    created_at: "2026-10-07T00:00:00Z",
    title: "Post",
    slug: "post",
    status: "published",
    published_at: "2026-10-06T00:00:00Z",
    name: "Category",
    description: "Description",
    actor_id: "actor-id-1234",
    action: "update",
    entity: "posts",
    entity_id: "post-id-1234",
    meta: { name: "Post" },
  };
  const nodes = () => elements(render());
  const table = () => nodes().find((n) => n.type === "DataTable");
  const column = (key: string) => (table()!.props.columns as Column[]).find((c) => c.key === key)!;
  const button = (label: string) => {
    const result = nodes().find(
      (n) => n.type === "button" && (n.props["aria-label"] === label || textOf(n).trim() === label),
    );
    assert.ok(result, `Missing button: ${label}`);
    return result;
  };
  const rowButton = (key: string, label?: string) => {
    const buttons = elements(column(key).render(row)).filter((n) => n.type === "button");
    const result = label === "Delete" ? buttons[buttons.length - 1] : buttons[0];
    assert.ok(result, `Missing row button ${label ?? key}`);
    return result;
  };
  const click = (element: Element) => (element.props.onClick as () => unknown)();
  const submit = () => {
    const form = nodes().find((n) => n.type === "form");
    assert.ok(form);
    return (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
      preventDefault: () => {},
    });
  };
  const setQueryState = (state: Partial<QueryState>, key = keys[page]) => {
    queryStates.set(key, {
      isPending: false,
      isError: false,
      isFetching: false,
      ...queryStates.get(key),
      ...state,
    });
  };
  render();
  return {
    row,
    render,
    nodes,
    table,
    column,
    button,
    rowButton,
    click,
    submit,
    setQueryState,
    errors,
    dbCalls,
    refreshes,
    retries,
    downloads,
    queries,
    confirmations: () => confirmations,
    cancel: () => {
      confirmed = false;
    },
    result: (table: string, data: unknown[] | null, error: unknown = null) => {
      results.set(table, { data, error });
    },
    mutation: (value: DbResult | Promise<DbResult>) => {
      mutationResult = value;
    },
    refresh: (value: Promise<unknown>) => {
      refreshResult = value;
    },
    retry: (value: Promise<unknown>) => {
      retryResult = value;
    },
    query: (key = keys[page]) => queries.get(key)!.queryFn(),
    async load(key = keys[page]) {
      try {
        setQueryState({ data: await queries.get(key)!.queryFn() }, key);
      } catch (error) {
        setQueryState({ isError: true }, key);
        throw error;
      }
    },
  };
}

for (const page of Object.keys(files) as Page[]) {
  test(`${page}: load failures throw safely and show an alert with Retry instead of empty content`, async () => {
    const f = harness(page);
    f.result(tables[page], null, { message: "private database details" });
    await assert.rejects(f.load(), /Could not load/);
    assert.ok(f.nodes().some((n) => n.props.role === "alert"));
    assert.equal(f.table(), undefined);
    assert.doesNotMatch(textOf(f.render()), /No .*yet|Total clicks|private database/);
    f.click(f.button("Retry"));
    assert.deepEqual(f.retries, [
      keys[page],
      ...(page === "reports" ? ["admin-clicks-categories"] : []),
    ]);
    f.setQueryState({ isFetching: true });
    assert.equal(f.button("Retrying…").props.disabled, true);
  });
  test(`${page}: initial loading has status text and does not render successful content`, () => {
    const f = harness(page);
    f.setQueryState({ isPending: true, isFetching: true, data: undefined });
    assert.match(textOf(f.nodes().find((n) => n.props.role === "status")), /Loading/);
    assert.equal(f.table(), undefined);
    assert.doesNotMatch(textOf(f.render()), /No .*yet|Total clicks/);
  });
  test(`${page}: successful empty data remains legitimate`, async () => {
    const f = harness(page);
    f.result(tables[page], []);
    await f.load();
    assert.ok(!f.nodes().some((n) => n.props.role === "alert" || n.props.role === "status"));
    if (page === "reports") {
      assert.match(textOf(f.render()), /Total clicks 0/);
      assert.match(textOf(f.render()), /No clicks yet/);
      assert.match(textOf(f.render()), /No store clicks yet/);
      assert.match(textOf(f.render()), /No category clicks yet/);
      assert.equal(f.queries.get("admin-clicks-coupons")!.enabled, false);
    } else {
      assert.equal((f.table()!.props.rows as unknown[]).length, 0);
      if (page === "subscribers") assert.equal(f.table()!.props.emptyText, "No subscribers yet.");
      if (page === "activity")
        assert.equal(f.table()!.props.emptyText, "No admin actions logged yet.");
    }
  });
}

const rowActions = [
  { page: "subscribers", key: "active", label: undefined, operation: "update", noun: "subscriber" },
  { page: "subscribers", key: "actions", label: "Delete", operation: "delete", noun: "subscriber" },
  { page: "posts", key: "actions", label: "Delete", operation: "delete", noun: "post" },
  { page: "blog", key: "actions", label: "Delete", operation: "delete", noun: "blog category" },
] as const;
for (const action of rowActions) {
  const description = `${action.page} ${action.operation}`;
  const getButton = (f: ReturnType<typeof harness>) => f.rowButton(action.key, action.label);
  test(`${description}: database failure leaves visible state intact and does not refresh`, async () => {
    const f = harness(action.page);
    f.setQueryState({ data: [f.row] });
    f.mutation({ data: null, error: { message: "private DB internals" } });
    await f.click(getButton(f));
    await settle();
    assert.deepEqual(f.errors, [
      `Could not ${action.operation} this ${action.noun}. Please try again.`,
    ]);
    assert.equal(f.refreshes.length, 0);
    assert.equal((f.table()!.props.rows as TestRow[])[0].active, true);
    assert.equal(getButton(f).props.disabled, false);
  });
  test(`${description}: confirmed success refreshes the correct query with error propagation`, async () => {
    const f = harness(action.page);
    await f.click(getButton(f));
    await settle();
    assert.equal(f.dbCalls.filter((call) => call[0] === action.operation).length, 1);
    assert.equal(f.refreshes.length, 1);
    assert.deepEqual(Array.from(f.refreshes[0].filter.queryKey), [keys[action.page]]);
    assert.equal(f.refreshes[0].options.throwOnError, true);
    assert.deepEqual(f.errors, []);
    if (action.operation === "update")
      assert.equal(
        (f.dbCalls.find((call) => call[0] === "update")![2] as { active: boolean }).active,
        false,
      );
  });
  test(`${description}: duplicate invocation before rendering is blocked and buttons stay disabled through refresh`, async () => {
    const f = harness(action.page);
    const write = deferred<DbResult>();
    const refresh = deferred<unknown>();
    f.mutation(write.promise);
    f.refresh(refresh.promise);
    const original = getButton(f);
    f.click(original);
    f.click(original);
    await settle();
    assert.equal(f.dbCalls.filter((call) => call[0] === action.operation).length, 1);
    assert.equal(getButton(f).props.disabled, true);
    assert.match(String(getButton(f).props.title), /pending|Deleting/);
    if (action.page === "subscribers") {
      assert.equal(f.rowButton("active").props.disabled, true);
      assert.equal(f.rowButton("actions").props.disabled, true);
    }
    write.resolve({ data: null, error: null });
    await settle();
    assert.equal(getButton(f).props.disabled, true);
    f.click(original);
    await settle();
    assert.equal(f.dbCalls.filter((call) => call[0] === action.operation).length, 1);
    refresh.resolve(undefined);
    await settle();
    assert.equal(getButton(f).props.disabled, false);
  });
  test(`${description}: successful mutation followed by refresh rejection has a distinct message`, async () => {
    const f = harness(action.page);
    const refresh = deferred<unknown>();
    f.refresh(refresh.promise);
    f.click(getButton(f));
    await settle();
    refresh.reject(new Error("private refresh failure"));
    await settle();
    assert.equal(f.refreshes.length, 1);
    assert.match(f.errors[0], /was (updated|deleted), but the list could not be refreshed/);
    assert.doesNotMatch(f.errors[0], /Could not (delete|update)|private refresh/);
    assert.equal(getButton(f).props.disabled, false);
  });
  if (action.operation === "delete")
    test(`${description}: cancelled confirmation prevents the delete`, async () => {
      const f = harness(action.page);
      f.cancel();
      await f.click(getButton(f));
      await settle();
      assert.equal(f.dbCalls.length, 0);
      assert.equal(f.refreshes.length, 0);
      assert.equal(f.confirmations(), 1);
    });
}

for (const editing of [false, true]) {
  const description = editing ? "update" : "create";
  const open = (f: ReturnType<typeof harness>) =>
    f.click(editing ? f.rowButton("actions", "Edit") : f.button("Add New"));
  test(`blog ${description}: failure keeps modal open and shows a safe inline error`, async () => {
    const f = harness("blog");
    open(f);
    f.mutation({ data: null, error: { message: "private constraint" } });
    await f.submit();
    assert.ok(f.nodes().some((n) => n.type === "form"));
    assert.match(
      textOf(f.nodes().find((n) => n.props.role === "alert")),
      /Could not save this blog category/,
    );
    assert.equal(f.refreshes.length, 0);
    assert.equal(f.dbCalls.filter((call) => call[0] === (editing ? "update" : "insert")).length, 1);
  });
  test(`blog ${description}: success closes only after DB success, even if refresh later fails`, async () => {
    const f = harness("blog");
    open(f);
    const write = deferred<DbResult>();
    const refresh = deferred<unknown>();
    f.mutation(write.promise);
    f.refresh(refresh.promise);
    const saving = f.submit();
    assert.ok(f.nodes().some((n) => n.type === "form"));
    write.resolve({ data: null, error: null });
    await settle();
    assert.ok(!f.nodes().some((n) => n.type === "form"));
    assert.equal(f.refreshes.length, 1);
    assert.equal(f.refreshes[0].options.throwOnError, true);
    refresh.reject(new Error("refresh private"));
    await saving;
    assert.match(f.errors[0], /was saved, but the list could not be refreshed/);
    assert.doesNotMatch(f.errors[0], /Could not save/);
  });
  test(`blog ${description}: duplicate submit and close/edit actions are blocked during save`, async () => {
    const f = harness("blog");
    open(f);
    const write = deferred<DbResult>();
    f.mutation(write.promise);
    const form = f.nodes().find((n) => n.type === "form")!;
    const submit = form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>;
    const close = f.button("Cancel");
    const saving = submit({ preventDefault: () => {} });
    await submit({ preventDefault: () => {} });
    f.click(close);
    f.click(f.button("Close blog category form"));
    f.click(f.button("Add New"));
    assert.equal(f.button(editing ? "Updating…" : "Saving…").props.disabled, true);
    assert.equal(f.button("Cancel").props.disabled, true);
    assert.equal(f.button("Close blog category form").props.disabled, true);
    assert.equal(f.nodes().find((n) => n.type === "fieldset")!.props.disabled, true);
    assert.ok(f.nodes().some((n) => n.type === "form"));
    await settle();
    assert.equal(
      f.dbCalls.filter((call) => call[0] === "update" || call[0] === "insert").length,
      1,
    );
    write.resolve({ data: null, error: null });
    await saving;
    assert.ok(!f.nodes().some((n) => n.type === "form"));
    assert.equal(f.button("Add New").props.disabled, false);
  });
  test(`blog ${description}: unique conflict is friendly and error resets on New and Edit`, async () => {
    const f = harness("blog");
    open(f);
    f.mutation({ data: null, error: { code: "23505", message: "private_unique" } });
    await f.submit();
    assert.match(textOf(f.render()), /A blog category with that name or slug already exists/);
    assert.doesNotMatch(textOf(f.render()), /private_unique/);
    for (const nextEdit of [false, true]) {
      f.click(f.button("Cancel"));
      f.click(nextEdit ? f.rowButton("actions", "Edit") : f.button("Add New"));
      assert.ok(!f.nodes().some((n) => n.props.role === "alert"));
      await f.submit();
      assert.ok(f.nodes().some((n) => n.props.role === "alert"));
    }
  });
}

test("blog dependency delete failure is friendly and never refreshes", async () => {
  const f = harness("blog");
  f.mutation({ data: null, error: { code: "23503", message: "private_fk" } });
  f.click(f.rowButton("actions", "Delete"));
  await settle();
  assert.deepEqual(f.errors, [
    "This blog category is still referenced by one or more posts and cannot be deleted.",
  ]);
  assert.equal(f.refreshes.length, 0);
});

for (const [key, table] of [
  ["admin-clicks-coupons", "coupons"],
  ["admin-clicks-categories", "categories"],
]) {
  test(`reports: ${table} metadata failure hides statistics and retries all required queries`, async () => {
    const f = harness("reports");
    f.setQueryState({
      data: [{ id: "click", coupon_id: "coupon", source_page: null, clicked_at: "2026-10-07" }],
    });
    f.render();
    f.result(table, null, { message: "private metadata" });
    await assert.rejects(f.load(key), /Could not load report/);
    assert.ok(f.nodes().some((n) => n.props.role === "alert"));
    assert.doesNotMatch(
      textOf(f.render()),
      /Total clicks|No clicks|No store clicks|No category clicks/,
    );
    assert.equal(f.button("Export CSV").props.disabled, true);
    f.click(f.button("Retry"));
    assert.deepEqual(f.retries, [
      "admin-clicks",
      "admin-clicks-categories",
      "admin-clicks-coupons",
    ]);
  });
  test(`reports: pending ${table} metadata produces loading instead of analytics`, () => {
    const f = harness("reports");
    f.setQueryState({ data: [{ id: "click", coupon_id: "coupon", clicked_at: "2026-10-07" }] });
    f.setQueryState({ isPending: true, isFetching: true, data: undefined }, key);
    assert.match(textOf(f.render()), /Loading reports/);
    assert.doesNotMatch(textOf(f.render()), /Total clicks|No clicks/);
    assert.equal(f.button("Export CSV").props.disabled, true);
  });
}

test("reports: zero coupon IDs keep metadata disabled and Retry never forces that lookup", () => {
  const f = harness("reports");
  f.setQueryState({ isError: true }, "admin-clicks-categories");
  // A disabled query stays pending in TanStack; it must not block valid zero-click analytics.
  f.setQueryState({ isPending: true, isError: true }, "admin-clicks-coupons");
  f.click(f.button("Retry"));
  assert.deepEqual(f.retries, ["admin-clicks", "admin-clicks-categories"]);
  assert.equal(f.queries.get("admin-clicks-coupons")!.enabled, false);
  f.setQueryState({ isError: false }, "admin-clicks-categories");
  assert.match(textOf(f.render()), /No clicks yet/);
  assert.equal(f.button("Export CSV").props.disabled, false);
});

test("reports: click query retains selected columns, descending ordering, range and 5000 cap", async () => {
  const f = harness("reports");
  await f.query();
  assert.ok(
    f.dbCalls.some(
      (call) => call[0] === "select" && call[2] === "id,coupon_id,source_page,clicked_at",
    ),
  );
  const order = f.dbCalls.find((call) => call[0] === "order")!;
  assert.equal(order[2], "clicked_at");
  assert.equal((order[3] as { ascending: boolean }).ascending, false);
  assert.ok(f.dbCalls.some((call) => call[0] === "limit" && call[2] === 5000));
  assert.ok(f.dbCalls.some((call) => call[0] === "gte" && call[2] === "clicked_at"));
  const selector = f.nodes().find((n) => n.type === "select")!;
  assert.deepEqual(
    elements(selector)
      .filter((n) => n.type === "option")
      .map((n) => n.props.value),
    [7, 30, 90],
  );
  (selector.props.onChange as (e: { target: { value: string } }) => void)({
    target: { value: "7" },
  });
  f.render();
  assert.equal(f.queries.get("admin-clicks")!.queryKey[1], 7);
});

for (const page of ["subscribers", "reports"] as const) {
  test(`${page}: export blocks pending/error/fetching data and preserves the successful CSV format`, async () => {
    const f = harness(page);
    for (const state of [{ isPending: true }, { isError: true }, { isFetching: true }]) {
      f.setQueryState({ isPending: false, isError: false, isFetching: false, ...state });
      const exportButton = f.button("Export CSV");
      assert.equal(exportButton.props.disabled, true);
      f.click(exportButton);
      assert.equal(f.downloads.length, 0);
    }
    f.setQueryState({ isPending: false, isError: false, isFetching: false });
    if (page === "subscribers") f.setQueryState({ data: [f.row] });
    else {
      f.setQueryState({
        data: [
          {
            id: "click",
            coupon_id: "coupon",
            clicked_at: "2026-10-07",
            source_page: 'home,"sale"',
          },
        ],
      });
      f.setQueryState(
        {
          data: [
            {
              id: "coupon",
              title: 'Coupon, "deal"',
              stores: { id: "store", name: "Store", category_id: "cat" },
            },
          ],
        },
        "admin-clicks-coupons",
      );
    }
    assert.equal(f.button("Export CSV").props.disabled, false);
    f.click(f.button("Export CSV"));
    assert.equal(f.downloads.length, 1);
    const csv = await f.downloads[0].blob.text();
    assert.equal(
      f.downloads[0].filename,
      page === "subscribers" ? "subscribers.csv" : "clicks-30d.csv",
    );
    assert.equal(
      csv,
      page === "subscribers"
        ? "email,active,subscribed_at\nreader@example.test,true,2026-10-07T00:00:00Z"
        : 'clicked_at,coupon_id,coupon_title,store,source_page\n2026-10-07,coupon,"Coupon, ""deal""",Store,"home,""sale"""',
    );
  });
}

test("activity: profile failure fails the complete load, while legitimately missing profiles retain fallback", async () => {
  const f = harness("activity");
  f.result("admin_activity_log", [f.row]);
  f.result("profiles", null, { message: "private profile failure" });
  await assert.rejects(f.load(), /Could not load activity details/);
  assert.ok(f.nodes().some((n) => n.props.role === "alert"));
  assert.equal(f.table(), undefined);
  f.click(f.button("Retry"));
  assert.deepEqual(f.retries, ["admin-activity"]);
  f.result("profiles", []);
  const rows = (await f.query()) as TestRow[];
  assert.equal(rows[0].actor_name, "");
  f.setQueryState({ isError: false, data: rows });
  assert.match(textOf(f.column("actor").render(rows[0])), /actor-id/);
  assert.match(textOf(f.column("actor").render({ ...f.row, actor_id: null })), /System/);
});

test("activity: actor enrichment preserves IDs, actor names, labels, action style and search values", async () => {
  const f = harness("activity");
  f.result("admin_activity_log", [f.row]);
  f.result("profiles", [{ id: f.row.actor_id, display_name: "Admin" }]);
  const rows = (await f.query()) as TestRow[];
  assert.equal(rows[0].actor_name, "Admin");
  const profileLookup = f.dbCalls.find((call) => call[0] === "in")!;
  assert.deepEqual(profileLookup.slice(1), ["profiles", "id", [f.row.actor_id]]);
  assert.match(textOf(f.column("entity").render(f.row)), /Blog Post/);
  assert.match(String(f.column("action").render(f.row).props.className), /bg-blue-100/);
  assert.equal(f.column("actor").searchValue!(rows[0]), "Admin");
  assert.equal(f.column("action").searchValue!(f.row), "update");
  assert.equal(f.column("name").searchValue!(f.row), "Post");
});

test("activity: empty/actorless loads skip profiles and retain 500-row descending query", async () => {
  const f = harness("activity");
  await f.query();
  assert.ok(!f.dbCalls.some((call) => call[1] === "profiles"));
  assert.ok(
    f.dbCalls.some(
      (call) => call[0] === "limit" && call[1] === "admin_activity_log" && call[2] === 500,
    ),
  );
  const order = f.dbCalls.find((call) => call[0] === "order")!;
  assert.equal(order[2], "created_at");
  assert.equal((order[3] as { ascending: boolean }).ascending, false);
  f.result("admin_activity_log", [{ ...f.row, actor_id: null }]);
  await f.query();
  assert.ok(!f.dbCalls.some((call) => call[1] === "profiles"));
});

test("posts: edit/add links, status, published date and title search remain available", () => {
  const f = harness("posts");
  assert.equal(f.column("title").searchValue!(f.row), "Post");
  assert.match(textOf(f.column("status").render(f.row)), /published/);
  assert.match(String(f.column("status").render(f.row).props.className), /bg-emerald-100/);
  assert.equal(
    f.column("published_at").render(f.row),
    new Date(f.row.published_at).toLocaleDateString(),
  );
  assert.equal(f.column("published_at").render({ ...f.row, published_at: "" }), "—");
  assert.ok(
    elements(f.column("actions").render(f.row)).some(
      (n) => n.type === "Link" && n.props.to === "/admin/posts/$id",
    ),
  );
  assert.ok(f.nodes().some((n) => n.type === "Link" && n.props.to === "/admin/posts/new"));
});
