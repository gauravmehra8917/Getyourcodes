import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, TextArea, FieldSet } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X, Check } from "lucide-react";

export const Route = createFileRoute("/admin/pages")({ component: PagesPage });

type Page = { id: string; title: string; slug: string; content: string | null; meta_title: string | null; meta_description: string | null; published: boolean };
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const empty = { title: "", slug: "", content: "", meta_title: "", meta_description: "", published: true };

function PagesPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-pages"],
    queryFn: async () => {
      const { data } = await sb.from("pages").select("*").order("title");
      return (data ?? []) as Page[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Page | null>(null);
  const [form, setForm] = useState(empty);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (r: Page) => { setEditing(r); setForm({ title: r.title, slug: r.slug, content: r.content ?? "", meta_title: r.meta_title ?? "", meta_description: r.meta_description ?? "", published: r.published }); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    const payload = { ...form, slug: form.slug || slugify(form.title) };
    if (editing) await sb.from("pages").update(payload).eq("id", editing.id);
    else await sb.from("pages").insert(payload);
    qc.invalidateQueries({ queryKey: ["admin-pages"] });
    setOpen(false);
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this page?")) return;
    await sb.from("pages").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-pages"] });
  };

  const cols: Column<Page>[] = [
    { key: "title", header: "Title", searchValue: (r) => r.title, render: (r) => <span className="font-medium text-slate-800">{r.title}</span> },
    { key: "slug", header: "Slug", searchValue: (r) => r.slug, render: (r) => <span className="text-xs text-slate-500">/{r.slug}</span> },
    { key: "status", header: "Status", render: (r) => r.published ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><Check className="h-3 w-3" /> Published</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Draft</span> },
    {
      key: "actions", header: "Action",
      render: (r) => (
        <div className="flex items-center gap-1">
          <button onClick={() => startEdit(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Edit"><Pencil className="h-4 w-4" /></button>
          <button onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Pages" action={
        <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
          <Plus className="h-4 w-4" /> Add New
        </button>
      } />
      <DataTable rows={rows} columns={cols} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="my-8 w-full max-w-2xl rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">{editing ? "Edit Page" : "New Page"}</h3>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              <Field label="Title" required><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, slug: form.slug || slugify(e.target.value) })} required /></Field>
              <Field label="Slug"><TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} /></Field>
              <Field label="Content"><TextArea rows={8} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
              <FieldSet title="SEO">
                <Field label="Meta Title"><TextInput value={form.meta_title} onChange={(e) => setForm({ ...form, meta_title: e.target.value })} /></Field>
                <Field label="Meta Description"><TextArea value={form.meta_description} onChange={(e) => setForm({ ...form, meta_description: e.target.value })} /></Field>
              </FieldSet>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                Published
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">{editing ? "Update" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
