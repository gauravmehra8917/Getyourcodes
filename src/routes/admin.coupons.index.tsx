import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { deleteAdminCatalogRow } from "@/lib/admin-catalog-delete";
import {
  isProviderManagedEntity,
  PROVIDER_MANAGED_DELETE_MESSAGE,
  type ProviderEntityIdentity,
} from "@/lib/admin-entity-ownership";
import { sb, type Coupon } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { YesIcon, NoIcon, StatusPill } from "@/components/admin/status-icons";
import { Pencil, Trash2, Plus } from "lucide-react";

type Row = Coupon &
  ProviderEntityIdentity & { stores: { name: string; logo_url: string | null } | null };

export const Route = createFileRoute("/admin/coupons/")({
  component: CouponsList,
});

function CouponsList() {
  const qc = useQueryClient();
  const pendingDeletes = useRef(new Set<string>());
  const [deletingIds, setDeletingIds] = useState(new Set<string>());
  const {
    data: rows = [],
    isPending,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("coupons")
        .select("*, stores(name, logo_url)")
        .order("created_at", { ascending: false });
      if (error) throw new Error("Could not load coupons. Please try again.");
      return (data ?? []) as Row[];
    },
  });

  const onDelete = (row: Row) =>
    deleteAdminCatalogRow({
      kind: "coupon",
      row,
      pendingIds: pendingDeletes.current,
      confirmDelete: () => confirm("Delete this coupon?"),
      deleteRow: () => sb.from("coupons").delete().eq("id", row.id),
      onBusyChange: () => setDeletingIds(new Set(pendingDeletes.current)),
      onError: (message) => toast.error(message),
      refresh: () => qc.invalidateQueries({ queryKey: ["admin-coupons"] }),
    });

  const columns: Column<Row>[] = [
    {
      key: "store",
      header: "Store",
      searchValue: (r) => r.stores?.name ?? "",
      render: (r) =>
        r.stores?.logo_url ? (
          <img
            src={r.stores.logo_url}
            alt={`${r.stores.name} logo`}
            className="h-8 w-8 rounded border border-slate-200 object-contain p-0.5"
          />
        ) : (
          <div className="h-8 w-8 rounded bg-slate-200" />
        ),
    },
    {
      key: "title",
      header: "Title",
      searchValue: (r) => r.title,
      render: (r) => <span className="font-medium text-slate-800">{r.title}</span>,
    },
    {
      key: "type",
      header: "Type",
      searchValue: (r) => r.coupon_type,
      render: (r) => (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase text-slate-600">
          {r.coupon_type}
        </span>
      ),
    },
    {
      key: "featured",
      header: "Featured",
      render: (r) => (r.featured_in_banner ? <YesIcon /> : <NoIcon />),
    },
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
            onClick={() => void onDelete(r)}
            disabled={isProviderManagedEntity(r) || deletingIds.has(r.id)}
            className="rounded p-1.5 text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              isProviderManagedEntity(r)
                ? PROVIDER_MANAGED_DELETE_MESSAGE
                : deletingIds.has(r.id)
                  ? "Deleting…"
                  : "Delete"
            }
            aria-label={
              isProviderManagedEntity(r) ? PROVIDER_MANAGED_DELETE_MESSAGE : "Delete coupon"
            }
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
      {isPending ? (
        <p role="status" className="text-sm text-slate-500">
          Loading coupons…
        </p>
      ) : isError ? (
        <div
          role="alert"
          className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          Could not load coupons. Please try again.
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="ml-3 rounded border border-rose-300 px-3 py-1 disabled:opacity-50"
          >
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : (
        <DataTable rows={rows} columns={columns} />
      )}
    </div>
  );
}
