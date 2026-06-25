import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X, Check } from "lucide-react";

export const Route = createFileRoute("/admin/sliders")({ component: SlidersPage });

type Slider = { id: string; title: string; image_url: string | null; link_url: string | null; sort_order: number; active: boolean };

function SlidersPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-sliders"],
    queryFn: async () => {
      const { data } = await sb.from("sliders").select("*").order("sort_order");
      return (data ?? []) as Slider[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Slider | null>(null);
  const [form, setForm] = useState({ title: "", image_url: "", link_url: "", sort_order: 0, active: true });

  const startNew = () => { setEditing(null); setForm({ title: "", image_url: "", link_url: "", sort_order: 0, active: true }); setOpen(true); };
  const startEdit = (r: Slider) => { setEditing(r); setForm({ title: r.title, image_url: r.image_url ?? "", link_url: r.link_url ?? "", sort_order: r.sort_order, active: r.active }); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    const payload = { title: form.title, image_url: form.image_url || null, link_url: form.link_url || null, sort_order: Number(form.sort_order) || 0, active: form.active };
    if (editing) await sb.from("sliders").update(payload).eq("id", editing.id);
    else await sb.from("sliders").insert(payload);
    qc.invalidateQueries({ queryKey: ["admin-sliders"] });
    setOpen(false);
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this slider?")) return;
    await sb.from("sliders").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-sliders"] });
  };

  const cols: Column<Slider>[] = [
    { key: "image", header: "Image", render: (r) => r.image_url ? <img src={r.image_url} alt="" width={80} height={40} className="h-10 w-20 rounded object-cover" /> : <span className="text-xs text-slate-400">—</span> },
    { key: "title", header: "Title", searchValue: (r) => r.title, render: (r) => <span className="font-medium text-slate-800">{r.title}</span> },
    { key: "link", header: "Link", searchValue: (r) => r.link_url ?? "", render: (r) => r.link_url ? <a href={r.link_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 hover:underline">{r.link_url}</a> : <span className="text-xs text-slate-400">—</span> },
    { key: "order", header: "Order", render: (r) => <span className="text-slate-700">{r.sort_order}</span> },
    { key: "status", header: "Status", render: (r) => r.active ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><Check className="h-3 w-3" /> Active</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Inactive</span> },
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
      <PageHeader title="Sliders" action={
        <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
          <Plus className="h-4 w-4" /> Add New
        </button>
      } />
      <DataTable rows={rows} columns={cols} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">{editing ? "Edit Slider" : "New Slider"}</h3>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              <Field label="Title" required><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
              <Field label="Image URL"><TextInput value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://…" /></Field>
              <Field label="Link URL"><TextInput value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://…" /></Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Sort Order"><TextInput type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></Field>
                <label className="flex items-end gap-2 pb-1 text-sm text-slate-700">
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                  Active
                </label>
              </div>
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
