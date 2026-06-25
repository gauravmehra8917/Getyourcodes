import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Trash2, Check, X, AlertOctagon } from "lucide-react";

export const Route = createFileRoute("/admin/comments")({ component: CommentsPage });

type Row = { id: string; post_id: string; author_name: string | null; body: string; status: string; created_at: string; posts: { title: string } | null };

function CommentsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("pending");
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-comments", filter],
    queryFn: async () => {
      let q = sb.from("post_comments").select("id,post_id,author_name,body,status,created_at, posts(title)").order("created_at", { ascending: false });
      if (filter !== "all") q = q.eq("status", filter);
      const { data } = await q;
      return (data ?? []) as Row[];
    },
  });

  const setStatus = async (id: string, status: string) => {
    await sb.from("post_comments").update({ status }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-comments"] });
  };
  const onDelete = async (id: string) => {
    if (!confirm("Delete this comment?")) return;
    await sb.from("post_comments").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-comments"] });
  };

  const cols: Column<Row>[] = [
    { key: "post", header: "Post", render: (r) => <span className="text-slate-700">{r.posts?.title ?? "—"}</span> },
    { key: "author", header: "Author", render: (r) => <span className="text-slate-700">{r.author_name ?? "Anonymous"}</span> },
    { key: "body", header: "Comment", searchValue: (r) => r.body, render: (r) => <span className="line-clamp-2 max-w-md text-slate-600">{r.body}</span> },
    { key: "status", header: "Status", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(r.status)}`}>{r.status}</span> },
    { key: "created_at", header: "Date", render: (r) => new Date(r.created_at).toLocaleDateString() },
    { key: "actions", header: "Action", render: (r) => (
      <div className="flex items-center gap-1">
        <button title="Approve" onClick={() => setStatus(r.id, "approved")} className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
        <button title="Reject" onClick={() => setStatus(r.id, "rejected")} className="rounded p-1.5 text-amber-600 hover:bg-amber-50"><X className="h-4 w-4" /></button>
        <button title="Mark spam" onClick={() => setStatus(r.id, "spam")} className="rounded p-1.5 text-orange-600 hover:bg-orange-50"><AlertOctagon className="h-4 w-4" /></button>
        <button title="Delete" onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Comments" action={
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 rounded border border-slate-300 bg-white px-3 text-sm">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="spam">Spam</option>
          <option value="all">All</option>
        </select>
      } />
      <DataTable rows={rows} columns={cols} />
    </div>
  );
}

function badgeClass(s: string) {
  if (s === "approved") return "bg-emerald-100 text-emerald-700";
  if (s === "pending") return "bg-amber-100 text-amber-700";
  if (s === "spam") return "bg-orange-100 text-orange-700";
  return "bg-slate-100 text-slate-600";
}
