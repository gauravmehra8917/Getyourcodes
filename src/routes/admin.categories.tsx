import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb, type Category } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X } from "lucide-react";
import { SeoSettings, emptySeo, fromRow, toPayload, autofillSeo, type SeoValues } from "@/components/admin/seo-settings";


export const Route = createFileRoute("/admin/categories")({
  component: CategoriesPage,
});

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function CategoriesPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-categories"],
    queryFn: async () => {
      const { data } = await sb.from("categories").select("*").order("name");
      return (data ?? []) as Category[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: "", slug: "" });
  const [seo, setSeo] = useState<SeoValues>(emptySeo);
  const [error, setError] = useState<string | null>(null);

  const startNew = () => { setEditing(null); setForm({ name: "", slug: "" }); setSeo(emptySeo); setError(null); setOpen(true); };
  const startEdit = (c: Category) => { setEditing(c); setForm({ name: c.name, slug: c.slug }); setSeo(fromRow(c as unknown as Record<string, string | null>)); setError(null); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name) { setError("Name is required"); return; }
    const slug = form.slug || slugify(form.name);
    const seoFilled = autofillSeo(seo, { name: form.name, slug, pathPrefix: "/category" });
    const payload = { name: form.name, slug, ...toPayload(seoFilled) };
    const { error: err } = editing
      ? await sb.from("categories").update(payload).eq("id", editing.id)
      : await sb.from("categories").insert(payload);
    if (err) { setError(err.message); return; }
    qc.invalidateQueries({ queryKey: ["admin-categories"] });
    setOpen(false);
  };


  const onDelete = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    await sb.from("categories").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-categories"] });
  };

  const cols: Column<Category>[] = [
    { key: "name", header: "Name", searchValue: (r) => r.name, render: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
    { key: "slug", header: "Slug", searchValue: (r) => r.slug, render: (r) => <span className="text-xs text-slate-500">/{r.slug}</span> },
    {
      key: "actions",
      header: "Action",
      render: (r) => (
        <div className="flex items-center gap-1">
          <button onClick={() => startEdit(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Edit">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50" title="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Categories"
        action={
          <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
            <Plus className="h-4 w-4" /> Add New
          </button>
        }
      />
      <DataTable rows={rows} columns={cols} />

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">{editing ? "Edit Category" : "New Category"}</h3>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
              <Field label="Name" required>
                <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || slugify(e.target.value) })} required />
              </Field>
              <Field label="Slug">
                <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                  {editing ? "Update" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
