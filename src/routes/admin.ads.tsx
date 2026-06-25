import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, TextArea, SelectInput } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X, Check } from "lucide-react";

export const Route = createFileRoute("/admin/ads")({ component: AdsPage });

type Ad = { id: string; name: string; placement: string; image_url: string | null; link_url: string | null; html: string | null; active: boolean };
const empty = { name: "", placement: "sidebar", image_url: "", link_url: "", html: "", active: true };
const PLACEMENTS = ["sidebar", "header", "footer", "in-content", "popup"];

function AdsPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-ads"],
    queryFn: async () => {
      const { data } = await sb.from("ads").select("*").order("name");
      return (data ?? []) as Ad[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Ad | null>(null);
  const [form, setForm] = useState(empty);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (r: Ad) => { setEditing(r); setForm({ name: r.name, placement: r.placement, image_url: r.image_url ?? "", link_url: r.link_url ?? "", html: r.html ?? "", active: r.active }); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) return;
    const payload = { name: form.name, placement: form.placement, image_url: form.image_url || null, link_url: form.link_url || null, html: form.html || null, active: form.active };
    if (editing) await sb.from("ads").update(payload).eq("id", editing.id);
    else await sb.from("ads").insert(payload);
    qc.invalidateQueries({ queryKey: ["admin-ads"] });
    setOpen(false);
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this ad?")) return;
    await sb.from("ads").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-ads"] });
  };

  const cols: Column<Ad>[] = [
    { key: "name", header: "Name", searchValue: (r) => r.name, render: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
    { key: "placement", header: "Placement", searchValue: (r) => r.placement, render: (r) => <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{r.placement}</span> },
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
      <PageHeader title="Ads" action={
        <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
          <Plus className="h-4 w-4" /> Add New
        </button>
      } />
      <DataTable rows={rows} columns={cols} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="my-8 w-full max-w-lg rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">{editing ? "Edit Ad" : "New Ad"}</h3>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              <Field label="Name" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
              <Field label="Placement" required>
                <SelectInput value={form.placement} onChange={(e) => setForm({ ...form, placement: e.target.value })}>
                  {PLACEMENTS.map((p) => <option key={p} value={p}>{p}</option>)}
                </SelectInput>
              </Field>
              <Field label="Image URL"><TextInput value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://…" /></Field>
              <Field label="Link URL"><TextInput value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://…" /></Field>
              <Field label="Custom HTML (optional)"><TextArea rows={4} value={form.html} onChange={(e) => setForm({ ...form, html: e.target.value })} placeholder="<script>...</script>" /></Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                Active
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
