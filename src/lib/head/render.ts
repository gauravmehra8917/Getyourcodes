// Head Rendering Engine — data-driven, provider-agnostic.
// Consumes Head Manager entries and produces TanStack head descriptors
// plus an exact HTML preview. No provider-specific logic lives here.

export type HeadSection = "verification" | "analytics" | "structured_data" | "custom_html";

export type HeadEntryInput = {
  id?: string;
  section: string;
  provider: string;
  type: string;
  name: string;
  value?: string | null;
  content?: string | null;
  enabled?: boolean;
};

export type MetaDescriptor = Record<string, string>;
export type LinkDescriptor = Record<string, string>;
export type ScriptDescriptor = { children?: string; [attr: string]: string | undefined };

export type RenderedHead = {
  meta: MetaDescriptor[];
  links: LinkDescriptor[];
  scripts: ScriptDescriptor[];
  html: string;
  skipped: { entry: HeadEntryInput; reason: string }[];
};

const ALLOWED_TAGS = new Set(["meta", "link", "script"]);
const URL_ATTRS = new Set(["src", "href"]);

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  return !(v.startsWith("javascript:") || v.startsWith("data:text/html") || v.startsWith("vbscript:"));
}

/** Validate a JSON-LD payload. Returns compacted JSON or an error. */
export function validateJsonLd(raw: string): { ok: true; json: string } | { ok: false; error: string } {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, error: "JSON-LD content is empty." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, error: "JSON-LD must be an object or an array of objects." };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "Each JSON-LD item must be an object." };
    }
    if (!("@context" in (item as Record<string, unknown>)) && !("@type" in (item as Record<string, unknown>))) {
      return { ok: false, error: "JSON-LD must include @context or @type." };
    }
  }
  // Prevent breaking out of the script element.
  const json = JSON.stringify(parsed).replace(/</g, "\\u003c");
  return { ok: true, json };
}

type ParsedTag = { tag: string; attrs: Record<string, string>; children?: string };

/** Parse + sanitize raw head HTML into a whitelist of tag descriptors. */
export function sanitizeHeadHtml(
  raw: string,
): { ok: true; tags: ParsedTag[] } | { ok: false; error: string } {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, error: "HTML content is empty." };

  const tags: ParsedTag[] = [];
  const tagRe = /<\s*([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  let cursor = 0;
  let found = 0;

  while ((match = tagRe.exec(text)) !== null) {
    const between = text.slice(cursor, match.index).trim();
    if (between && !between.startsWith("<!--")) {
      return { ok: false, error: "Malformed HTML: stray text outside of tags." };
    }
    found += 1;
    const tag = match[1]!.toLowerCase();
    const attrSrc = match[2] ?? "";
    if (!ALLOWED_TAGS.has(tag)) {
      return { ok: false, error: `Tag <${tag}> is not allowed in the head. Allowed: meta, link, script.` };
    }

    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(attrSrc)) !== null) {
      const key = a[1]!.toLowerCase();
      const val = a[3] ?? a[4] ?? a[5] ?? "";
      if (key.startsWith("on")) {
        return { ok: false, error: `Inline event handler "${key}" is not allowed.` };
      }
      if (URL_ATTRS.has(key) && val && !safeUrl(val)) {
        return { ok: false, error: `Unsafe URL in "${key}".` };
      }
      attrs[key] = val;
    }

    let children: string | undefined;
    cursor = tagRe.lastIndex;
    if (tag === "script" && match[3] !== "/") {
      const closeIdx = text.toLowerCase().indexOf("</script>", cursor);
      if (closeIdx === -1) return { ok: false, error: "Malformed HTML: unclosed <script> tag." };
      children = text.slice(cursor, closeIdx);
      cursor = closeIdx + "</script>".length;
      tagRe.lastIndex = cursor;
    } else if (tag === "link" || tag === "meta") {
      // void elements — nothing to close
    }
    tags.push({ tag, attrs, ...(children ? { children } : {}) });
  }

  const trailing = text.slice(cursor).trim();
  if (trailing) return { ok: false, error: "Malformed HTML: stray content after the last tag." };
  if (!found) return { ok: false, error: "No valid head tags found." };
  if (/<\s*\//.test(text.replace(/<\/script>/gi, ""))) {
    return { ok: false, error: "Malformed HTML: unexpected closing tag." };
  }
  return { ok: true, tags };
}

function entryKey(section: string, tag: string, attrs: Record<string, string>): string {
  const ident = attrs["name"] ?? attrs["property"] ?? attrs["http-equiv"] ?? attrs["src"] ?? attrs["href"] ?? "";
  return `${section}|${tag}|${ident.toLowerCase()}`;
}

function serializeTag(tag: string, attrs: Record<string, string>, children?: string): string {
  const attrText = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => (v === "" ? k : `${k}="${escapeAttr(String(v))}"`))
    .join(" ");
  const open = `<${tag}${attrText ? ` ${attrText}` : ""}>`;
  if (tag === "meta" || tag === "link") return open;
  return `${open}${children ?? ""}</${tag}>`;
}

/**
 * Build head descriptors from Head Manager entries.
 * Disabled entries, invalid JSON-LD, malformed HTML, duplicate verification
 * meta names and duplicate analytics providers are skipped with a reason.
 */
export function renderHeadEntries(entries: HeadEntryInput[]): RenderedHead {
  const meta: MetaDescriptor[] = [];
  const links: LinkDescriptor[] = [];
  const scripts: ScriptDescriptor[] = [];
  const htmlParts: string[] = [];
  const skipped: { entry: HeadEntryInput; reason: string }[] = [];

  const seenTags = new Set<string>();
  const seenVerification = new Set<string>();
  const seenAnalyticsProvider = new Set<string>();

  const push = (kind: "meta" | "link" | "script", attrs: Record<string, string>, children?: string, sectionKey = "") => {
    const key = entryKey(sectionKey, kind, attrs) + (children ? `|${children}` : "");
    if (seenTags.has(key)) return false;
    seenTags.add(key);
    if (kind === "meta") meta.push(attrs);
    else if (kind === "link") links.push(attrs);
    else scripts.push({ ...attrs, ...(children ? { children } : {}) });
    htmlParts.push(serializeTag(kind, attrs, children));
    return true;
  };

  for (const entry of entries) {
    if (entry.enabled === false) {
      skipped.push({ entry, reason: "Disabled" });
      continue;
    }
    const section = entry.section as HeadSection;
    const name = (entry.name ?? "").trim();
    const value = (entry.value ?? "").trim();
    const content = entry.content ?? "";
    const provider = (entry.provider ?? "").trim();

    if (section === "verification") {
      if (!name || !value) {
        skipped.push({ entry, reason: "Verification entries require a name and a value." });
        continue;
      }
      const dedupKey = `${entry.type || "meta"}:${name.toLowerCase()}`;
      if (seenVerification.has(dedupKey)) {
        skipped.push({ entry, reason: `Duplicate verification tag "${name}".` });
        continue;
      }
      seenVerification.add(dedupKey);
      if (entry.type === "link") push("link", { rel: name, href: value }, undefined, section);
      else push("meta", { name, content: value }, undefined, section);
      continue;
    }

    if (section === "analytics") {
      const providerKey = provider.toLowerCase();
      if (providerKey && seenAnalyticsProvider.has(providerKey)) {
        skipped.push({ entry, reason: `Duplicate analytics provider "${provider}".` });
        continue;
      }
      if (providerKey) seenAnalyticsProvider.add(providerKey);

      if (entry.type === "meta") {
        if (!name || !value) { skipped.push({ entry, reason: "Meta entries require a name and a value." }); continue; }
        push("meta", { name, content: value }, undefined, section);
        continue;
      }
      // script: either external src (value) or inline snippet (content)
      if (value) {
        if (!safeUrl(value)) { skipped.push({ entry, reason: "Unsafe script URL." }); continue; }
        push("script", { src: value, async: "" }, undefined, section);
        if (content.trim()) push("script", {}, content, section);
        continue;
      }
      if (!content.trim()) { skipped.push({ entry, reason: "Analytics entry has no script URL or inline snippet." }); continue; }
      const inline = sanitizeHeadHtml(content.trim().startsWith("<") ? content : `<script>${content}</script>`);
      if (!inline.ok) { skipped.push({ entry, reason: inline.error }); continue; }
      for (const t of inline.tags) push(t.tag as "meta" | "link" | "script", t.attrs, t.children, section);
      continue;
    }

    if (section === "structured_data") {
      const result = validateJsonLd(content || value);
      if (!result.ok) { skipped.push({ entry, reason: result.error }); continue; }
      push("script", { type: "application/ld+json" }, result.json, section);
      continue;
    }

    if (section === "custom_html") {
      const result = sanitizeHeadHtml(content || value);
      if (!result.ok) { skipped.push({ entry, reason: result.error }); continue; }
      for (const t of result.tags) push(t.tag as "meta" | "link" | "script", t.attrs, t.children, section);
      continue;
    }

    skipped.push({ entry, reason: `Unknown section "${entry.section}".` });
  }

  return { meta, links, scripts, html: htmlParts.join("\n"), skipped };
}
