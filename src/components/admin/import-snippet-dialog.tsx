import { useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { X, ClipboardPaste } from "lucide-react";
import { Field, TextInput, TextArea, SelectInput } from "@/components/admin/form-fields";
import { sb } from "@/lib/db";
import { prepareSnippetForSave, type SnippetSection } from "@/lib/head/import-snippet";
import type { HeadEntryInput } from "@/lib/head/render";
import { headEntryErrorMessage } from "@/lib/head/validation";
import { runAdminSecondaryAction } from "@/lib/admin-secondary-actions";

const SECTION_OPTIONS: { key: SnippetSection; label: string }[] = [
  { key: "verification", label: "Verification Tags" },
  { key: "analytics", label: "Analytics & Pixels" },
  { key: "structured_data", label: "Structured Data" },
  { key: "custom_html", label: "Custom Head Tags" },
];

export function ImportSnippetDialog({
  onClose,
  onSaved,
  existing,
  canWrite,
  onRestoreFocus,
}: {
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  existing: readonly HeadEntryInput[];
  canWrite: boolean;
  onRestoreFocus: () => void;
}) {
  const [provider, setProvider] = useState("");
  const [section, setSection] = useState<SnippetSection>("verification");
  const [snippet, setSnippet] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(new Set<string>());
  const close = () => {
    if (!pending.current.has("import")) onClose();
  };
  const parsed = useMemo(
    () =>
      snippet.trim() ? prepareSnippetForSave(snippet, section, provider, note, existing) : null,
    [snippet, section, provider, note, existing],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current.has("import")) return;
    if (!canWrite) {
      setError("Load the current entries before importing so duplicates can be checked.");
      return;
    }
    const result = prepareSnippetForSave(snippet, section, provider, note, existing);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await runAdminSecondaryAction({
      key: "import",
      pending: pending.current,
      mutate: () => sb.from("head_entries").insert(result.result.payload),
      failureMessage: (error) => headEntryErrorMessage("import", error),
      refreshFailureMessage:
        "The snippet was imported, but the list could not be refreshed. Please retry.",
      refresh: onSaved,
      onBusyChange: () => setSaving(pending.current.has("import")),
      onStart: () => setError(null),
      onError: setError,
      onSuccess: onClose,
      onRefreshError: (message) => toast.warning(message),
    });
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus();
          }}
          onEscapeKeyDown={(e) => {
            if (pending.current.has("import")) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (pending.current.has("import")) e.preventDefault();
          }}
          className="fixed left-1/2 top-8 z-50 max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 overflow-y-auto rounded-md bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <Dialog.Title className="flex items-center gap-2 font-semibold text-slate-800">
              <ClipboardPaste className="h-4 w-4" /> Import Snippet
            </Dialog.Title>
            <button
              onClick={close}
              disabled={saving}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={submit}>
            <fieldset disabled={saving} className="space-y-4 p-5">
              <Dialog.Description className="text-xs text-slate-500">
                Paste a verification, analytics, or structured-data snippet. Supports meta, link,
                script, and JSON-LD. Unsupported body tags are rejected before saving.
              </Dialog.Description>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Provider" required>
                  <TextInput
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder="Impact, Google, Meta…"
                    required
                  />
                </Field>
                <Field label="Section" required>
                  <SelectInput
                    value={section}
                    onChange={(e) => setSection(e.target.value as SnippetSection)}
                  >
                    {SECTION_OPTIONS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              </div>
              <Field label="Snippet" required>
                <TextArea
                  rows={10}
                  value={snippet}
                  onChange={(e) => setSnippet(e.target.value)}
                  placeholder={
                    section === "structured_data"
                      ? '{"@context":"https://schema.org","@type":"Organization"}'
                      : '<meta name="impact-site-verification" value="…">'
                  }
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Notes">
                <TextArea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why this snippet exists"
                />
              </Field>
              {parsed &&
                (parsed.ok ? (
                  <div
                    className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"
                    role="status"
                  >
                    <div className="font-semibold">
                      {parsed.result.mode === "structured"
                        ? "Structured entry"
                        : "Custom Head Tags entry"}
                    </div>
                    <p className="mt-1">{parsed.result.reason}</p>
                  </div>
                ) : (
                  <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {parsed.error}
                  </p>
                ))}
              {error && (
                <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={saving}
                  className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !canWrite || !parsed?.ok}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Import"}
                </button>
              </div>
            </fieldset>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
