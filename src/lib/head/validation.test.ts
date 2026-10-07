import assert from "node:assert/strict";
import test from "node:test";
import { validateHeadEntryForSave, headEntryErrorMessage } from "./validation.ts";
import { parseSnippet, prepareSnippetForSave, originalSnippetFromNotes } from "./import-snippet.ts";
import { renderHeadEntries, type HeadEntryInput } from "./render.ts";

const entry = (overrides: Partial<HeadEntryInput> = {}): HeadEntryInput => ({
  id: "row",
  section: "verification",
  provider: "Example",
  type: "meta",
  name: "site-verification",
  value: "token",
  ...overrides,
});
const validate = (candidate: HeadEntryInput, existing: HeadEntryInput[] = [], editingId?: string) =>
  validateHeadEntryForSave({ candidate, existing, editingId });
const json = '{"@context":"https://schema.org","@type":"Organization"}';
for (const [label, candidate] of [
  ["provider", entry({ provider: "  " })],
  ["verification name", entry({ name: " " })],
  ["verification value", entry({ value: " " })],
  ["verification type", entry({ type: "script" })],
  [
    "analytics URL or content",
    entry({ section: "analytics", type: "script", value: null, content: " " }),
  ],
  ["analytics meta name", entry({ section: "analytics", name: " " })],
  ["analytics meta value", entry({ section: "analytics", value: null, content: "ignored" })],
  [
    "analytics unsafe URL",
    entry({ section: "analytics", type: "script", value: "http://example.test" }),
  ],
  ["verification unsafe href", entry({ type: "link", value: "//example.test" })],
  ["analytics unsupported type", entry({ section: "analytics", type: "noscript" })],
  ["JSON-LD", entry({ section: "structured_data", type: "json-ld", content: "{}" })],
  [
    "custom sanitizer",
    entry({ section: "custom_html", type: "html", content: '<meta onclick="x">' }),
  ],
  [
    "disabled unsafe candidate",
    entry({ enabled: false, section: "custom_html", type: "html", content: "<iframe></iframe>" }),
  ],
  [
    "partly renderable duplicate custom tags",
    entry({
      section: "custom_html",
      type: "html",
      content: '<meta name="a" content="b"><meta name="a" content="b">',
    }),
  ],
  ["unknown section", entry({ section: "constructor" })],
] as Array<[string, HeadEntryInput]>)
  test(`save validation requires safe ${label}`, () => assert.equal(validate(candidate).ok, false));

test("save trims fields and removes content hidden by the meta form", () => {
  const result = validate(
    entry({
      provider: " Example ",
      name: " site-verification ",
      value: " token ",
      content: "old script",
    }),
  );
  assert.ok(result.ok);
  assert.equal(result.payload.provider, "Example");
  assert.equal(result.payload.name, "site-verification");
  assert.equal(result.payload.value, "token");
  assert.equal(result.payload.content, null);
});
for (const candidate of [
  entry({ section: "analytics", type: "script", value: "/a.js" }),
  entry({ section: "analytics", type: "script", value: null, content: "window.init();" }),
  entry({ section: "analytics", type: "script", value: "/a.js", content: "window.init();" }),
  entry({ section: "structured_data", type: "json-ld", content: `[${json}]` }),
  entry({ section: "custom_html", type: "html", content: '<meta name="x" value="token">' }),
])
  test(`valid ${candidate.section}/${candidate.type} saves`, () =>
    assert.equal(validate(candidate).ok, true));
for (const type of ["meta", "link"])
  test(`duplicate verification ${type} is case-insensitive and excludes the edited row`, () => {
    const candidate = entry({
      type,
      name: " SITE-VERIFICATION ",
      value: type === "link" ? "/check" : "new",
    });
    assert.equal(validate(candidate, [entry({ type })]).ok, false);
    assert.equal(validate(candidate, [entry({ type })], "row").ok, true);
    assert.equal(
      validate(candidate, [entry({ type: type === "link" ? "meta" : "link" })]).ok,
      true,
    );
  });
test("duplicate analytics provider is blocked across analytics types and disabled rows", () => {
  const candidate = entry({
    section: "analytics",
    type: "script",
    provider: " EXAMPLE ",
    value: "/a.js",
  });
  const existing = entry({ section: "analytics", enabled: false });
  assert.equal(validate(candidate, [existing]).ok, false);
  assert.equal(validate(candidate, [existing], "row").ok, true);
});
for (const section of ["structured_data", "custom_html"])
  test(`normalized exact ${section} duplicate is blocked`, () => {
    const content =
      section === "structured_data"
        ? json
        : '<meta name="x" value="token">\n<script>window.init();</script>';
    const candidate = entry({
      section,
      type: section === "structured_data" ? "json-ld" : "html",
      content: `  ${content}\n `,
    });
    const existing = entry({
      ...candidate,
      content:
        section === "structured_data"
          ? JSON.stringify(JSON.parse(json), null, 2)
          : content.replace(/\n/g, "\r\n"),
    });
    assert.equal(validate(candidate, [existing]).ok, false);
    assert.equal(validate(candidate, [existing], "row").ok, true);
  });

for (const [label, section, snippet, expectedSection, expectedType] of [
  [
    "verification meta",
    "verification",
    '<meta name="site-verification" content="token">',
    "verification",
    "meta",
  ],
  [
    "verification link",
    "verification",
    '<link rel="verification" href="/check">',
    "verification",
    "link",
  ],
  [
    "external script",
    "analytics",
    '<script src="https://example.test/a.js" async></script>',
    "analytics",
    "script",
  ],
  [
    "external script without async",
    "analytics",
    '<script src="/a.js"></script>',
    "analytics",
    "script",
  ],
  ["inline script", "analytics", "<script>window.init();</script>", "analytics", "script"],
  [
    "wrapped JSON-LD",
    "structured_data",
    `<script type="application/ld+json">${json}</script>`,
    "structured_data",
    "json-ld",
  ],
  ["raw JSON-LD", "structured_data", json, "structured_data", "json-ld"],
  ["raw JSON-LD array", "structured_data", `[${json}]`, "structured_data", "json-ld"],
  [
    "multiple supported tags",
    "verification",
    '<meta name="x" content="y"><link href="/check"><script>window.init();</script>',
    "custom_html",
    "html",
  ],
  [
    "unusual safe attributes",
    "verification",
    '<meta name="impact-site-verification" value="72d31b4c-56a7-4354-be2d-5f80dffb56be">',
    "custom_html",
    "html",
  ],
  [
    "script attributes",
    "analytics",
    '<script src="/a.js" defer data-key="1"></script>',
    "custom_html",
    "html",
  ],
] as const)
  test(`import ${label} produces a validated, renderable payload`, () => {
    const result = prepareSnippetForSave(snippet, section, " Example ", "internal note", []);
    assert.ok(result.ok);
    assert.equal(result.result.payload.section, expectedSection);
    assert.equal(result.result.payload.type, expectedType);
    assert.equal(result.result.payload.provider, "Example");
    assert.equal(originalSnippetFromNotes(result.result.payload.notes), snippet);
    const rendered = renderHeadEntries([result.result.payload]);
    assert.ok(rendered.html);
    assert.equal(rendered.skipped.length, 0);
  });
for (const snippet of [
  "<noscript><img></noscript>",
  "<script>window.init();</script><noscript>pixel</noscript>",
  "<iframe></iframe>",
  "<style>a{}</style>",
  "<div></div>",
  "<body></body>",
  "<html></html>",
  "<base href='/'>",
  "<script>unclosed",
  '<meta onerror="x">',
  '<script src="javascript:x"></script>',
  '<meta name="x" value="ok"> trailing',
])
  test(`unsupported import never produces a savable payload: ${snippet}`, () => {
    assert.equal(parseSnippet(snippet, "analytics", "Example").ok, false);
    assert.equal(prepareSnippetForSave(snippet, "analytics", "Example", "", []).ok, false);
  });
test("noscript import explains body-level tracking and retaining the script portion", () => {
  const result = parseSnippet("<noscript>pixel</noscript>", "analytics", "Example");
  assert.ok(!result.ok);
  assert.match(result.error, /document body/);
  assert.match(result.error, /script portion only/);
});
test("import provider is required and never falls back to Custom", () => {
  const result = prepareSnippetForSave('<meta name="x" content="y">', "verification", "  ", "", []);
  assert.ok(!result.ok);
  assert.equal(result.error, "Provider is required.");
});
for (const [section, snippet, existing] of [
  ["verification", '<meta name="SITE-VERIFICATION" content="new">', entry()],
  ["verification", '<link rel="site-verification" href="/check">', entry({ type: "link" })],
  ["analytics", '<script src="/a.js"></script>', entry({ section: "analytics" })],
  ["structured_data", json, entry({ section: "structured_data", content: json })],
  [
    "custom_html",
    '<meta name="x" value="y">',
    entry({ section: "custom_html", content: '<meta name="x" value="y">' }),
  ],
] as const)
  test(`import uses shared ${section} duplicate rules`, () =>
    assert.equal(prepareSnippetForSave(snippet, section, "example", "", [existing]).ok, false));
test("invalid wrapped and raw JSON-LD are rejected before insertion", () => {
  for (const snippet of ["{}", "[{}]", '{"bad":', '<script type="application/ld+json">{}</script>'])
    assert.equal(prepareSnippetForSave(snippet, "structured_data", "Example", "", []).ok, false);
});
for (const action of ["save", "update", "delete", "status", "import"] as const)
  test(`${action} maps permissions and hides database internals`, () => {
    const safe = headEntryErrorMessage(action, { message: "private_constraint", code: "23503" });
    assert.match(safe, /Could not/);
    assert.doesNotMatch(safe, /private|23503/);
    assert.match(headEntryErrorMessage(action, { code: "42501" }), /do not have permission/);
    assert.doesNotMatch(
      headEntryErrorMessage(action, { code: "23505", message: "private_unique" }),
      /private_unique/,
    );
  });
