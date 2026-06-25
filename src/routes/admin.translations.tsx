import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, TextArea } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X } from "lucide-react";

export const Route = createFileRoute("/admin/translations")({ component: TranslationsPage });

type Row = { id: string; locale: string; key: string; value: string };
const empty = { locale: "en", key: "", value: "" };

function TranslationsPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-translations"],
    queryFn: async () => {
      const { data } = await sb.from("translations").select("*").order("locale").order("key");
      return (data ?? []) as Row[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState(empty);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (r: Row) => { setEditing(r); setForm({ locale: r.locale, key: r.key, value: r.value }); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.locale || !form.key) return;
    if (editing) await sb.from("translations").update(form).eq("id", editing.id);
    else await sb.from("translations").insert(form);
    qc.invalidateQueries({ queryKey: ["admin-translations"] });
    setOpen(false);
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this translation?")) return;
    await sb.from("translations").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-translations"] });
  };

  const cols: Column<Row>[] = [
    { key: "locale", header: "Locale", searchValue: (r) => r.locale, render: (r) => <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">{r.locale}</span> },
    { key: "key", header: "Key", searchValue: (r) => r.key, render: (r) => <code className="text-xs text-slate-700">{r.key}</code> },
    { key: "value", header: "Value", searchValue: (r) => r.value, render: (r) => <span className="text-slate-800">{r.value}</span> },
    { key: "actions", header: "Action", render: (r) => (
      <div className="flex items-center gap-1">
        <button onClick={() => startEdit(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Edit"><Pencil className="h-4 w-4" /></button>
        <button onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Translations" action={
        <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
          <Plus className="h-4 w-4" /> Add New
        </button>
      } />
      <DataTable rows={rows} columns={cols} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">{editing ? "Edit Translation" : "New Translation"}</h3>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Locale" required><TextInput value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })} placeholder="en" required /></Field>
                <Field label="Key" required><TextInput value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="home.title" required /></Field>
              </div>
              <Field label="Value" required><TextArea value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required /></Field>
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
