import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb, type Category } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Pencil, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/admin/subcategories/")({
  component: SubcategoriesList,
});

type Sub = { id: string; name: string; slug: string; category_id: string };

function SubcategoriesList() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-subcategories"],
    queryFn: async () => {
      const { data } = await sb.from("subcategories").select("*").order("name");
      return (data ?? []) as Sub[];
    },
  });
  const { data: cats = [] } = useQuery({
    queryKey: ["admin-categories-all"],
    queryFn: async () => {
      const { data } = await sb.from("categories").select("id,name,slug").order("name");
      return (data ?? []) as Category[];
    },
  });
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? "—";

  const onDelete = async (id: string) => {
    if (!confirm("Delete this sub category?")) return;
    await sb.from("subcategories").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-subcategories"] });
  };

  const cols: Column<Sub>[] = [
    { key: "name", header: "Name", searchValue: (r) => r.name, render: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
    { key: "category", header: "Category", searchValue: (r) => catName(r.category_id), render: (r) => <span className="text-slate-700">{catName(r.category_id)}</span> },
    { key: "slug", header: "Slug", searchValue: (r) => r.slug, render: (r) => <span className="text-xs text-slate-500">/{r.slug}</span> },
    {
      key: "actions", header: "Action",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Link to="/admin/subcategories/$id" params={{ id: r.id }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Edit">
            <Pencil className="h-4 w-4" />
          </Link>
          <button onClick={() => onDelete(r.id)} className="rounded p-1.5 text-rose-500 hover:bg-rose-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Sub Categories" action={
        <Link to="/admin/subcategories/new" className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900">
          <Plus className="h-4 w-4" /> Add New
        </Link>
      } />
      <DataTable rows={rows} columns={cols} />
    </div>
  );
}
