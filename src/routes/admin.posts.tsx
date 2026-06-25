import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Pencil, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/admin/posts")({ component: PostsPage });

type Row = { id: string; title: string; slug: string; status: string; published_at: string | null; created_at: string };

function PostsPage() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-posts"],
    queryFn: async () => {
      const { data } = await sb.from("posts").select("id,title,slug,status,published_at,created_at").order("created_at", { ascending: false });
      return (data ?? []) as Row[];
    },
  });

  const onDelete = async (id: string) => {
    if (!confirm("Delete this post?")) return;
    await sb.from("posts").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-posts"] });
  };

  const cols: Column<Row>[] = [
    { key: "title", header: "Title", searchValue: (r) => r.title, render: (r) => <span className="font-medium text-slate-800">{r.title}</span> },
    { key: "slug", header: "Slug", render: (r) => <code className="text-xs text-slate-500">/{r.slug}</code> },
    { key: "status", header: "Status", render: (r) => (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        r.status === "published" ? "bg-emerald-100 text-emerald-700"
        : r.status === "draft" ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-600"}`}>{r.status}</span>
    ) },
    { key: "published_at", header: "Published", render: (r) => r.published_at ? new Date(r.published_at).toLocaleDateString() : "—" },
    { key: "actions", header: "Action", render: (r) => (
      <div className="flex items-center gap-1">
        <Link to="/admin/posts/$id" params={{ id: r.id }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Pencil className="h-4 w-4" /></Link>
        <button onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Posts" action={
        <Link to="/admin/posts/new" className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
          <Plus className="h-4 w-4" /> Add New
        </Link>
      } />
      <DataTable rows={rows} columns={cols} />
    </div>
  );
}
