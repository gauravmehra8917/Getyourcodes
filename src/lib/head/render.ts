// Shared Head Manager renderer and sanitizer for public SSR and admin preview.
export type HeadSection = "verification" | "analytics" | "structured_data" | "custom_html";

export type HeadEntryInput = {
  id?: string;
  created_at?: string;
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
export type ParsedTag = {
  tag: "meta" | "link" | "script";
  attrs: Record<string, string>;
  children?: string;
};
export type RenderedHead = {
  meta: MetaDescriptor[];
  links: LinkDescriptor[];
  scripts: ScriptDescriptor[];
  html: string;
  skipped: { entry: HeadEntryInput; reason: string }[];
};

export const NOSCRIPT_ERROR =
  "<noscript> tracking snippets are not supported in Head Manager because they belong in the document body. Import the script portion only.";
const URL_ERROR = "Use an absolute HTTPS URL or a root-relative path starting with a single /.";

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resource URLs must resolve to HTTPS or the same site's root. */
export function isSafeHeadUrl(value: string): boolean {
  const url = value.trim();
  if (
    !url ||
    /[\s\\]/.test(url) ||
    Array.from(url).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return false;
  if (url.startsWith("/")) return !url.startsWith("//");
  if (!/^https:\/\/[^/?#]+/i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/** Return a copy in canonical chronological order, including deterministic ties. */
export function sortHeadEntriesForRender<T extends HeadEntryInput>(entries: readonly T[]): T[] {
  const time = (entry: T) => {
    const value = Date.parse(entry.created_at ?? "");
    return Number.isFinite(value) ? value : 0;
  };
  return [...entries].sort(
    (a, b) =>
      time(a) - time(b) || ((a.id ?? "") < (b.id ?? "") ? -1 : (a.id ?? "") > (b.id ?? "") ? 1 : 0),
  );
}

export function validateJsonLd(
  raw: string,
): { ok: true; json: string } | { ok: false; error: string } {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, error: "JSON-LD content is empty." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON. Check the JSON-LD content and try again." };
  }
  if (parsed === null || typeof parsed !== "object")
    return { ok: false, error: "JSON-LD must be an object or an array of objects." };
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (!items.length) return { ok: false, error: "JSON-LD must contain at least one object." };
  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item))
      return { ok: false, error: "Each JSON-LD item must be an object." };
    if (!("@context" in item) && !("@type" in item))
      return { ok: false, error: "JSON-LD must include @context or @type." };
  }
  return { ok: true, json: JSON.stringify(parsed).replace(/</g, "\\u003c") };
}

// Decode attribute entities before URL validation and descriptor serialization.
function decodeAttribute(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    colon: ":",
    sol: "/",
    Tab: "\t",
    NewLine: "\n",
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (!entity.startsWith("#")) return named[entity] ?? match;
    const code =
      entity[1]?.toLowerCase() === "x"
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
  });
}

/** Consume every character; malformed attributes and unsupported tags cannot disappear. */
export function sanitizeHeadHtml(
  raw: string,
): { ok: true; tags: ParsedTag[] } | { ok: false; error: string } {
  const text = (raw ?? "").trim();
  const tags: ParsedTag[] = [];
  let cursor = 0;
  const malformed = () => ({
    ok: false as const,
    error: "Malformed HTML. Use complete meta, link, or script tags.",
  });
  while (cursor < text.length) {
    const whitespace = /^\s+/.exec(text.slice(cursor));
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }
    if (text.startsWith("<!--", cursor)) {
      const end = text.indexOf("-->", cursor + 4);
      if (end < 0) return malformed();
      cursor = end + 3;
      continue;
    }
    const opening = /^<([a-z][\w-]*)(?=[\s/>])/i.exec(text.slice(cursor));
    if (!opening) return malformed();
    const tag = opening[1].toLowerCase();
    if (tag === "noscript") return { ok: false, error: NOSCRIPT_ERROR };
    if (tag !== "meta" && tag !== "link" && tag !== "script")
      return { ok: false, error: `Tag <${tag}> is not supported. Use meta, link, or script tags.` };
    cursor += opening[0].length;
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    while (true) {
      const space = /^\s*/.exec(text.slice(cursor))![0];
      cursor += space.length;
      if (text.startsWith("/>", cursor)) {
        selfClosing = true;
        cursor += 2;
        break;
      }
      if (text[cursor] === ">") {
        cursor++;
        break;
      }
      if (!space) return malformed();
      const attr = /^([a-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/i.exec(
        text.slice(cursor),
      );
      if (!attr) return malformed();
      const key = attr[1].toLowerCase();
      const value = decodeAttribute(attr[2] ?? attr[3] ?? attr[4] ?? "");
      if (key.startsWith("on"))
        return { ok: false, error: `Inline event handler "${key}" is not allowed.` };
      if (key === "children" || Object.hasOwn(attrs, key))
        return { ok: false, error: `Unsupported or duplicate attribute "${key}".` };
      if ((key === "src" || key === "href") && !isSafeHeadUrl(value))
        return { ok: false, error: `Unsafe URL in "${key}". ${URL_ERROR}` };
      attrs[key] = value;
      cursor += attr[0].length;
    }
    let children: string | undefined;
    if (tag === "script") {
      if (selfClosing)
        return { ok: false, error: "Malformed HTML: scripts require a closing </script> tag." };
      const closing = /<\/script\s*>/gi;
      closing.lastIndex = cursor;
      const match = closing.exec(text);
      if (!match) return { ok: false, error: "Malformed HTML: unclosed <script> tag." };
      children = text.slice(cursor, match.index);
      cursor = closing.lastIndex;
    }
    tags.push({ tag, attrs, ...(children !== undefined ? { children } : {}) });
  }
  if (!tags.length) return { ok: false, error: "No supported head tags found." };
  return { ok: true, tags };
}

/** Inline JavaScript is intentional; validate its HTML envelope, not its source. */
export function parseAnalyticsScripts(content: string): ReturnType<typeof sanitizeHeadHtml> {
  const result = sanitizeHeadHtml(
    content.trim().startsWith("<") ? content : `<script>${content}</script>`,
  );
  if (!result.ok) return result;
  if (result.tags.some((tag) => tag.tag !== "script"))
    return {
      ok: false,
      error: "Use script tags or inline JavaScript for an analytics script entry.",
    };
  return result;
}

function serializeTag({ tag, attrs, children }: ParsedTag): string {
  const attrText = Object.entries(attrs)
    .map(([key, value]) => (value === "" ? key : `${key}="${escapeAttr(value)}"`))
    .join(" ");
  const opening = `<${tag}${attrText ? ` ${attrText}` : ""}>`;
  return tag === "script" ? `${opening}${children ?? ""}</script>` : opening;
}

export function renderHeadEntries(entries: readonly HeadEntryInput[]): RenderedHead {
  const result: RenderedHead = { meta: [], links: [], scripts: [], html: "", skipped: [] };
  const html: string[] = [];
  const seenTags = new Set<string>();
  const seenVerification = new Set<string>();
  const seenProviders = new Set<string>();
  for (const entry of sortHeadEntriesForRender(entries)) {
    const skip = (reason: string) => result.skipped.push({ entry, reason });
    if (entry.enabled === false) {
      skip("Disabled");
      continue;
    }
    const name = (entry.name ?? "").trim();
    const value = (entry.value ?? "").trim();
    const content = entry.content ?? "";
    const provider = (entry.provider ?? "").trim();
    let tags: ParsedTag[] = [];
    let verificationKey = "";
    let providerKey = "";
    if (entry.section === "verification") {
      if (entry.type !== "meta" && entry.type !== "link") {
        skip("Verification supports meta or link entries.");
        continue;
      }
      if (!name || !value) {
        skip("Verification entries require a name and a value.");
        continue;
      }
      if (entry.type === "link" && !isSafeHeadUrl(value)) {
        skip(`Unsafe verification link URL. ${URL_ERROR}`);
        continue;
      }
      verificationKey = `${entry.type}:${name.toLowerCase()}`;
      if (seenVerification.has(verificationKey)) {
        skip(`Duplicate verification tag "${name}".`);
        continue;
      }
      tags = [
        {
          tag: entry.type,
          attrs: entry.type === "link" ? { rel: name, href: value } : { name, content: value },
        },
      ];
    } else if (entry.section === "analytics") {
      if (entry.type !== "meta" && entry.type !== "script") {
        skip("Analytics supports script or meta entries.");
        continue;
      }
      providerKey = provider.toLowerCase();
      if (providerKey && seenProviders.has(providerKey)) {
        skip(`Duplicate analytics provider "${provider}".`);
        continue;
      }
      if (entry.type === "meta") {
        if (!name || !value) {
          skip("Meta entries require a name and a value.");
          continue;
        }
        tags = [{ tag: "meta", attrs: { name, content: value } }];
      } else {
        if (!value && !content.trim()) {
          skip("Analytics entry has no script URL or inline snippet.");
          continue;
        }
        if (value && !isSafeHeadUrl(value)) {
          skip(`Unsafe script URL. ${URL_ERROR}`);
          continue;
        }
        if (content.trim()) {
          const parsed = parseAnalyticsScripts(content);
          if (!parsed.ok) {
            skip(parsed.error);
            continue;
          }
          tags = parsed.tags;
        }
        if (value) tags.unshift({ tag: "script", attrs: { src: value, async: "" } });
      }
    } else if (entry.section === "structured_data") {
      const json = validateJsonLd(content || value);
      if (!json.ok) {
        skip(json.error);
        continue;
      }
      tags = [{ tag: "script", attrs: { type: "application/ld+json" }, children: json.json }];
    } else if (entry.section === "custom_html") {
      const parsed = sanitizeHeadHtml(content || value);
      if (!parsed.ok) {
        skip(parsed.error);
        continue;
      }
      tags = parsed.tags;
    } else {
      skip(`Unknown section "${entry.section}".`);
      continue;
    }

    if (verificationKey) seenVerification.add(verificationKey);
    if (providerKey) seenProviders.add(providerKey);
    for (const tag of tags) {
      const ident =
        tag.attrs.name ??
        tag.attrs.property ??
        tag.attrs["http-equiv"] ??
        tag.attrs.src ??
        tag.attrs.href;
      const key = `${entry.section}|${tag.tag}|${ident === undefined ? JSON.stringify(tag.attrs) : ident.toLowerCase()}|${tag.children ?? ""}`;
      if (seenTags.has(key)) {
        skip(`Duplicate <${tag.tag}> tag.`);
        continue;
      }
      seenTags.add(key);
      if (tag.tag === "meta") result.meta.push(tag.attrs);
      else if (tag.tag === "link") result.links.push(tag.attrs);
      else
        result.scripts.push({
          ...tag.attrs,
          ...(tag.children !== undefined ? { children: tag.children } : {}),
        });
      html.push(serializeTag(tag));
    }
  }
  result.html = html.join("\n");
  return result;
}
