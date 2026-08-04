import { useMemo, useState } from "react";
import { X, ClipboardPaste } from "lucide-react";
import { Field, TextInput, TextArea, SelectInput } from "@/components/admin/form-fields";
import { sb } from "@/lib/db";
import { parseSnippet, type SnippetSection } from "@/lib/head/import-snippet";

const SECTION_OPTIONS: { key: SnippetSection; label: string }[] = [
  { key: "verification", label: "Verification Tags" },
  { key: "analytics", label: "Analytics & Pixels" },
  { key: "structured_data", label: "Structured Data" },
  { key: "custom_html", label: "Custom Head HTML" },
];

export function ImportSnippetDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [provider, setProvider] = useState("");
  const [section, setSection] = useState<SnippetSection>("verification");
  const [snippet, setSnippet] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(() => {
    if (!snippet.trim()) return null;
    return parseSnippet(snippet, section, provider, note);
  }, [snippet, section, provider, note]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = parseSnippet(snippet, section, provider, note);
    if (!result.ok) { setError(result.error); return; }
    setSaving(true);
    const { error: err } = await sb.from("head_entries").insert(result.result.payload);
    setSaving(false);
    if (err) { setError(err.message ?? "Save failed."); return; }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="flex items-center gap-2 font-semibold text-slate-800">
            <ClipboardPaste className="h-4 w-4" /> Import Snippet
          </h3>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-5">
          <p className="text-xs text-slate-500">
            Paste the snippet exactly as the third-party service provided it. Simple standalone tags are stored as structured
            entries; anything else (multiple tags, inline JS/CSS, unusual attributes, malformed HTML) is preserved verbatim as
            a raw Custom Head HTML entry.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <TextInput value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Impact, Google, Meta…" />
            </Field>
            <Field label="Section" required>
              <SelectInput value={section} onChange={(e) => setSection(e.target.value as SnippetSection)}>
                {SECTION_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </SelectInput>
            </Field>
          </div>

          <Field label="Snippet" required>
            <TextArea
              rows={10}
              value={snippet}
              onChange={(e) => setSnippet(e.target.value)}
              placeholder={'<meta name="impact-site-verification" value="…">'}
              className="font-mono text-xs"
            />
          </Field>

          <Field label="Notes">
            <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this snippet exists" />
          </Field>

          {parsed && (
            parsed.ok ? (
              <div className={`rounded border p-3 text-xs ${parsed.result.mode === "structured" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-sky-200 bg-sky-50 text-sky-800"}`}>
                <div className="font-semibold">
                  {parsed.result.mode === "structured" ? "Structured entry" : "Raw Custom Head HTML entry"}
                </div>
                <p className="mt-1">{parsed.result.reason}</p>
                <p className="mt-1">
                  Detected {parsed.result.tags.length} tag{parsed.result.tags.length === 1 ? "" : "s"}:{" "}
                  <span className="font-mono">{parsed.result.tags.map((t) => `<${t.tag}>`).join(" ")}</span>
                </p>
                {parsed.result.warnings.map((w, i) => <p key={i} className="mt-1 text-amber-700">{w}</p>)}
              </div>
            ) : (
              <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{parsed.error}</p>
            )
          )}

          {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving || !snippet.trim()} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
              {saving ? "Saving…" : "Import"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
