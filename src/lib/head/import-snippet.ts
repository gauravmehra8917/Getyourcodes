// Snippet importer for the Head Manager.
// Parses a pasted third-party snippet into a Head Manager entry payload.
// It NEVER normalizes or renames attributes: a tag is only stored as a
// structured entry when the existing rendering engine reproduces it exactly.
// Anything else is stored verbatim as a Raw Custom Head HTML entry.

import { validateJsonLd } from "./render";

export type SnippetSection = "verification" | "analytics" | "structured_data" | "custom_html";

export type SnippetEntryPayload = {
  section: SnippetSection;
  provider: string;
  type: string;
  name: string;
  value: string | null;
  content: string | null;
  enabled: boolean;
  notes: string | null;
};

export type SnippetParseResult = {
  payload: SnippetEntryPayload;
  /** How the snippet was interpreted, shown to the admin before saving. */
  mode: "structured" | "raw";
  /** Human readable explanation of the decision. */
  reason: string;
  /** Tags detected at the top level of the snippet. */
  tags: { tag: string; attrs: Record<string, string>; children?: string }[];
  warnings: string[];
};

const ORIGINAL_MARKER = "Original snippet:";

export function originalSnippetFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const idx = notes.indexOf(ORIGINAL_MARKER);
  if (idx === -1) return null;
  return notes.slice(idx + ORIGINAL_MARKER.length).replace(/^\n/, "");
}

function buildNotes(note: string, original: string): string {
  const head = note.trim() ? `${note.trim()}\n\n` : "";
  return `${head}${ORIGINAL_MARKER}\n${original}`;
}

type Tag = { tag: string; attrs: Record<string, string>; children?: string; raw: string };

const VOID_TAGS = new Set(["meta", "link", "base"]);

/** Tolerant top-level tag scanner. Attribute order and casing of values are preserved. */
export function scanTags(input: string): { tags: Tag[]; stray: string[] } {
  const text = input.trim();
  const tags: Tag[] = [];
  const stray: string[] = [];
  const tagRe = /<\s*([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g;
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(text)) !== null) {
    const between = text.slice(cursor, m.index).trim();
    if (between && !/^<!--[\s\S]*-->$/.test(between)) stray.push(between);

    const tag = m[1]!.toLowerCase();
    const attrSrc = m[2] ?? "";
    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(attrSrc)) !== null) {
      attrs[a[1]!] = a[3] ?? a[4] ?? a[5] ?? "";
    }

    const openEnd = tagRe.lastIndex;
    let children: string | undefined;
    let end = openEnd;
    if (!VOID_TAGS.has(tag) && m[3] !== "/") {
      const close = text.toLowerCase().indexOf(`</${tag}`, openEnd);
      if (close === -1) {
        stray.push(`unclosed <${tag}>`);
        cursor = openEnd;
        continue;
      }
      children = text.slice(openEnd, close);
      const closeEnd = text.indexOf(">", close);
      end = closeEnd === -1 ? close : closeEnd + 1;
      tagRe.lastIndex = end;
    }
    tags.push({ tag, attrs, ...(children !== undefined ? { children } : {}), raw: text.slice(m.index, end) });
    cursor = end;
  }

  const trailing = text.slice(cursor).trim();
  if (trailing && !/^<!--[\s\S]*-->$/.test(trailing)) stray.push(trailing);
  return { tags, stray };
}

function attrKeys(attrs: Record<string, string>): Set<string> {
  return new Set(Object.keys(attrs).map((k) => k.toLowerCase()));
}

function subsetOf(attrs: Record<string, string>, allowed: string[]): boolean {
  const set = new Set(allowed);
  for (const k of attrKeys(attrs)) if (!set.has(k)) return false;
  return true;
}

function get(attrs: Record<string, string>, key: string): string | undefined {
  for (const [k, v] of Object.entries(attrs)) if (k.toLowerCase() === key) return v;
  return undefined;
}

export function parseSnippet(
  raw: string,
  section: SnippetSection,
  provider: string,
  note = "",
): { ok: false; error: string } | { ok: true; result: SnippetParseResult } {
  const original = (raw ?? "").trim();
  if (!original) return { ok: false, error: "Paste a snippet first." };

  const { tags, stray } = scanTags(original);
  const warnings: string[] = [];

  const rawEntry = (reason: string): SnippetParseResult => ({
    mode: "raw",
    reason,
    tags: tags.map(({ tag, attrs, children }) => ({ tag, attrs, ...(children !== undefined ? { children } : {}) })),
    warnings,
    payload: {
      section: "custom_html",
      provider: provider.trim() || tags[0]?.tag || "Custom",
      type: "html",
      name: "",
      value: null,
      content: original,
      enabled: true,
      notes: buildNotes(note, original),
    },
  });

  if (tags.length === 0) return { ok: false, error: "No HTML tags found in the snippet." };
  if (stray.length > 0) return { ok: true, result: rawEntry("Snippet contains text outside of tags or malformed HTML — stored raw.") };
  if (tags.length > 1) return { ok: true, result: rawEntry("Snippet contains multiple tags — stored raw.") };

  const t = tags[0]!;
  const structured = (payload: Partial<SnippetEntryPayload>, reason: string): SnippetParseResult => ({
    mode: "structured",
    reason,
    tags: [{ tag: t.tag, attrs: t.attrs, ...(t.children !== undefined ? { children: t.children } : {}) }],
    warnings,
    payload: {
      section,
      provider: provider.trim() || "Custom",
      type: t.tag,
      name: "",
      value: null,
      content: null,
      enabled: true,
      notes: buildNotes(note, original),
      ...payload,
    },
  });

  if (t.tag === "noscript") {
    return { ok: true, result: rawEntry("<noscript> is stored raw so the original markup is preserved.") };
  }

  if (t.tag === "script") {
    const src = get(t.attrs, "src");
    const type = get(t.attrs, "type");
    if (!src && (t.children ?? "").trim()) {
      if (type && type.toLowerCase() === "application/ld+json" && section === "structured_data") {
        const json = validateJsonLd(t.children ?? "");
        if (json.ok) {
          return { ok: true, result: structured({ section: "structured_data", type: "json-ld", content: (t.children ?? "").trim() }, "Parsed as a JSON-LD structured data entry.") };
        }
        warnings.push(json.error);
      }
      return { ok: true, result: rawEntry("Snippet contains inline JavaScript — stored raw so it is preserved byte-for-byte.") };
    }
    if (src && section === "analytics" && subsetOf(t.attrs, ["src", "async"])) {
      return { ok: true, result: structured({ section: "analytics", type: "script", value: src }, "Parsed as an external analytics script entry.") };
    }
    return { ok: true, result: rawEntry("Script tag carries attributes the structured renderer would alter — stored raw to preserve them exactly.") };
  }

  if (t.tag === "meta") {
    const name = get(t.attrs, "name");
    const content = get(t.attrs, "content");
    if (name && content !== undefined && subsetOf(t.attrs, ["name", "content"])) {
      if (section === "verification") {
        return { ok: true, result: structured({ section: "verification", type: "meta", name, value: content }, "Parsed as a verification meta tag.") };
      }
      if (section === "analytics") {
        return { ok: true, result: structured({ section: "analytics", type: "meta", name, value: content }, "Parsed as an analytics meta tag.") };
      }
    }
    return { ok: true, result: rawEntry("Meta tag uses attributes outside name/content — stored raw so every attribute is preserved.") };
  }

  if (t.tag === "link") {
    const rel = get(t.attrs, "rel");
    const href = get(t.attrs, "href");
    if (section === "verification" && rel && href && subsetOf(t.attrs, ["rel", "href"])) {
      return { ok: true, result: structured({ section: "verification", type: "link", name: rel, value: href }, "Parsed as a verification link tag.") };
    }
    return { ok: true, result: rawEntry("Link tag stored raw so every attribute is preserved.") };
  }

  return { ok: true, result: rawEntry(`<${t.tag}> is stored raw.`) };
}
