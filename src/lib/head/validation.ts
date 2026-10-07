import {
  isSafeHeadUrl,
  renderHeadEntries,
  sanitizeHeadHtml,
  validateJsonLd,
  type HeadEntryInput,
  type HeadSection,
} from "./render.ts";

export type HeadEntryPayload = {
  section: HeadSection;
  provider: string;
  type: string;
  name: string;
  value: string | null;
  content: string | null;
  enabled: boolean;
  notes: string | null;
};

const TYPES: Record<HeadSection, readonly string[]> = {
  verification: ["meta", "link"],
  analytics: ["script", "meta"],
  structured_data: ["json-ld"],
  custom_html: ["html"],
};
const normalized = (value: string) => value.trim().toLowerCase();
const normalizedContent = (entry: HeadEntryInput) => {
  const content = (entry.content || entry.value || "").trim().replace(/\r\n?/g, "\n");
  if (entry.section === "structured_data") {
    const json = validateJsonLd(content);
    if (json.ok) return json.json;
  }
  return content;
};

/** The single save-time validation path for Add, Edit and Import. */
export function validateHeadEntryForSave({
  candidate,
  existing,
  editingId,
}: {
  candidate: HeadEntryInput & { notes?: string | null };
  existing: readonly HeadEntryInput[];
  editingId?: string;
}): { ok: true; payload: HeadEntryPayload } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const section = candidate.section as HeadSection;
  if (!Object.hasOwn(TYPES, section)) return fail("Choose a supported Head Manager section.");
  const payload: HeadEntryPayload = {
    section,
    provider: candidate.provider.trim(),
    type: candidate.type.trim().toLowerCase(),
    name: (candidate.name ?? "").trim(),
    value: candidate.value?.trim() || null,
    content: candidate.content?.trim() || null,
    enabled: candidate.enabled !== false,
    notes: candidate.notes?.trim() || null,
  };
  if (!payload.provider) return fail("Provider is required.");
  if (!TYPES[section].includes(payload.type))
    return fail("Choose a supported type for this section.");
  const others = existing.filter((entry) => entry.id !== editingId || editingId === undefined);
  if (section === "verification" || (section === "analytics" && payload.type === "meta")) {
    if (!payload.name || !payload.value)
      return fail("Meta and verification tags require a name and a value.");
    payload.content = null;
  }
  if (section === "verification") {
    if (payload.type === "link" && !isSafeHeadUrl(payload.value!))
      return fail(
        "Link URL must be an absolute HTTPS URL or a root-relative path starting with a single /.",
      );
    if (
      others.some(
        (entry) =>
          entry.section === section &&
          normalized(entry.type) === payload.type &&
          normalized(entry.name ?? "") === normalized(payload.name),
      )
    )
      return fail(`A verification ${payload.type} tag named "${payload.name}" already exists.`);
  }
  if (section === "analytics") {
    if (
      others.some(
        (entry) =>
          entry.section === section && normalized(entry.provider) === normalized(payload.provider),
      )
    )
      return fail(`Analytics provider "${payload.provider}" already has an entry.`);
    if (payload.type === "script") {
      payload.name = "";
      if (!payload.value && !payload.content)
        return fail("Provide a Script URL or inline script content.");
      if (payload.value && !isSafeHeadUrl(payload.value))
        return fail(
          "Script URL must be an absolute HTTPS URL or a root-relative path starting with a single /.",
        );
    }
  }
  if (section === "structured_data" || section === "custom_html") {
    const content = payload.content || payload.value || "";
    const check =
      section === "structured_data" ? validateJsonLd(content) : sanitizeHeadHtml(content);
    if (!check.ok) return fail(check.error);
    payload.name = "";
    payload.value = null;
    payload.content = section === "structured_data" && "json" in check ? check.json : content;
    if (
      others.some(
        (entry) =>
          entry.section === section && normalizedContent(entry) === normalizedContent(payload),
      )
    )
      return fail(
        `This ${section === "structured_data" ? "JSON-LD content" : "custom head content"} already exists.`,
      );
  }
  // Validate even disabled candidates, which may later be enabled.
  const rendered = renderHeadEntries([{ ...payload, enabled: true }]);
  if (rendered.skipped.length || !rendered.html)
    return fail(rendered.skipped[0]?.reason ?? "This entry does not produce supported head tags.");
  return { ok: true, payload };
}

export function headEntryErrorMessage(
  action: "save" | "update" | "delete" | "status" | "import",
  error: unknown,
): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  const verb =
    action === "status"
      ? "change this entry's status"
      : action === "import"
        ? "import this snippet"
        : `${action} this head entry`;
  if (code === "42501" || code === "PGRST301" || code === "PGRST302")
    return `You do not have permission to ${verb}.`;
  if (code === "23505")
    return "A matching head entry already exists. Refresh the list and try again.";
  return `Could not ${verb}. Please try again.`;
}
