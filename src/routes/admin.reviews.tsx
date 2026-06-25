import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Check, X, Trash2, Star } from "lucide-react";

export const Route = createFileRoute("/admin/reviews")({ component: ReviewsPage });

type Row = { id: string; store_id: string; rating: number; title: string | null; body: string | null; status: string; created_at: string; stores: { name: string } | null };

function ReviewsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("pending");
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-reviews", filter],
    queryFn: async () => {
      let q = sb.from("store_reviews").select("id,store_id,rating,title,body,status,created_at, stores(name)").order("created_at", { ascending: false });
      if (filter !== "all") q = q.eq("status", filter);
      const { data } = await q;
      return (data ?? []) as Row[];
    },
  });

  const setStatus = async (id: string, status: string) => {
    await sb.from("store_reviews").update({ status }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-reviews"] });
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this review?")) return;
    await sb.from("store_reviews").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-reviews"] });
  };

  const cols: Column<Row>[] = [
    { key: "store", header: "Store", render: (r) => <span className="font-medium text-slate-800">{r.stores?.name ?? "—"}</span> },
    { key: "rating", header: "Rating", render: (r) => (
      <span className="inline-flex items-center gap-0.5 text-amber-500">
        {Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-3.5 w-3.5 ${i < r.rating ? "fill-amber-500" : "text-slate-300"}`} />)}
      </span>
    ) },
    { key: "title", header: "Title", searchValue: (r) => r.title ?? "", render: (r) => <span className="text-slate-700">{r.title ?? "—"}</span> },
    { key: "body", header: "Review", searchValue: (r) => r.body ?? "", render: (r) => <span className="line-clamp-2 max-w-md text-slate-600">{r.body ?? "—"}</span> },
    { key: "status", header: "Status", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
      r.status === "approved" ? "bg-emerald-100 text-emerald-700"
      : r.status === "pending" ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-600"}`}>{r.status}</span> },
    { key: "actions", header: "Action", render: (r) => (
      <div className="flex items-center gap-1">
        <button title="Approve" onClick={() => setStatus(r.id, "approved")} className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
        <button title="Reject" onClick={() => setStatus(r.id, "rejected")} className="rounded p-1.5 text-amber-600 hover:bg-amber-50"><X className="h-4 w-4" /></button>
        <button title="Delete" onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Store Reviews" action={
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 rounded border border-slate-300 bg-white px-3 text-sm">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      } />
      <DataTable rows={rows} columns={cols} />
    </div>
  );
}
