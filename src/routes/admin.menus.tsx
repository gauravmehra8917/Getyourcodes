import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, SelectInput } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X, Check } from "lucide-react";

export const Route = createFileRoute("/admin/menus")({ component: MenusPage });

type Menu = { id: string; label: string; url: string; location: string; sort_order: number; active: boolean };
const empty = { label: "", url: "", location: "header", sort_order: 0, active: true };
const LOCATIONS = ["header", "footer", "mobile"];

function MenusPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-menus"],
    queryFn: async () => {
      const { data } = await sb.from("menus").select("*").order("location").order("sort_order");
      return (data ?? []) as Menu[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Menu | null>(null);
  const [form, setForm] = useState(empty);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (r: Menu) => { setEditing(r); setForm({ label: r.label, url: r.url, location: r.location, sort_order: r.sort_order, active: r.active }); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.label || !form.url) return;
    const payload = { ...form, sort_order: Number(form.sort_order) || 0 };
    if (editing) await sb.from("menus").update(payload).eq("id", editing.id);
    else await sb.from("menus").insert(payload);
    qc.invalidateQueries({ queryKey: ["admin-menus"] });
    setOpen(false);
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this menu item?")) return;
    await sb.from("menus").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-menus"] });
  };

  const cols: Column<Menu>[] = [
    { key: "label", header: "Label", searchValue: (r) => r.label, render: (r) => <span className="font-medium text-slate-800">{r.label}</span> },
    { key: "url", header: "URL", searchValue: (r) => r.url, render: (r) => <span className="text-xs text-slate-500">{r.url}</span> },
    { key: "location", header: "Location", render: (r) => <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{r.location}</span> },
    { key: "order", header: "Order", render: (r) => <span className="text-slate-700">{r.sort_order}</span> },
    { key: "status", header: "Status", render: (r) => r.active ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><Check className="h-3 w-3" /> Active</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Inactive</span> },
    { key: "actions", header: "Action", render: (r) => (
      <div className="flex items-center gap-1">
        <button onClick={() => startEdit(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Edit"><Pencil className="h-4 w-4" /></button>
        <button onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Menus" action={
        <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
          <Plus className="h-4 w-4" /> Add New
        </button>
      } />
      <DataTable rows={rows} columns={cols} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">{editing ? "Edit Menu Item" : "New Menu Item"}</h3>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              <Field label="Label" required><TextInput value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required /></Field>
              <Field label="URL" required><TextInput value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="/about or https://…" required /></Field>
              <Field label="Location" required>
                <SelectInput value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
                  {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                </SelectInput>
              </Field>
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
