import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb, type Coupon } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { YesIcon, NoIcon, StatusPill } from "@/components/admin/status-icons";
import { Pencil, Trash2, Plus } from "lucide-react";

type Row = Coupon & { stores: { name: string; logo_url: string | null } | null };

export const Route = createFileRoute("/admin/coupons/")({
  component: CouponsList,
});

function CouponsList() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async () => {
      const { data } = await sb
        .from("coupons")
        .select("*, stores(name, logo_url)")
        .order("created_at", { ascending: false });
      return (data ?? []) as Row[];
    },
  });

  const onDelete = async (id: string) => {
    if (!confirm("Delete this coupon?")) return;
    await sb.from("coupons").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["admin-coupons"] });
  };

  const columns: Column<Row>[] = [
    {
      key: "store",
      header: "Store",
      searchValue: (r) => r.stores?.name ?? "",
      render: (r) =>
        r.stores?.logo_url ? (
          <img src={r.stores.logo_url} alt={`${r.stores.name} logo`} className="h-8 w-8 rounded border border-slate-200 object-contain p-0.5" />
        ) : (
          <div className="h-8 w-8 rounded bg-slate-200" />
        ),
    },
    { key: "title", header: "Title", searchValue: (r) => r.title, render: (r) => <span className="font-medium text-slate-800">{r.title}</span> },
    {
      key: "type",
      header: "Type",
      searchValue: (r) => r.coupon_type,
      render: (r) => <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase text-slate-600">{r.coupon_type}</span>,
    },
    { key: "featured", header: "Featured", render: (r) => (r.featured_in_banner ? <YesIcon /> : <NoIcon />) },
    {
      key: "status",
      header: "Status",
      searchValue: (r) => r.status,
      render: (r) => <StatusPill enabled={r.status === "active"} />,
    },
    {
      key: "actions",
      header: "Action",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Link
            to="/admin/coupons/$id"
            params={{ id: r.id }}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Link>
          <button
            onClick={() => onDelete(r.id)}
            className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Coupons"
        action={
          <Link
            to="/admin/coupons/new"
            className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900"
          >
            <Plus className="h-4 w-4" /> Add New
          </Link>
        }
      />
      <DataTable rows={rows} columns={columns} />
    </div>
  );
}