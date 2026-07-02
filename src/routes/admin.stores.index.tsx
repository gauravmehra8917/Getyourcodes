import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb, type Store } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { YesIcon, NoIcon } from "@/components/admin/status-icons";
import { Pencil, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/admin/stores/")({
  component: StoresList,
});

function StoresList() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data } = await sb.from("stores").select("*").order("name");
      return (data ?? []) as Store[];
    },
  });

  const onDelete = async (id: string) => {
    if (!confirm("Delete this store?")) return;
    await sb.from("stores").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-stores"] });
  };

  const cols: Column<Store>[] = [
    {
      key: "logo",
      header: "Logo",
      render: (r) =>
        r.logo_url ? (
          <img src={r.logo_url} alt={`${r.name} logo`} className="h-10 w-10 rounded border border-slate-200 object-contain p-0.5" />
        ) : (
          <div className="h-10 w-10 rounded bg-slate-200" />
        ),
    },
    { key: "name", header: "Name", searchValue: (r) => r.name, render: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
    { key: "slug", header: "Slug", searchValue: (r) => r.slug, render: (r) => <span className="text-xs text-slate-500">/{r.slug}</span> },
    { key: "featured", header: "Featured", render: (r) => (r.featured ? <YesIcon /> : <NoIcon />) },
    {
      key: "actions",
      header: "Action",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Link to="/admin/stores/$id" params={{ id: r.id }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Edit">
            <Pencil className="h-4 w-4" />
          </Link>
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
        title="Stores"
        action={
          <Link to="/admin/stores/new" className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
            <Plus className="h-4 w-4" /> Add New
          </Link>
        }
      />
      <DataTable rows={rows} columns={cols} />
    </div>
  );
}