import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeHeadUrl,
  renderHeadEntries,
  sanitizeHeadHtml,
  sortHeadEntriesForRender,
  validateJsonLd,
  type HeadEntryInput,
} from "./render.ts";

const entry = (overrides: Partial<HeadEntryInput> = {}): HeadEntryInput => ({
  section: "verification",
  provider: "Example",
  type: "meta",
  name: "site-verification",
  value: "token",
  ...overrides,
});
const render = (overrides: Partial<HeadEntryInput>) => renderHeadEntries([entry(overrides)]);
const json = '{"@context":"https://schema.org","@type":"Organization"}';

for (const [label, overrides, expected] of [
  ["verification meta", {}, '<meta name="site-verification" content="token">'],
  [
    "verification link",
    { type: "link", name: "verification", value: "https://example.test/check" },
    '<link rel="verification" href="https://example.test/check">',
  ],
  [
    "external analytics script",
    { section: "analytics", type: "script", value: "https://example.test/a.js" },
    '<script src="https://example.test/a.js" async></script>',
  ],
  [
    "root-relative analytics script",
    { section: "analytics", type: "script", value: "/a.js" },
    '<script src="/a.js" async></script>',
  ],
  [
    "inline analytics script",
    { section: "analytics", type: "script", value: null, content: "window.track = true;" },
    "<script>window.track = true;</script>",
  ],
  [
    "analytics meta",
    { section: "analytics", type: "meta" },
    '<meta name="site-verification" content="token">',
  ],
  [
    "JSON-LD object",
    { section: "structured_data", type: "json-ld", content: json },
    `<script type="application/ld+json">${json}</script>`,
  ],
  [
    "JSON-LD array",
    { section: "structured_data", type: "json-ld", content: `[${json}]` },
    `<script type="application/ld+json">[${json}]</script>`,
  ],
  [
    "custom multi-tag",
    {
      section: "custom_html",
      type: "html",
      content:
        '<meta name="x" content="y"><link rel="preconnect" href="https://example.test"><script src="/a.js"></script>',
    },
    '<meta name="x" content="y">\n<link rel="preconnect" href="https://example.test">\n<script src="/a.js"></script>',
  ],
] as Array<[string, Partial<HeadEntryInput>, string]>) {
  test(`${label} renders supported descriptors and exact preview`, () => {
    const result = render(overrides);
    assert.equal(result.html, expected);
    assert.equal(result.skipped.length, 0);
    assert.ok(result.meta.length + result.links.length + result.scripts.length);
  });
}

for (const url of [
  "javascript:alert(1)",
  "vbscript:x",
  "data:application/javascript,x",
  "file:///a",
  "blob:https://example.test/a",
  "http://example.test/a",
  "//example.test/a",
  "./a.js",
  "a.js",
  "/\\example.test/a",
  "https:///example.test",
  "https://example.test/\na",
  "",
]) {
  test(`URL policy rejects ${JSON.stringify(url)} everywhere`, () => {
    assert.equal(isSafeHeadUrl(url), false);
    assert.equal(sanitizeHeadHtml(`<script src="${url}"></script>`).ok, false);
    for (const overrides of [
      { section: "analytics", type: "script" },
      { section: "verification", type: "link" },
    ]) {
      const result = render({ ...overrides, value: url, content: null });
      assert.equal(result.html, "");
      assert.equal(result.skipped.length, 1);
    }
  });
}
for (const url of [
  "https://example.test/a.js?x=1&y=2",
  "/assets/a.js",
  "/",
  "HTTPS://example.test",
]) {
  test(`URL policy accepts ${url} everywhere`, () => {
    assert.equal(isSafeHeadUrl(url), true);
    assert.equal(sanitizeHeadHtml(`<link href="${url}">`).ok, true);
    assert.ok(render({ type: "link", value: url }).html);
  });
}
for (const content of [
  '<meta onload="x">',
  '<script onclick="x"></script>',
  '<link onerror="x">',
  '<iframe src="https://example.test"></iframe>',
  "<style>a{}</style>",
  "<noscript><img></noscript>",
  "<div>x</div>",
  "<body></body>",
  "<html></html>",
  "<script>x",
  '<script src="/a.js"/>',
  '<meta name="x" =bad>',
  '<meta name="x" name="y">',
  '<meta name="unclosed>',
  "<!-- unclosed",
  "<meta><oops>",
  "<script></script extra>",
  "<meta> stray",
]) {
  test(`sanitizer rejects unsupported or malformed markup: ${content}`, () => {
    assert.equal(sanitizeHeadHtml(content).ok, false);
    assert.equal(render({ section: "custom_html", type: "html", content }).html, "");
  });
}

test("attribute parsing consumes quoted > characters and preserves entities correctly", () => {
  const result = render({
    section: "custom_html",
    type: "html",
    content: '<meta name="x" content="a > b &amp; c"><script src="/a.js?x=1&amp;y=2"></script>',
  });
  assert.equal(result.skipped.length, 0);
  assert.equal(result.meta[0].content, "a > b & c");
  assert.equal(result.scripts[0].src, "/a.js?x=1&y=2");
  assert.match(result.html, /a &gt; b &amp; c/);
});
test("encoded protocol-relative URLs cannot bypass the URL policy", () => {
  for (const href of ["&#47;&#47;evil.test", "/&#92;evil.test", "https:&sol;&sol;&sol;evil.test"])
    assert.equal(sanitizeHeadHtml(`<link href="${href}">`).ok, false);
});
test("inline JavaScript with comparisons, HTML strings and comments stays intact", () => {
  const content = 'if (1 < 2) window.html = "<div></div>"; // intentional admin code';
  assert.equal(
    render({ section: "analytics", type: "script", value: null, content }).scripts[0].children,
    content,
  );
});
test("external plus inline initialization uses the same sanitizer and rejects breakouts atomically", () => {
  const base = { section: "analytics", type: "script", value: "https://example.test/a.js" };
  assert.equal(render({ ...base, content: "window.init();" }).scripts.length, 2);
  assert.equal(render({ ...base, content: '</script><meta onload="x">' }).html, "");
});
test("JSON-LD script breakout is escaped without changing parsed values", () => {
  const content = '{"@type":"Thing","name":"</script><script>bad()</script>"}';
  const result = validateJsonLd(content);
  assert.ok(result.ok);
  assert.doesNotMatch(result.json, /</);
  assert.match(result.json, /\\u003c/);
  assert.deepEqual(JSON.parse(result.json), JSON.parse(content));
});
for (const content of [
  "not json",
  "null",
  '"string"',
  "[]",
  "[1]",
  "[[]]",
  "{}",
  '[{"@type":"Thing"},{}]',
]) {
  test(`invalid JSON-LD is skipped: ${content}`, () => {
    assert.equal(validateJsonLd(content).ok, false);
    assert.equal(render({ section: "structured_data", content }).html, "");
  });
}
test("production Impact verification keeps its exact value attribute", () => {
  const value = "72d31b4c-56a7-4354-be2d-5f80dffb56be";
  const content = `<meta\n name='impact-site-verification'\n value='${value}'\n>`;
  assert.equal(sanitizeHeadHtml(content).ok, true);
  const result = render({ section: "custom_html", provider: "Impact", type: "html", content });
  assert.deepEqual(result.meta, [{ name: "impact-site-verification", value }]);
  assert.equal(result.html, `<meta name="impact-site-verification" value="${value}">`);
  assert.doesNotMatch(result.html, /content=/);
});
test("canonical order sorts by chronological created_at then id without mutating input", () => {
  const rows = [
    entry({ id: "z", created_at: "2026-10-07T02:00:00Z" }),
    entry({ id: "b", created_at: "2026-10-07T01:00:00Z" }),
    entry({ id: "a", created_at: "2026-10-07T06:30:00+05:30" }),
  ];
  const before = [...rows];
  const sorted = sortHeadEntriesForRender(rows);
  assert.deepEqual(
    sorted.map((row) => row.id),
    ["a", "b", "z"],
  );
  assert.deepEqual(rows, before);
  assert.notEqual(sorted, rows);
});
test("canonical ordering controls duplicate winners regardless of input order", () => {
  const first = entry({ id: "a", created_at: "2026-10-07T00:00:00Z", value: "first" });
  const last = entry({ id: "b", created_at: first.created_at, value: "last" });
  assert.deepEqual(renderHeadEntries([last, first]), renderHeadEntries([first, last]));
  assert.equal(renderHeadEntries([last, first]).meta[0].content, "first");
});
test("invalid historical rows, disabled rows, unsupported analytics types and duplicate providers are skipped", () => {
  const result = renderHeadEntries([
    entry({ section: "analytics", type: "noscript" }),
    entry({ enabled: false }),
    entry({ section: "unknown" }),
    entry({ section: "analytics", type: "script", value: "/a.js" }),
    entry({ section: "analytics", type: "script", value: "/b.js", provider: "EXAMPLE" }),
  ]);
  assert.equal(result.scripts.length, 1);
  assert.equal(result.skipped.length, 4);
});
test("invalid first analytics row does not suppress a later valid row", () => {
  const result = renderHeadEntries([
    entry({ section: "analytics", type: "script", value: "http://example.test" }),
    entry({ section: "analytics", type: "script", value: "/a.js" }),
  ]);
  assert.equal(result.scripts.length, 1);
});
