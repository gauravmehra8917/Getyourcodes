import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, TextArea, SelectInput } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X, Search, Code2, ClipboardPaste } from "lucide-react";
import { renderHeadEntries } from "@/lib/head/render";
import { validateHeadEntryForSave, headEntryErrorMessage } from "@/lib/head/validation";
import { runAdminSecondaryAction } from "@/lib/admin-secondary-actions";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { ImportSnippetDialog } from "@/components/admin/import-snippet-dialog";

export const Route = createFileRoute("/admin/head-manager")({
  head: () => ({
    meta: [
      { title: "Head Manager — Getyourcodes Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: HeadManagerPage,
});

type HeadSection = "verification" | "analytics" | "structured_data" | "custom_html";

type HeadEntry = {
  id: string;
  section: HeadSection;
  provider: string;
  type: string;
  name: string;
  value: string | null;
  content: string | null;
  enabled: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const SECTIONS: { key: HeadSection; label: string; hint: string; types: string[] }[] = [
  {
    key: "verification",
    label: "Verification Tags",
    hint: "Site verification meta and link tags.",
    types: ["meta", "link"],
  },
  {
    key: "analytics",
    label: "Analytics & Pixels",
    hint: "Measurement and tracking snippets.",
    types: ["script", "meta"],
  },
  {
    key: "structured_data",
    label: "Structured Data",
    hint: "JSON-LD schema blocks.",
    types: ["json-ld"],
  },
  {
    key: "custom_html",
    label: "Custom Head Tags",
    hint: "Custom meta, link, and script tags added to the document head.",
    types: ["html"],
  },
];

const sectionLabel = (s: string) => SECTIONS.find((x) => x.key === s)?.label ?? s;

const emptyForm = {
  section: "verification" as HeadSection,
  provider: "",
  type: "meta",
  name: "",
  value: "",
  content: "",
  enabled: true,
  notes: "",
};

function HeadManagerPage() {
  const qc = useQueryClient();
  const {
    data: rows = [],
    isPending,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["admin-head-entries"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("head_entries")
        .select("*")
        .order("section")
        .order("provider");
      if (error) throw new Error("Could not load Head Manager. Please try again.");
      return (data ?? []) as HeadEntry[];
    },
  });

  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [providerSearch, setProviderSearch] = useState("");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HeadEntry | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingActions = useRef(new Set<string>());
  const opener = useRef<HTMLElement | null>(null);
  const page = useRef<HTMLDivElement | null>(null);
  const rememberFocus = () => {
    if (typeof document !== "undefined") opener.current = document.activeElement as HTMLElement;
  };
  const restoreFocus = () => {
    if (opener.current && !opener.current.matches(":disabled")) opener.current.focus();
    else page.current?.focus();
  };
  const [busyIds, setBusyIds] = useState(new Set<string>());
  const writesUnavailable = isPending || isError || isFetching;
  const writeHint = writesUnavailable
    ? "Load the current entries before adding or importing to check for duplicates."
    : undefined;
  const closeForm = () => {
    if (!pendingActions.current.has("save")) setOpen(false);
  };
  const syncBusy = () => {
    setBusyIds(new Set(pendingActions.current));
    setSaving(pendingActions.current.has("save"));
  };

  const providers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.provider).filter(Boolean))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const term = providerSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (sectionFilter !== "all" && r.section !== sectionFilter) return false;
      if (providerFilter !== "all" && r.provider !== providerFilter) return false;
      if (statusFilter === "enabled" && !r.enabled) return false;
      if (statusFilter === "disabled" && r.enabled) return false;
      if (term && !r.provider.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, sectionFilter, providerFilter, statusFilter, providerSearch]);

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["admin-head-entries"] }, { throwOnError: true });

  const startNew = (section?: HeadSection) => {
    if (writesUnavailable || pendingActions.current.has("save")) return;
    rememberFocus();
    setEditing(null);
    setError(null);
    const s = section ?? "verification";
    setForm({
      ...emptyForm,
      section: s,
      type: SECTIONS.find((x) => x.key === s)?.types[0] ?? "meta",
    });
    setOpen(true);
  };

  const startEdit = (r: HeadEntry) => {
    if (
      isPending ||
      isError ||
      pendingActions.current.has(r.id) ||
      pendingActions.current.has("save")
    )
      return;
    rememberFocus();
    setEditing(r);
    setError(null);
    setForm({
      section: r.section,
      provider: r.provider ?? "",
      type: r.type ?? "",
      name: r.name ?? "",
      value: r.value ?? "",
      content:
        r.content ||
        (r.section === "structured_data" || r.section === "custom_html" ? (r.value ?? "") : ""),
      enabled: r.enabled,
      notes: r.notes ?? "",
    });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pendingActions.current.has("save")) return;
    if (writesUnavailable) {
      setError("Load the current entries before saving so duplicates can be checked.");
      return;
    }
    const validated = validateHeadEntryForSave({
      candidate: form,
      existing: rows,
      editingId: editing?.id,
    });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    const action = editing ? "update" : "save";
    await runAdminSecondaryAction({
      key: "save",
      pending: pendingActions.current,
      mutate: () =>
        editing
          ? sb.from("head_entries").update(validated.payload).eq("id", editing.id)
          : sb.from("head_entries").insert(validated.payload),
      failureMessage: (error) => headEntryErrorMessage(action, error),
      refreshFailureMessage: `The entry was ${editing ? "updated" : "saved"}, but the list could not be refreshed. Please retry.`,
      refresh,
      onBusyChange: syncBusy,
      onStart: () => setError(null),
      onError: setError,
      onSuccess: () => setOpen(false),
      onRefreshError: (message) => toast.warning(message),
    });
  };

  const toggleEnabled = (r: HeadEntry) =>
    runAdminSecondaryAction({
      key: r.id,
      pending: pendingActions.current,
      mutate: () => sb.from("head_entries").update({ enabled: !r.enabled }).eq("id", r.id),
      failureMessage: (error) => headEntryErrorMessage("status", error),
      refreshFailureMessage:
        "The entry's status was changed, but the list could not be refreshed. Please retry.",
      refresh,
      onBusyChange: syncBusy,
      onError: (message) => toast.error(message),
      onRefreshError: (message) => toast.warning(message),
    });

  const onDelete = (r: HeadEntry) =>
    runAdminSecondaryAction({
      key: r.id,
      pending: pendingActions.current,
      confirm: () => confirm(`Delete "${r.name || r.provider}" from ${sectionLabel(r.section)}?`),
      mutate: () => sb.from("head_entries").delete().eq("id", r.id),
      failureMessage: (error) => headEntryErrorMessage("delete", error),
      refreshFailureMessage:
        "The entry was deleted, but the list could not be refreshed. Please retry.",
      refresh,
      onBusyChange: syncBusy,
      onError: (message) => toast.error(message),
      onRefreshError: (message) => toast.warning(message),
    });

  const cols: Column<HeadEntry>[] = [
    {
      key: "provider",
      header: "Provider",
      searchValue: (r) => r.provider,
      render: (r) => <span className="font-medium text-slate-800">{r.provider || "—"}</span>,
    },
    {
      key: "name",
      header: "Name / Key",
      searchValue: (r) => r.name,
      render: (r) => <span className="text-slate-700">{r.name || "—"}</span>,
    },
    {
      key: "section",
      header: "Section",
      render: (r) => (
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {sectionLabel(r.section)}
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (r) => (
        <span className="text-xs uppercase tracking-wide text-slate-500">{r.type || "—"}</span>
      ),
    },
    {
      key: "preview",
      header: "Value",
      render: (r) => (
        <span
          className="block max-w-[260px] truncate font-mono text-xs text-slate-500"
          title={r.value ?? r.content ?? ""}
        >
          {r.value || r.content || "—"}
        </span>
      ),
    },
    {
      key: "enabled",
      header: "Enabled",
      render: (r) => (
        <button
          onClick={() => void toggleEnabled(r)}
          disabled={busyIds.has(r.id) || isError}
          role="switch"
          aria-checked={r.enabled}
          aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.provider} ${r.name}`}
          className={`relative h-5 w-9 rounded-full transition disabled:opacity-50 ${r.enabled ? "bg-emerald-500" : "bg-slate-300"}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${r.enabled ? "left-[18px]" : "left-0.5"}`}
          />
        </button>
      ),
    },
    {
      key: "actions",
      header: "Action",
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => startEdit(r)}
            disabled={busyIds.has(r.id) || isError}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
            title="Edit"
            aria-label={`Edit ${r.provider}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => void onDelete(r)}
            disabled={busyIds.has(r.id) || isError}
            className="rounded p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-50"
            title="Delete"
            aria-label={`Delete ${r.provider}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  const activeSection = SECTIONS.find((s) => s.key === form.section);
  const showNameValue =
    form.section === "verification" || (form.section === "analytics" && form.type === "meta");
  const showScript = form.section === "analytics" && form.type === "script";
  const showContent =
    showScript || form.section === "structured_data" || form.section === "custom_html";

  return (
    <div ref={page} tabIndex={-1}>
      <PageHeader
        title="Head Manager"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!writesUnavailable) {
                  rememberFocus();
                  setImportOpen(true);
                }
              }}
              disabled={writesUnavailable}
              title={writeHint}
              className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ClipboardPaste className="h-4 w-4" /> Import Snippet
            </button>
            <button
              onClick={() => startNew()}
              disabled={writesUnavailable}
              title={writeHint}
              className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add Entry
            </button>
          </div>
        }
      />

      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        Manage verification, analytics, structured data, and custom tags added to the site{" "}
        <code className="rounded bg-slate-100 px-1">&lt;head&gt;</code>. Enabled entries are
        rendered server-side into every page head, in order, with validation, sanitization and
        duplicate protection.
      </p>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SECTIONS.map((s) => {
          const all = rows.filter((r) => r.section === s.key);
          const on = all.filter((r) => r.enabled).length;
          return (
            <div
              key={s.key}
              className={`rounded-md border bg-white p-4 text-left shadow-sm transition ${
                sectionFilter === s.key
                  ? "border-emerald-500 ring-1 ring-emerald-200"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <button
                type="button"
                onClick={() => setSectionFilter(sectionFilter === s.key ? "all" : s.key)}
                aria-pressed={sectionFilter === s.key}
                className="block w-full text-left"
              >
                <span className="block text-sm font-semibold text-slate-800">{s.label}</span>
                <span className="mt-1 block text-xs text-slate-500">{s.hint}</span>
                <span className="mt-3 block text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">{all.length}</span> entries · {on}{" "}
                  enabled
                </span>
              </button>
              <button
                type="button"
                onClick={() => startNew(s.key)}
                disabled={writesUnavailable}
                title={writeHint}
                aria-label={`Add to ${s.label}`}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
              >
                <Plus className="h-3 w-3" /> Add to section
              </button>
            </div>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Search provider
          </span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={providerSearch}
              onChange={(e) => setProviderSearch(e.target.value)}
              placeholder="Google, Meta, Bing…"
              className="h-10 w-56 rounded border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 outline-none focus:border-slate-700"
            />
          </span>
        </label>
        <Field label="Section">
          <SelectInput
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            className="w-52"
          >
            <option value="all">All sections</option>
            {SECTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Provider">
          <SelectInput
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="w-48"
          >
            <option value="all">All providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Status">
          <SelectInput
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-40"
          >
            <option value="all">All</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </SelectInput>
        </Field>
        <button
          onClick={() => {
            setSectionFilter("all");
            setProviderFilter("all");
            setStatusFilter("all");
            setProviderSearch("");
          }}
          className="h-10 rounded border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50"
        >
          Reset
        </button>
      </div>

      {isPending ? (
        <p role="status" className="text-sm text-slate-500">
          Loading Head Manager…
        </p>
      ) : isError ? (
        <div
          role="alert"
          className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          Could not load Head Manager. Please try again.
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="ml-3 rounded border border-rose-300 px-3 py-1 disabled:opacity-50"
          >
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : (
        <>
          <DataTable
            rows={filtered}
            columns={cols}
            emptyText="No head entries match these filters."
          />
          <RenderedHeadPreview rows={rows} />
        </>
      )}

      {importOpen && (
        <ImportSnippetDialog
          existing={rows}
          canWrite={!writesUnavailable}
          onClose={() => setImportOpen(false)}
          onSaved={refresh}
          onRestoreFocus={restoreFocus}
        />
      )}

      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) closeForm();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocus();
            }}
            onEscapeKeyDown={(e) => {
              if (pendingActions.current.has("save")) e.preventDefault();
            }}
            onPointerDownOutside={(e) => {
              if (pendingActions.current.has("save")) e.preventDefault();
            }}
            className="fixed left-1/2 top-8 z-50 max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-y-auto rounded-md bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <Dialog.Title className="font-semibold text-slate-800">
                {editing ? "Edit Head Entry" : "New Head Entry"}
              </Dialog.Title>
              <button
                onClick={closeForm}
                disabled={saving}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submit}>
              <fieldset disabled={saving} className="space-y-4 p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Section" required>
                    <SelectInput
                      value={form.section}
                      onChange={(e) => {
                        setError(null);
                        const section = e.target.value as HeadSection;
                        const types = SECTIONS.find((s) => s.key === section)?.types ?? [];
                        setForm({
                          ...form,
                          section,
                          type: types.includes(form.type) ? form.type : (types[0] ?? ""),
                          name: "",
                          value: "",
                          content: "",
                        });
                      }}
                    >
                      {SECTIONS.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                  {(activeSection?.types.length ?? 0) > 1 && (
                    <Field label="Type">
                      <SelectInput
                        value={form.type}
                        onChange={(e) => {
                          setError(null);
                          setForm({
                            ...form,
                            type: e.target.value,
                            name: "",
                            value: "",
                            content: "",
                          });
                        }}
                      >
                        {(activeSection?.types ?? []).map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Provider" required>
                    <TextInput
                      value={form.provider}
                      onChange={(e) => setForm({ ...form, provider: e.target.value })}
                      placeholder="Google Search Console"
                      required
                    />
                  </Field>
                  {showNameValue && (
                    <Field
                      label={form.type === "link" ? "Name / Key (rel)" : "Name / Key"}
                      required
                    >
                      <TextInput
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder={
                          form.type === "link" ? "verification" : "google-site-verification"
                        }
                      />
                    </Field>
                  )}
                </div>
                {showNameValue && (
                  <Field label={form.type === "link" ? "Value (href)" : "Value"} required>
                    <TextInput
                      value={form.value}
                      onChange={(e) => setForm({ ...form, value: e.target.value })}
                      placeholder={
                        form.type === "link"
                          ? "https://example.com/verification"
                          : "Verification token or meta value"
                      }
                    />
                  </Field>
                )}
                {showScript && (
                  <Field label="Script URL">
                    <TextInput
                      value={form.value}
                      onChange={(e) => setForm({ ...form, value: e.target.value })}
                      placeholder="https://example.com/analytics.js or /assets/analytics.js"
                    />
                  </Field>
                )}
                {showContent && (
                  <Field
                    label={
                      showScript
                        ? "Inline Script / Snippet (optional)"
                        : form.section === "structured_data"
                          ? "JSON-LD Content"
                          : "Content"
                    }
                    required={!showScript}
                  >
                    <TextArea
                      rows={6}
                      value={form.content}
                      onChange={(e) => setForm({ ...form, content: e.target.value })}
                      placeholder={
                        showScript
                          ? "Inline JavaScript or complete script tags; provide a URL or inline script"
                          : form.section === "structured_data"
                            ? '{"@context":"https://schema.org","@type":"Organization"}'
                            : "Supported meta, link, and script tags"
                      }
                      className="font-mono text-xs"
                    />
                  </Field>
                )}
                <Field label="Notes">
                  <TextArea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Internal note about why this entry exists"
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Enabled
                </label>
                {error && (
                  <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={saving}
                    className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || writesUnavailable}
                    className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {saving ? "Saving…" : editing ? "Update" : "Save"}
                  </button>
                </div>
              </fieldset>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function RenderedHeadPreview({ rows }: { rows: HeadEntry[] }) {
  const [show, setShow] = useState(false);
  const rendered = useMemo(() => renderHeadEntries(rows.filter((r) => r.enabled)), [rows]);
  const skipped = rendered.skipped.filter((s) => s.reason !== "Disabled");

  return (
    <section className="mt-6 rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Code2 className="h-4 w-4" /> Rendered Head
        </h2>
        <button
          onClick={() => setShow(!show)}
          aria-expanded={show}
          aria-controls="rendered-head-output"
          className="text-xs font-medium text-slate-600 hover:underline"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {show && (
        <div id="rendered-head-output" className="space-y-3 p-5">
          <p className="text-xs text-slate-500">HTML generated by enabled Head Manager entries.</p>
          <pre className="max-h-80 overflow-auto rounded bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
            {rendered.html || "<!-- no enabled entries render any output -->"}
          </pre>
          {skipped.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-semibold text-amber-800">
                Skipped entries ({skipped.length})
              </div>
              <ul className="mt-1.5 space-y-1 text-xs text-amber-800">
                {skipped.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">
                      {s.entry.provider || "—"}
                      {s.entry.name ? ` · ${s.entry.name}` : ""}
                    </span>
                    : {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
