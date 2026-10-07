import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as rendering from "./render.ts";
import * as validation from "./validation.ts";
import * as importer from "./import-snippet.ts";
import * as actions from "../admin-secondary-actions.ts";

type Element = { type: unknown; props: Record<string, unknown> };
type DbResult = { data?: unknown[] | null; error: unknown };
type QueryState = { data?: unknown[]; isPending: boolean; isError: boolean; isFetching: boolean };
type Column = { key: string; render: (record: typeof row) => Element };
const row = {
  id: "row",
  created_at: "2026-10-07T00:00:00Z",
  section: "verification",
  provider: "Example",
  type: "meta",
  name: "site-verification",
  value: "token",
  content: null,
  enabled: true,
  notes: null,
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return Array.from(value).map(textOf).join(" ");
  if (!value || typeof value !== "object") return "";
  const node = value as Element;
  return `${textOf(node.props?.children)} ${textOf(node.props?.action)}`
    .replace(/\s+/g, " ")
    .trim();
}

// Execute actual components/handlers with mocked hooks and network boundaries, like P3-A3.
function harness(mode: "page" | "import" = "page") {
  const errors: string[] = [];
  const warnings: string[] = [];
  const events: string[] = [];
  const writes: Array<{ action: string; payload?: Record<string, unknown> }> = [];
  const refreshes: Array<{ options: { throwOnError?: boolean } }> = [];
  const query: QueryState = { data: [], isPending: false, isError: false, isFetching: false };
  const states = new Map<string, unknown[]>();
  const refs = new Map<string, Array<{ current: unknown }>>();
  let scope = "main";
  let stateIndex = 0;
  let refIndex = 0;
  let mutationResult: DbResult | Promise<DbResult> = { error: null };
  let refreshResult: Promise<unknown> = Promise.resolve();
  let readResult: DbResult = { data: [], error: null };
  let queryFn!: () => Promise<unknown[]>;
  let confirmed = true;
  let confirmations = 0;
  let retries = 0;
  let closes = 0;
  let existing: rendering.HeadEntryInput[] = [];
  let canWrite = true;
  let restoredFocus = 0;
  let openerDisabled = false;
  const activeElement = {
    matches: () => openerDisabled,
    focus: () => {
      restoredFocus++;
    },
  };
  const withScope = <T>(name: string, fn: () => T): T => {
    const previous = [scope, stateIndex, refIndex] as const;
    scope = name;
    stateIndex = 0;
    refIndex = 0;
    try {
      return fn();
    } finally {
      [scope, stateIndex, refIndex] = previous;
    }
  };
  const jsx = (type: unknown, props: Element["props"]) => ({ type, props });
  const exports: Record<string, unknown> = {};
  const file =
    mode === "page"
      ? "../../routes/admin.head-manager.tsx"
      : "../../components/admin/import-snippet-dialog.tsx";
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const refresh = () => {
    events.push("refresh");
    return refreshResult;
  };
  runInNewContext(output, {
    exports,
    document: { activeElement },
    confirm: () => {
      confirmations++;
      return confirmed;
    },
    require(id: string) {
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (id === "react")
        return {
          useState(initial: unknown) {
            const values = states.get(scope) ?? [];
            states.set(scope, values);
            const index = stateIndex++;
            if (!(index in values)) values[index] = initial;
            return [
              values[index],
              (value: unknown) => {
                values[index] = typeof value === "function" ? value(values[index]) : value;
              },
            ];
          },
          useRef(initial: unknown) {
            const values = refs.get(scope) ?? [];
            refs.set(scope, values);
            const index = refIndex++;
            values[index] ??= { current: initial };
            return values[index];
          },
          useMemo: (fn: () => unknown) => fn(),
        };
      if (id === "@tanstack/react-router")
        return { createFileRoute: () => (options: unknown) => options };
      if (id === "@tanstack/react-query")
        return {
          useQuery(options: { queryFn: typeof queryFn }) {
            queryFn = options.queryFn;
            return {
              ...query,
              refetch: () => {
                retries++;
                return Promise.resolve();
              },
            };
          },
          useQueryClient: () => ({
            invalidateQueries: (_filter: unknown, options: { throwOnError?: boolean }) => {
              refreshes.push({ options });
              return refresh();
            },
          }),
        };
      if (id === "@/lib/db")
        return {
          sb: {
            from() {
              let mutation = false;
              const db = {
                select: () => db,
                order: () => db,
                eq: () => db,
                insert: (payload: Record<string, unknown>) => {
                  mutation = true;
                  writes.push({ action: "insert", payload });
                  events.push("write");
                  return db;
                },
                update: (payload: Record<string, unknown>) => {
                  mutation = true;
                  writes.push({ action: "update", payload });
                  events.push("write");
                  return db;
                },
                delete: () => {
                  mutation = true;
                  writes.push({ action: "delete" });
                  events.push("write");
                  return db;
                },
                then: (
                  resolve: (result: DbResult) => unknown,
                  reject?: (reason: unknown) => unknown,
                ) => Promise.resolve(mutation ? mutationResult : readResult).then(resolve, reject),
              };
              return db;
            },
          },
        };
      if (id === "@/lib/head/render") return rendering;
      if (id === "@/lib/head/validation") return validation;
      if (id === "@/lib/head/import-snippet") return importer;
      if (id === "@/lib/admin-secondary-actions") return actions;
      if (id === "sonner")
        return {
          toast: {
            error: (message: string) => errors.push(message),
            warning: (message: string) => warnings.push(message),
          },
        };
      if (id === "@radix-ui/react-dialog")
        return {
          Root: "DialogRoot",
          Portal: "DialogPortal",
          Overlay: "DialogOverlay",
          Content: "DialogContent",
          Title: "DialogTitle",
          Description: "DialogDescription",
        };
      if (id === "@/components/admin/page-header") return { PageHeader: "PageHeader" };
      if (id === "@/components/admin/data-table") return { DataTable: "DataTable" };
      if (id === "@/components/admin/import-snippet-dialog")
        return { ImportSnippetDialog: "ImportSnippetDialog" };
      if (id === "@/components/admin/form-fields")
        return {
          Field: "Field",
          TextInput: "TextInput",
          TextArea: "TextArea",
          SelectInput: "SelectInput",
        };
      if (id === "lucide-react")
        return {
          Pencil: "Pencil",
          Trash2: "Trash2",
          Plus: "Plus",
          X: "X",
          Search: "Search",
          Code2: "Code2",
          ClipboardPaste: "ClipboardPaste",
        };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const component =
    mode === "page"
      ? (exports.Route as { component: () => Element }).component
      : (exports.ImportSnippetDialog as (props: Record<string, unknown>) => Element);
  const render = () =>
    withScope("main", () =>
      component({
        existing,
        canWrite,
        onClose: () => {
          events.push("close");
          closes++;
        },
        onSaved: refresh,
        onRestoreFocus: () => {
          restoredFocus++;
        },
      }),
    );
  const elements = (value: unknown): Element[] => {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return Array.from(value).flatMap(elements);
    const node = value as Element;
    if (typeof node.type === "function") {
      const component = node.type;
      return withScope(component.name, () => elements(component(node.props)));
    }
    if (node.type === "DialogRoot" && !node.props.open) return [node];
    return [node, ...elements(node.props?.children), ...elements(node.props?.action)];
  };
  const nodes = () => elements(render());
  const find = (type: unknown) => nodes().find((node) => node.type === type);
  const button = (label: string) => {
    const node = nodes().find(
      (node) =>
        node.type === "button" && (textOf(node) === label || node.props["aria-label"] === label),
    );
    assert.ok(node, `Missing button ${label}`);
    return node;
  };
  const click = (node: Element) => (node.props.onClick as () => unknown)();
  const submit = () =>
    (find("form")!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  const set = (label: string, value: string) => {
    const field = nodes()
      .filter((node) => node.type === "Field" && node.props.label === label)
      .at(-1);
    assert.ok(field, `Missing field ${label}`);
    const input = elements(field.props.children).find((node) =>
      ["TextInput", "TextArea", "SelectInput"].includes(String(node.type)),
    )!;
    (input.props.onChange as (event: unknown) => void)({ target: { value } });
  };
  const rowButton = (column: string, label?: string, record = row) => {
    const columns = find("DataTable")!.props.columns as Column[];
    const value = columns.find((item) => item.key === column)!.render(record);
    const buttons = elements(value).filter((item) => item.type === "button");
    return label === "Delete" ? buttons.at(-1)! : buttons[0];
  };
  render();
  return {
    render,
    nodes,
    find,
    button,
    click,
    submit,
    set,
    rowButton,
    query,
    errors,
    warnings,
    writes,
    events,
    refreshes,
    fields: () =>
      nodes()
        .filter((node) => node.type === "Field")
        .map((node) => node.props.label),
    restoredFocus: () => restoredFocus,
    disableOpener: () => {
      openerDisabled = true;
    },
    retries: () => retries,
    closes: () => closes,
    confirmations: () => confirmations,
    cancelDelete: () => {
      confirmed = false;
    },
    mutation: (value: typeof mutationResult) => {
      mutationResult = value;
    },
    refresh: (value: Promise<unknown>) => {
      refreshResult = value;
    },
    existing: (value: typeof existing) => {
      existing = value;
    },
    canWrite: (value: boolean) => {
      canWrite = value;
    },
    async load(data: unknown[] | null, error: unknown = null) {
      readResult = { data, error };
      try {
        query.data = await queryFn();
      } catch (error) {
        query.isError = true;
        throw error;
      }
    },
  };
}
function fillSave(f: ReturnType<typeof harness>, mode: "page" | "import") {
  if (mode === "page") {
    f.click(f.button("Add Entry"));
    f.set("Provider", "Example");
    f.set("Name / Key", "site-verification");
    f.set("Value", "token");
  } else {
    f.set("Provider", "Example");
    f.set("Snippet", '<meta name="site-verification" content="token">');
  }
}

test("load error has alert and Retry, hides successful content, and disables Add/Import and section adds", async () => {
  const f = harness();
  await assert.rejects(
    f.load(null, { message: "private_database" }),
    /Could not load Head Manager/,
  );
  assert.ok(f.nodes().some((node) => node.props.role === "alert"));
  assert.equal(f.find("DataTable"), undefined);
  assert.doesNotMatch(textOf(f.render()), /No head entries|private_database/);
  for (const label of ["Add Entry", "Import Snippet", "Add to Verification Tags"])
    assert.equal(f.button(label).props.disabled, true);
  f.click(f.button("Retry"));
  assert.equal(f.retries(), 1);
  f.query.isFetching = true;
  assert.equal(f.button("Retrying…").props.disabled, true);
  f.query.isError = false;
  f.query.isFetching = false;
  assert.equal(f.button("Add Entry").props.disabled, false);
});
test("initial loading uses status and successful empty results stay distinct", async () => {
  const f = harness();
  f.query.isPending = true;
  assert.match(
    textOf(f.nodes().find((node) => node.props.role === "status")),
    /Loading Head Manager/,
  );
  assert.equal(f.find("DataTable"), undefined);
  f.query.isPending = false;
  await f.load([]);
  assert.equal(f.find("DataTable")!.props.emptyText, "No head entries match these filters.");
});
test("section selection and Add controls are separate keyboard buttons without nested controls", () => {
  const f = harness();
  const buttons = f.nodes().filter((node) => node.type === "button");
  assert.equal(buttons.filter((node) => node.props["aria-pressed"] !== undefined).length, 4);
  assert.equal(
    buttons.filter((node) => String(node.props["aria-label"]).startsWith("Add to ")).length,
    4,
  );
  for (const button of buttons)
    assert.doesNotMatch(JSON.stringify(button.props.children), /"type":"button"|"onClick"/);
  f.click(f.button("Add to Custom Head Tags"));
  assert.ok(f.fields().includes("Content"));
});
test("preview defaults collapsed, expands to canonical SSR output, and retains skipped diagnostics", () => {
  const f = harness();
  f.query.data = [
    { ...row, id: "z", value: "last" },
    { ...row, id: "a", value: "first" },
  ];
  assert.equal(f.find("pre"), undefined);
  assert.equal(f.button("Show").props["aria-expanded"], false);
  f.click(f.button("Show"));
  assert.equal(
    f.find("pre")!.props.children,
    rendering.renderHeadEntries(f.query.data as rendering.HeadEntryInput[]).html,
  );
  assert.ok(
    f.nodes().some((node) => /HTML generated by enabled Head Manager entries/.test(textOf(node))),
  );
  assert.ok(f.nodes().some((node) => textOf(node).includes("Skipped entries")));
  f.click(f.button("Hide"));
  assert.equal(f.find("pre"), undefined);
});
for (const [section, type, expected, hidden] of [
  [
    "verification",
    "meta",
    ["Provider", "Type", "Name / Key", "Value", "Notes"],
    ["Content", "Script URL"],
  ],
  ["verification", "link", ["Provider", "Name / Key (rel)", "Value (href)"], ["Content"]],
  [
    "analytics",
    "script",
    ["Provider", "Script URL", "Inline Script / Snippet (optional)"],
    ["Name / Key", "Value"],
  ],
  [
    "analytics",
    "meta",
    ["Provider", "Name / Key", "Value"],
    ["Content", "Script URL", "Inline Script / Snippet (optional)"],
  ],
  ["structured_data", "json-ld", ["Provider", "JSON-LD Content"], ["Type", "Name / Key", "Value"]],
  ["custom_html", "html", ["Provider", "Content"], ["Type", "Name / Key", "Value"]],
] as const)
  test(`${section}/${type} form only shows relevant entry fields`, () => {
    const f = harness();
    f.click(f.button("Add Entry"));
    f.set("Section", section);
    if (f.fields().includes("Type")) f.set("Type", type);
    const fields = f.fields();
    for (const label of expected) assert.ok(fields.includes(label));
    // The filter controls outside the form also have Section/Provider labels.
    for (const label of hidden) assert.ok(!fields.includes(label));
  });
test("Analytics selector excludes noscript and custom labels are truthful", () => {
  const f = harness();
  f.click(f.button("Add Entry"));
  f.set("Section", "analytics");
  const field = f.nodes().find((node) => node.type === "Field" && node.props.label === "Type")!;
  assert.doesNotMatch(textOf(field), /noscript/);
  assert.match(textOf(field), /script meta/);
  assert.doesNotMatch(textOf(f.render()), /Custom Head HTML|Arbitrary/);
});
test("provider, section and status filters work and Reset restores rows", () => {
  const f = harness();
  f.query.data = [
    row,
    { ...row, id: "other", provider: "Other", enabled: false, section: "analytics" },
  ];
  f.click(
    f.nodes().find((node) => node.type === "button" && node.props["aria-pressed"] !== undefined)!,
  );
  assert.equal((f.find("DataTable")!.props.rows as unknown[]).length, 1);
  f.click(f.button("Reset"));
  assert.equal((f.find("DataTable")!.props.rows as unknown[]).length, 2);
  f.set("Provider", "Other");
  assert.equal((f.find("DataTable")!.props.rows as unknown[]).length, 1);
  f.set("Status", "enabled");
  assert.equal((f.find("DataTable")!.props.rows as unknown[]).length, 0);
  f.click(f.button("Reset"));
  const search = f
    .nodes()
    .find((node) => node.type === "input" && node.props.placeholder === "Google, Meta, Bing…")!;
  (search.props.onChange as (event: unknown) => void)({ target: { value: "exam" } });
  assert.equal((f.find("DataTable")!.props.rows as unknown[]).length, 1);
});
for (const mode of ["page", "import"] as const) {
  test(`${mode}: shared duplicate validation prevents INSERT and shows an inline error`, async () => {
    const f = harness(mode);
    f.query.data = [row];
    f.existing([row]);
    fillSave(f, mode);
    await f.submit();
    assert.equal(f.writes.length, 0);
    assert.ok(f.nodes().some((node) => node.props.role === "alert"));
  });
  for (const thrown of [false, true])
    test(`${mode}: ${thrown ? "thrown" : "returned"} DB failure shows safe error and never refreshes`, async () => {
      const f = harness(mode);
      fillSave(f, mode);
      const pending = deferred<DbResult>();
      f.mutation(pending.promise);
      const saving = f.submit();
      await tick();
      if (thrown) pending.reject(new Error("private_constraint"));
      else pending.resolve({ error: { code: "42501", message: "private_constraint" } });
      await saving;
      assert.equal(f.events.includes("refresh"), false);
      assert.ok(f.nodes().some((node) => node.props.role === "alert"));
      assert.doesNotMatch(textOf(f.render()), /private_constraint/);
      assert.ok(f.find("form"));
    });
  test(`${mode}: rapid duplicate submit is blocked, busy dismissals are ignored, and write success closes before refresh`, async () => {
    const f = harness(mode);
    fillSave(f, mode);
    const pending = deferred<DbResult>();
    f.mutation(pending.promise);
    const first = f.submit();
    const second = f.submit();
    await tick();
    assert.equal(f.writes.length, 1);
    assert.equal(f.button("Saving…").props.disabled, true);
    assert.equal(f.button("Cancel").props.disabled, true);
    assert.equal(f.button("Close").props.disabled, true);
    assert.equal(f.find("fieldset")!.props.disabled, true);
    f.click(f.button("Cancel"));
    f.click(f.button("Close"));
    (f.find("DialogRoot")!.props.onOpenChange as (open: boolean) => void)(false);
    assert.ok(f.find("form"));
    assert.equal(f.closes(), 0);
    let prevented = 0;
    for (const name of ["onEscapeKeyDown", "onPointerDownOutside"])
      (f.find("DialogContent")!.props[name] as (event: unknown) => void)({
        preventDefault() {
          prevented++;
        },
      });
    assert.equal(prevented, 2);
    pending.resolve({ error: null });
    await Promise.all([first, second]);
    assert.equal(f.events.filter((event) => event === "refresh").length, 1);
    if (mode === "page") {
      assert.equal(f.find("form"), undefined);
      assert.equal(f.refreshes[0].options.throwOnError, true);
    } else {
      assert.equal(f.closes(), 1);
      assert.ok(f.events.indexOf("close") < f.events.indexOf("refresh"));
    }
  });
  test(`${mode}: refresh failure is a saved-change warning and keeps the dialog closed`, async () => {
    const f = harness(mode);
    fillSave(f, mode);
    const pending = deferred<unknown>();
    f.refresh(pending.promise);
    const saving = f.submit();
    await tick();
    if (mode === "page") assert.equal(f.find("form"), undefined);
    else assert.equal(f.closes(), 1);
    pending.reject(new Error("refresh details"));
    await saving;
    assert.equal(f.warnings.length, 1);
    assert.match(f.warnings[0], /was saved|was imported/);
    assert.match(f.warnings[0], /could not be refreshed/);
    assert.equal(f.errors.length, 0);
  });
  test(`${mode}: current load unavailability blocks writes even if a dialog is open`, async () => {
    const f = harness(mode);
    fillSave(f, mode);
    f.query.isError = true;
    f.canWrite(false);
    await f.submit();
    assert.equal(f.writes.length, 0);
  });
}
test("Edit excludes its row, blocks duplicate updates and reports refresh failures as updated", async () => {
  const f = harness();
  f.query.data = [row];
  f.click(f.rowButton("actions"));
  assert.equal(f.button("Update").props.disabled, false);
  const pending = deferred<DbResult>();
  f.mutation(pending.promise);
  const refresh = deferred<unknown>();
  f.refresh(refresh.promise);
  const first = f.submit();
  const second = f.submit();
  await tick();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].action, "update");
  pending.resolve({ error: null });
  await tick();
  assert.equal(f.find("form"), undefined);
  refresh.reject(new Error("refresh"));
  await Promise.all([first, second]);
  assert.match(f.warnings[0], /was updated/);
});
for (const action of ["toggle", "delete"] as const) {
  const control = (f: ReturnType<typeof harness>, record = row) =>
    action === "toggle"
      ? f.rowButton("enabled", undefined, record)
      : f.rowButton("actions", "Delete", record);
  test(`${action}: synchronous guard disables only its row, and prevents repeated writes/confirmations`, async () => {
    const f = harness();
    f.query.data = [row];
    const pending = deferred<DbResult>();
    f.mutation(pending.promise);
    f.click(control(f));
    f.click(control(f));
    await tick();
    assert.equal(f.writes.length, 1);
    assert.equal(control(f).props.disabled, true);
    assert.equal(control(f, { ...row, id: "other" }).props.disabled, false);
    if (action === "toggle") assert.equal(control(f).props.role, "switch");
    else assert.equal(f.confirmations(), 1);
    pending.resolve({ error: null });
    await tick();
    assert.equal(f.refreshes.length, 1);
    assert.equal(f.refreshes[0].options.throwOnError, true);
    assert.equal(control(f).props.disabled, false);
  });
  for (const thrown of [false, true])
    test(`${action}: ${thrown ? "thrown" : "returned"} DB failure shows safe toast without refresh`, async () => {
      const f = harness();
      f.query.data = [row];
      const pending = deferred<DbResult>();
      f.mutation(pending.promise);
      f.click(control(f));
      await tick();
      if (thrown) pending.reject(new Error("private_database"));
      else pending.resolve({ error: { message: "private_database" } });
      await tick();
      assert.equal(f.refreshes.length, 0);
      assert.equal(f.errors.length, 1);
      assert.doesNotMatch(f.errors[0], /private_database/);
      assert.equal(control(f).props.disabled, false);
    });
  test(`${action}: successful write with failed refresh produces a distinct warning`, async () => {
    const f = harness();
    f.query.data = [row];
    const pending = deferred<unknown>();
    f.refresh(pending.promise);
    f.click(control(f));
    await tick();
    pending.reject(new Error("refresh"));
    await tick();
    assert.equal(f.errors.length, 0);
    assert.equal(f.warnings.length, 1);
    assert.match(f.warnings[0], /was changed|was deleted/);
    assert.match(f.warnings[0], /could not be refreshed/);
  });
}
test("cancelled delete confirmation never writes", () => {
  const f = harness();
  f.query.data = [row];
  f.cancelDelete();
  f.click(f.rowButton("actions", "Delete"));
  assert.equal(f.writes.length, 0);
  assert.equal(f.refreshes.length, 0);
});
test("import rejects unsupported snippets and surfaces concise noscript/body feedback", async () => {
  const f = harness("import");
  f.set("Provider", "Example");
  f.set("Snippet", "<noscript>pixel</noscript>");
  assert.equal(f.button("Import").props.disabled, true);
  await f.submit();
  assert.equal(f.writes.length, 0);
  assert.match(textOf(f.render()), /document body/);
});

test("public loader selects canonical-order fields, enabled entries only, with deterministic ordering", async () => {
  const calls: Array<[string, unknown, unknown?]> = [];
  const db = {
    select: (fields: string) => {
      calls.push(["select", fields]);
      return db;
    },
    eq: (key: string, value: unknown) => {
      calls.push(["eq", key, value]);
      return db;
    },
    order: (key: string, options: unknown) => {
      calls.push(["order", key, options]);
      return db;
    },
    then: (resolve: (result: DbResult) => unknown) =>
      Promise.resolve({ data: [row], error: null }).then(resolve),
  };
  const exports: Record<string, unknown> = {};
  const output = ts.transpileModule(
    readFileSync(new URL("../head.functions.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  runInNewContext(output, {
    exports,
    process: {
      env: { SUPABASE_URL: "https://fixture.test", SUPABASE_PUBLISHABLE_KEY: "fixture-key" },
    },
    require(id: string) {
      if (id === "@tanstack/react-start")
        return { createServerFn: () => ({ handler: (fn: unknown) => fn }) };
      if (id === "@supabase/supabase-js") return { createClient: () => ({ from: () => db }) };
      throw new Error(id);
    },
  });
  await (exports.getEnabledHeadEntries as () => Promise<unknown>)();
  assert.match(String(calls[0][1]), /id,.*created_at/);
  assert.doesNotMatch(String(calls[0][1]), /notes|updated_at/);
  assert.deepEqual(
    calls.filter((call) => call[0] === "eq"),
    [["eq", "enabled", true]],
  );
  assert.deepEqual(
    calls.filter((call) => call[0] === "order").map((call) => call[1]),
    ["created_at", "id"],
  );
  assert.ok(
    calls
      .filter((call) => call[0] === "order")
      .every((call) => (call[2] as { ascending: boolean }).ascending),
  );
});
for (const file of ["src/routes/__root.tsx", "src/lib/admin-secondary-actions.ts"])
  test(`${file} remains byte-identical to the approved source`, () => {
    const approved = execFileSync("git", [
      "show",
      `db59edd7ad4b2eb96deada1a1a9f80886ccc8534:${file}`,
    ]);
    assert.deepEqual(readFileSync(new URL(`../../../${file}`, import.meta.url)), approved);
  });
test("no noscript/body/style/iframe injector is introduced", () => {
  assert.deepEqual(
    rendering.renderHeadEntries([
      { ...row, section: "analytics", type: "noscript", content: "<noscript>pixel</noscript>" },
    ]).scripts,
    [],
  );
  for (const snippet of ["<body></body>", "<iframe></iframe>", "<style></style>"])
    assert.equal(
      importer.prepareSnippetForSave(snippet, "custom_html", "Example", "", []).ok,
      false,
    );
});

for (const mode of ["page", "import"] as const)
  test(`${mode}: dialog close restores keyboard focus`, () => {
    const f = harness(mode);
    if (mode === "page") f.click(f.button("Add Entry"));
    let prevented = false;
    (f.find("DialogContent")!.props.onCloseAutoFocus as (event: unknown) => void)({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(f.restoredFocus(), 1);
  });
test("Add dialog restores focus to the page while its opener is disabled during refresh", () => {
  const f = harness();
  f.click(f.button("Add Entry"));
  f.disableOpener();
  let fallbackFocus = 0;
  (f.render().props.ref as { current: unknown }).current = {
    focus() {
      fallbackFocus++;
    },
  };
  (f.find("DialogContent")!.props.onCloseAutoFocus as (event: unknown) => void)({
    preventDefault() {},
  });
  assert.equal(f.restoredFocus(), 0);
  assert.equal(fallbackFocus, 1);
});
test("switching section or type clears feedback from a previous form shape", async () => {
  const f = harness();
  f.click(f.button("Add Entry"));
  f.set("Provider", "Example");
  await f.submit();
  assert.ok(f.nodes().some((node) => node.props.role === "alert"));
  f.set("Section", "analytics");
  assert.ok(!f.nodes().some((node) => node.props.role === "alert"));
  f.set("Type", "meta");
  await f.submit();
  assert.ok(f.nodes().some((node) => node.props.role === "alert"));
  f.set("Type", "script");
  assert.ok(!f.nodes().some((node) => node.props.role === "alert"));
});
test("editing historical JSON-LD stored in Value shows that content in the relevant field", () => {
  const f = harness();
  const legacy = {
    ...row,
    section: "structured_data",
    type: "json-ld",
    value: '{"@type":"Organization"}',
    content: null,
  };
  f.query.data = [legacy];
  f.click(f.rowButton("actions", undefined, legacy));
  const field = f
    .nodes()
    .find((node) => node.type === "Field" && node.props.label === "JSON-LD Content")!;
  assert.equal((field.props.children as Element).props.value, legacy.value);
});
