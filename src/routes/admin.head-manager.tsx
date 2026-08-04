import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, TextArea, SelectInput } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X, Search, Code2, ClipboardPaste } from "lucide-react";
import { renderHeadEntries, validateJsonLd, sanitizeHeadHtml } from "@/lib/head/render";
import { ImportSnippetDialog } from "@/components/admin/import-snippet-dialog";


export const Route = createFileRoute("/admin/head-manager")({
  head: () => ({ meta: [{ title: "Head Manager — Getyourcodes Admin" }, { name: "robots", content: "noindex,nofollow" }] }),
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
  { key: "verification", label: "Verification Tags", hint: "Ownership / site verification meta tags.", types: ["meta", "link"] },
  { key: "analytics", label: "Analytics & Pixels", hint: "Measurement and tracking snippets.", types: ["script", "meta", "noscript"] },
  { key: "structured_data", label: "Structured Data", hint: "JSON-LD schema blocks.", types: ["json-ld"] },
  { key: "custom_html", label: "Custom Head HTML", hint: "Arbitrary raw markup injected into the head.", types: ["html"] },
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
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-head-entries"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("head_entries")
        .select("*")
        .order("section")
        .order("provider");
      if (error) throw error;
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

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-head-entries"] });

  const startNew = (section?: HeadSection) => {
    setEditing(null);
    setError(null);
    const s = section ?? "verification";
    setForm({ ...emptyForm, section: s, type: SECTIONS.find((x) => x.key === s)?.types[0] ?? "meta" });
    setOpen(true);
  };

  const startEdit = (r: HeadEntry) => {
    setEditing(r);
    setError(null);
    setForm({
      section: r.section,
      provider: r.provider ?? "",
      type: r.type ?? "",
      name: r.name ?? "",
      value: r.value ?? "",
      content: r.content ?? "",
      enabled: r.enabled,
      notes: r.notes ?? "",
    });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.provider.trim()) { setError("Provider is required."); return; }

    const others = rows.filter((r) => r.id !== editing?.id);
    if (form.section === "verification") {
      if (!form.name.trim() || !form.value.trim()) { setError("Verification tags require a name and a value."); return; }
      const dup = others.some(
        (r) => r.section === "verification" && r.type === form.type && r.name.trim().toLowerCase() === form.name.trim().toLowerCase(),
      );
      if (dup) { setError(`A verification tag named "${form.name.trim()}" already exists.`); return; }
    }
    if (form.section === "analytics") {
      const dup = others.some(
        (r) => r.section === "analytics" && r.provider.trim().toLowerCase() === form.provider.trim().toLowerCase(),
      );
      if (dup) { setError(`Analytics provider "${form.provider.trim()}" already has an entry.`); return; }
      if (!form.value.trim() && !form.content.trim()) { setError("Provide a script URL or an inline snippet."); return; }
      if (form.content.trim() && form.content.trim().startsWith("<")) {
        const html = sanitizeHeadHtml(form.content);
        if (!html.ok) { setError(html.error); return; }
      }
    }
    if (form.section === "structured_data") {
      const json = validateJsonLd(form.content || form.value);
      if (!json.ok) { setError(json.error); return; }
    }
    if (form.section === "custom_html") {
      const html = sanitizeHeadHtml(form.content || form.value);
      if (!html.ok) { setError(html.error); return; }
    }

    setSaving(true);
    setError(null);
    const payload = {
      section: form.section,
      provider: form.provider.trim(),
      type: form.type.trim(),
      name: form.name.trim(),
      value: form.value.trim() || null,
      content: form.content.trim() || null,
      enabled: form.enabled,
      notes: form.notes.trim() || null,
    };
    const { error: err } = editing
      ? await sb.from("head_entries").update(payload).eq("id", editing.id)
      : await sb.from("head_entries").insert(payload);
    setSaving(false);
    if (err) { setError(err.message ?? "Save failed."); return; }
    refresh();
    setOpen(false);
  };

  const toggleEnabled = async (r: HeadEntry) => {
    const { error: err } = await sb.from("head_entries").update({ enabled: !r.enabled }).eq("id", r.id);
    if (err) { alert(err.message); return; }
    refresh();
  };

  const onDelete = async (r: HeadEntry) => {
    if (!confirm(`Delete "${r.name || r.provider}" from ${sectionLabel(r.section)}?`)) return;
    const { error: err } = await sb.from("head_entries").delete().eq("id", r.id);
    if (err) { alert(err.message); return; }
    refresh();
  };

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
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{sectionLabel(r.section)}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (r) => <span className="text-xs uppercase tracking-wide text-slate-500">{r.type || "—"}</span>,
    },
    {
      key: "preview",
      header: "Value",
      render: (r) => (
        <span className="block max-w-[260px] truncate font-mono text-xs text-slate-500" title={r.value ?? r.content ?? ""}>
          {r.value || r.content || "—"}
        </span>
      ),
    },
    {
      key: "enabled",
      header: "Enabled",
      render: (r) => (
        <button
          onClick={() => toggleEnabled(r)}
          role="switch"
          aria-checked={r.enabled}
          aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.provider} ${r.name}`}
          className={`relative h-5 w-9 rounded-full transition ${r.enabled ? "bg-emerald-500" : "bg-slate-300"}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${r.enabled ? "left-[18px]" : "left-0.5"}`} />
        </button>
      ),
    },
    {
      key: "actions",
      header: "Action",
      render: (r) => (
        <div className="flex items-center gap-1">
          <button onClick={() => startEdit(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Edit" aria-label={`Edit ${r.provider}`}><Pencil className="h-4 w-4" /></button>
          <button onClick={() => onDelete(r)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50" title="Delete" aria-label={`Delete ${r.provider}`}><Trash2 className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  const activeSection = SECTIONS.find((s) => s.key === form.section);

  return (
    <div>
      <PageHeader
        title="Head Manager"
        action={
          <button onClick={() => startNew()} className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
            <Plus className="h-4 w-4" /> Add Entry
          </button>
        }
      />

      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        Central store for everything injected into the site <code className="rounded bg-slate-100 px-1">&lt;head&gt;</code>.
        Enabled entries are rendered server-side into every page head, in order, with validation, sanitization and duplicate protection.
      </p>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SECTIONS.map((s) => {
          const all = rows.filter((r) => r.section === s.key);
          const on = all.filter((r) => r.enabled).length;
          return (
            <button
              key={s.key}
              onClick={() => setSectionFilter(sectionFilter === s.key ? "all" : s.key)}
              className={`rounded-md border bg-white p-4 text-left shadow-sm transition ${
                sectionFilter === s.key ? "border-emerald-500 ring-1 ring-emerald-200" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="text-sm font-semibold text-slate-800">{s.label}</div>
              <div className="mt-1 text-xs text-slate-500">{s.hint}</div>
              <div className="mt-3 text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{all.length}</span> entries · {on} enabled
              </div>
              <span
                onClick={(e) => { e.stopPropagation(); startNew(s.key); }}
                className="mt-3 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
              >
                <Plus className="h-3 w-3" /> Add to section
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-600">Search provider</span>
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
          <SelectInput value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} className="w-52">
            <option value="all">All sections</option>
            {SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </SelectInput>
        </Field>
        <Field label="Provider">
          <SelectInput value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="w-48">
            <option value="all">All providers</option>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </SelectInput>
        </Field>
        <Field label="Status">
          <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
            <option value="all">All</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </SelectInput>
        </Field>
        <button
          onClick={() => { setSectionFilter("all"); setProviderFilter("all"); setStatusFilter("all"); setProviderSearch(""); }}
          className="h-10 rounded border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50"
        >
          Reset
        </button>
      </div>

      <DataTable
        rows={filtered}
        columns={cols}
        emptyText={isLoading ? "Loading…" : "No head entries match these filters."}
      />

      <RenderedHeadPreview rows={rows} />

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="my-8 w-full max-w-xl rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">{editing ? "Edit Head Entry" : "New Head Entry"}</h3>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Section" required>
                  <SelectInput
                    value={form.section}
                    onChange={(e) => {
                      const section = e.target.value as HeadSection;
                      const types = SECTIONS.find((s) => s.key === section)?.types ?? [];
                      setForm({ ...form, section, type: types.includes(form.type) ? form.type : (types[0] ?? "") });
                    }}
                  >
                    {SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </SelectInput>
                </Field>
                <Field label="Type">
                  <SelectInput value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {(activeSection?.types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                  </SelectInput>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Provider" required>
                  <TextInput value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="Google Search Console" required />
                </Field>
                <Field label="Name / Key">
                  <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="google-site-verification" />
                </Field>
              </div>
              <Field label="Value">
                <TextInput value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Short value, e.g. a verification token or measurement ID" />
              </Field>
              <Field label="Content">
                <TextArea rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Full snippet, script or JSON-LD block" className="font-mono text-xs" />
              </Field>
              <Field label="Notes">
                <TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Internal note about why this entry exists" />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                Enabled
              </label>
              {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                  {saving ? "Saving…" : editing ? "Update" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


function RenderedHeadPreview({ rows }: { rows: HeadEntry[] }) {
  const [show, setShow] = useState(true);
  const rendered = useMemo(() => renderHeadEntries(rows.filter((r) => r.enabled)), [rows]);
  const skipped = rendered.skipped.filter((s) => s.reason !== "Disabled");

  return (
    <section className="mt-6 rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Code2 className="h-4 w-4" /> Rendered Head
        </h2>
        <button onClick={() => setShow(!show)} className="text-xs font-medium text-slate-600 hover:underline">
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {show && (
        <div className="space-y-3 p-5">
          <p className="text-xs text-slate-500">
            Exact HTML injected into <code className="rounded bg-slate-100 px-1">&lt;head&gt;</code> for enabled entries.
          </p>
          <pre className="max-h-80 overflow-auto rounded bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
            {rendered.html || "<!-- no enabled entries render any output -->"}
          </pre>
          {skipped.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-semibold text-amber-800">Skipped entries ({skipped.length})</div>
              <ul className="mt-1.5 space-y-1 text-xs text-amber-800">
                {skipped.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.entry.provider || "—"}{s.entry.name ? ` · ${s.entry.name}` : ""}</span>: {s.reason}
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
