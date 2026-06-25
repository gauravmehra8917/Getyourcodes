import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, TextArea } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X } from "lucide-react";

export const Route = createFileRoute("/admin/etemplates")({ component: EmailTemplatesPage });

type Tpl = { id: string; key: string; subject: string; body: string };
const empty = { key: "", subject: "", body: "" };

function EmailTemplatesPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-etemplates"],
    queryFn: async () => {
      const { data } = await sb.from("email_templates").select("*").order("key");
      return (data ?? []) as Tpl[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Tpl | null>(null);
  const [form, setForm] = useState(empty);

  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const startEdit = (r: Tpl) => { setEditing(r); setForm({ key: r.key, subject: r.subject, body: r.body }); setOpen(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.key || !form.subject) return;
    if (editing) await sb.from("email_templates").update(form).eq("id", editing.id);
    else await sb.from("email_templates").insert(form);
    qc.invalidateQueries({ queryKey: ["admin-etemplates"] });
    setOpen(false);
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    await sb.from("email_templates").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-etemplates"] });
  };

  const cols: Column<Tpl>[] = [
    { key: "key", header: "Key", searchValue: (r) => r.key, render: (r) => <code className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-800">{r.key}</code> },
    { key: "subject", header: "Subject", searchValue: (r) => r.subject, render: (r) => <span className="text-slate-800">{r.subject}</span> },
    { key: "actions", header: "Action", render: (r) => (
      <div className="flex items-center gap-1">
        <button onClick={() => startEdit(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Edit"><Pencil className="h-4 w-4" /></button>
        <button onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Email Templates" action={
        <button onClick={startNew} className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
          <Plus className="h-4 w-4" /> Add New
        </button>
      } />
      <DataTable rows={rows} columns={cols} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="my-8 w-full max-w-2xl rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">{editing ? "Edit Template" : "New Template"}</h3>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              <Field label="Key" required><TextInput value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="welcome_email" required /></Field>
              <Field label="Subject" required><TextInput value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required /></Field>
              <Field label="Body (HTML)" required><TextArea rows={10} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required /></Field>
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
