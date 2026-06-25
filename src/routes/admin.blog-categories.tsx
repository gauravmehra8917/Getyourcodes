import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, TextArea } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X } from "lucide-react";

export const Route = createFileRoute("/admin/blog-categories")({ component: BlogCategoriesPage });

type Row = { id: string; name: string; slug: string; description: string | null };
const empty = { name: "", slug: "", description: "" };

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function BlogCategoriesPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-blog-categories"],
    queryFn: async () => {
      const { data } = await sb.from("blog_categories").select("*").order("name");
      return (data ?? []) as Row[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState(empty);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (r: Row) => { setEditing(r); setForm({ name: r.name, slug: r.slug, description: r.description ?? "" }); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { name: form.name, slug: form.slug || slugify(form.name), description: form.description || null };
    if (editing) await sb.from("blog_categories").update(payload).eq("id", editing.id);
    else await sb.from("blog_categories").insert(payload);
    qc.invalidateQueries({ queryKey: ["admin-blog-categories"] });
    setOpen(false);
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this blog category?")) return;
    await sb.from("blog_categories").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-blog-categories"] });
  };

  const cols: Column<Row>[] = [
    { key: "name", header: "Name", searchValue: (r) => r.name, render: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
    { key: "slug", header: "Slug", searchValue: (r) => r.slug, render: (r) => <code className="text-xs text-slate-600">{r.slug}</code> },
    { key: "description", header: "Description", render: (r) => <span className="text-slate-600">{r.description ?? "—"}</span> },
    { key: "actions", header: "Action", render: (r) => (
      <div className="flex items-center gap-1">
        <button onClick={() => startEdit(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Pencil className="h-4 w-4" /></button>
        <button onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Blog Categories" action={
        <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
          <Plus className="h-4 w-4" /> Add New
        </button>
      } />
      <DataTable rows={rows} columns={cols} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">{editing ? "Edit Category" : "New Category"}</h3>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              <Field label="Name" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || slugify(e.target.value) })} required /></Field>
              <Field label="Slug" required><TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required /></Field>
              <Field label="Description"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
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
