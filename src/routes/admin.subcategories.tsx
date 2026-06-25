import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb, type Category } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, SelectInput } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X } from "lucide-react";

export const Route = createFileRoute("/admin/subcategories")({ component: SubcategoriesPage });

type Sub = { id: string; name: string; slug: string; category_id: string };
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function SubcategoriesPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-subcategories"],
    queryFn: async () => {
      const { data } = await sb.from("subcategories").select("*").order("name");
      return (data ?? []) as Sub[];
    },
  });
  const { data: cats = [] } = useQuery({
    queryKey: ["admin-categories-all"],
    queryFn: async () => {
      const { data } = await sb.from("categories").select("id,name,slug").order("name");
      return (data ?? []) as Category[];
    },
  });
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? "—";

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sub | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", category_id: "" });

  const startNew = () => { setEditing(null); setForm({ name: "", slug: "", category_id: cats[0]?.id ?? "" }); setOpen(true); };
  const startEdit = (r: Sub) => { setEditing(r); setForm({ name: r.name, slug: r.slug, category_id: r.category_id }); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.category_id) return;
    const payload = { name: form.name, slug: form.slug || slugify(form.name), category_id: form.category_id };
    if (editing) await sb.from("subcategories").update(payload).eq("id", editing.id);
    else await sb.from("subcategories").insert(payload);
    qc.invalidateQueries({ queryKey: ["admin-subcategories"] });
    setOpen(false);
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this sub category?")) return;
    await sb.from("subcategories").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-subcategories"] });
  };

  const cols: Column<Sub>[] = [
    { key: "name", header: "Name", searchValue: (r) => r.name, render: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
    { key: "category", header: "Category", searchValue: (r) => catName(r.category_id), render: (r) => <span className="text-slate-700">{catName(r.category_id)}</span> },
    { key: "slug", header: "Slug", searchValue: (r) => r.slug, render: (r) => <span className="text-xs text-slate-500">/{r.slug}</span> },
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
      <PageHeader title="Sub Categories" action={
        <button onClick={startNew} disabled={!cats.length} className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900 disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add New
        </button>
      } />
      <DataTable rows={rows} columns={cols} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">{editing ? "Edit Sub Category" : "New Sub Category"}</h3>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              <Field label="Parent Category" required>
                <SelectInput value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} required>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </SelectInput>
              </Field>
              <Field label="Name" required>
                <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || slugify(e.target.value) })} required />
              </Field>
              <Field label="Slug">
                <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} />
              </Field>
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
