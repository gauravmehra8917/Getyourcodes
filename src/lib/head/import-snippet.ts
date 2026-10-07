// Parse only supported snippets. Preserve unusual attributes as custom head tags.
import {
  sanitizeHeadHtml,
  validateJsonLd,
  type HeadEntryInput,
  type HeadSection,
  type ParsedTag,
} from "./render.ts";
import { validateHeadEntryForSave, type HeadEntryPayload } from "./validation.ts";

export type SnippetSection = HeadSection;
export type SnippetEntryPayload = HeadEntryPayload;
export type SnippetParseResult = {
  payload: SnippetEntryPayload;
  mode: "structured" | "raw";
  reason: string;
  tags: ParsedTag[];
  warnings: string[];
};
const ORIGINAL_MARKER = "Original snippet:";
export function originalSnippetFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const index = notes.indexOf(ORIGINAL_MARKER);
  return index < 0 ? null : notes.slice(index + ORIGINAL_MARKER.length).replace(/^\n/, "");
}

export function parseSnippet(
  raw: string,
  section: SnippetSection,
  provider: string,
  note = "",
): { ok: false; error: string } | { ok: true; result: SnippetParseResult } {
  const original = (raw ?? "").trim();
  if (!provider.trim()) return { ok: false, error: "Provider is required." };
  if (!original) return { ok: false, error: "Paste a snippet first." };
  const base: HeadEntryPayload = {
    section,
    provider: provider.trim(),
    type: "html",
    name: "",
    value: null,
    content: null,
    enabled: true,
    notes: `${note.trim() ? `${note.trim()}\n\n` : ""}${ORIGINAL_MARKER}\n${original}`,
  };
  const make = (
    payload: Partial<HeadEntryPayload>,
    reason: string,
    tags: ParsedTag[],
    mode: SnippetParseResult["mode"] = "structured",
  ) => ({
    ok: true as const,
    result: { payload: { ...base, ...payload }, reason, tags, mode, warnings: [] },
  });
  if (section === "structured_data" && (original.startsWith("{") || original.startsWith("["))) {
    const json = validateJsonLd(original);
    if (!json.ok) return json;
    return make({ type: "json-ld", content: json.json }, "Parsed as JSON-LD structured data.", []);
  }
  const sanitized = sanitizeHeadHtml(original);
  if (!sanitized.ok) return sanitized;
  const tags = sanitized.tags;
  const tag = tags[0];
  const onlyAttrs = (allowed: string[]) =>
    Object.keys(tag.attrs).every((key) => allowed.includes(key));
  if (tags.length === 1) {
    if (tag.tag === "script") {
      if (
        section === "structured_data" &&
        tag.attrs.type?.toLowerCase() === "application/ld+json" &&
        !tag.attrs.src
      ) {
        const json = validateJsonLd(tag.children ?? "");
        if (!json.ok) return json;
        if (onlyAttrs(["type"]))
          return make(
            { type: "json-ld", content: json.json },
            "Parsed as JSON-LD structured data.",
            tags,
          );
      }
      if (section === "analytics") {
        if (tag.attrs.src && onlyAttrs(["src", "async"]) && !tag.children?.trim())
          return make(
            { type: "script", value: tag.attrs.src },
            "Parsed as an external analytics script.",
            tags,
          );
        if (!tag.attrs.src && onlyAttrs([]) && tag.children?.trim())
          return make(
            { type: "script", content: tag.children },
            "Parsed as an inline analytics script.",
            tags,
          );
      }
    }
    if (
      tag.tag === "meta" &&
      (section === "verification" || section === "analytics") &&
      tag.attrs.name &&
      tag.attrs.content !== undefined &&
      onlyAttrs(["name", "content"])
    )
      return make(
        { type: "meta", name: tag.attrs.name, value: tag.attrs.content },
        "Parsed as a meta entry.",
        tags,
      );
    if (
      tag.tag === "link" &&
      section === "verification" &&
      tag.attrs.rel &&
      tag.attrs.href &&
      onlyAttrs(["rel", "href"])
    )
      return make(
        { type: "link", name: tag.attrs.rel, value: tag.attrs.href },
        "Parsed as a verification link.",
        tags,
      );
  }
  return make(
    { section: "custom_html", type: "html", content: original },
    "Supported tags are stored as Custom Head Tags to preserve their attributes.",
    tags,
    "raw",
  );
}

/** Parse, validate against the current list, and verify real renderer output before INSERT. */
export function prepareSnippetForSave(
  raw: string,
  section: SnippetSection,
  provider: string,
  note: string,
  existing: readonly HeadEntryInput[],
): ReturnType<typeof parseSnippet> {
  const parsed = parseSnippet(raw, section, provider, note);
  if (!parsed.ok) return parsed;
  const validated = validateHeadEntryForSave({ candidate: parsed.result.payload, existing });
  if (!validated.ok) return validated;
  return { ok: true, result: { ...parsed.result, payload: validated.payload } };
}
