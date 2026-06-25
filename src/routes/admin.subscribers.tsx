import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Trash2, Check } from "lucide-react";

export const Route = createFileRoute("/admin/subscribers")({ component: SubscribersPage });

type Sub = { id: string; email: string; active: boolean; created_at: string };

function SubscribersPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-subscribers"],
    queryFn: async () => {
      const { data } = await sb.from("subscribers").select("*").order("created_at", { ascending: false });
      return (data ?? []) as Sub[];
    },
  });

  const toggle = async (r: Sub) => {
    await sb.from("subscribers").update({ active: !r.active }).eq("id", r.id);
    qc.invalidateQueries({ queryKey: ["admin-subscribers"] });
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this subscriber?")) return;
    await sb.from("subscribers").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-subscribers"] });
  };

  const exportCsv = () => {
    const csv = ["email,active,subscribed_at", ...rows.map((r) => `${r.email},${r.active},${r.created_at}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "subscribers.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const cols: Column<Sub>[] = [
    { key: "email", header: "Email", searchValue: (r) => r.email, render: (r) => <span className="font-medium text-slate-800">{r.email}</span> },
    { key: "active", header: "Status", render: (r) => (
      <button onClick={() => toggle(r)} className="text-xs">
        {r.active
          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"><Check className="h-3 w-3" /> Active</span>
          : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">Unsubscribed</span>}
      </button>
    ) },
    { key: "date", header: "Subscribed", render: (r) => <span className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</span> },
    { key: "actions", header: "Action", render: (r) => (
      <button onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Subscribers" action={
        <button onClick={exportCsv} className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">Export CSV</button>
      } />
      <DataTable rows={rows} columns={cols} emptyText="No subscribers yet." />
    </div>
  );
}
