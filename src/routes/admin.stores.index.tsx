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
import { sb, type Store } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { YesIcon, NoIcon } from "@/components/admin/status-icons";
import { Pencil, Trash2, Plus } from "lucide-react";

type Row = Store & ProviderEntityIdentity;

export const Route = createFileRoute("/admin/stores/")({
  component: StoresList,
});

function StoresList() {
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
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data, error } = await sb.from("stores").select("*").order("name");
      if (error) throw new Error("Could not load stores. Please try again.");
      return (data ?? []) as Row[];
    },
  });

  const onDelete = (row: Row) =>
    deleteAdminCatalogRow({
      kind: "store",
      row,
      pendingIds: pendingDeletes.current,
      confirmDelete: () => confirm("Delete this store?"),
      deleteRow: () => sb.from("stores").delete().eq("id", row.id),
      onBusyChange: () => setDeletingIds(new Set(pendingDeletes.current)),
      onError: (message) => toast.error(message),
      refresh: () => qc.invalidateQueries({ queryKey: ["admin-stores"] }),
    });

  const cols: Column<Row>[] = [
    {
      key: "logo",
      header: "Logo",
      render: (r) =>
        r.logo_url ? (
          <img
            src={r.logo_url}
            alt={`${r.name} logo`}
            className="h-10 w-10 rounded border border-slate-200 object-contain p-0.5"
          />
        ) : (
          <div className="h-10 w-10 rounded bg-slate-200" />
        ),
    },
    {
      key: "name",
      header: "Name",
      searchValue: (r) => r.name,
      render: (r) => <span className="font-medium text-slate-800">{r.name}</span>,
    },
    {
      key: "slug",
      header: "Slug",
      searchValue: (r) => r.slug,
      render: (r) => <span className="text-xs text-slate-500">/{r.slug}</span>,
    },
    { key: "featured", header: "Featured", render: (r) => (r.featured ? <YesIcon /> : <NoIcon />) },
    {
      key: "actions",
      header: "Action",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Link
            to="/admin/stores/$id"
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
              isProviderManagedEntity(r) ? PROVIDER_MANAGED_DELETE_MESSAGE : "Delete store"
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
        title="Stores"
        action={
          <Link
            to="/admin/stores/new"
            className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900"
          >
            <Plus className="h-4 w-4" /> Add New
          </Link>
        }
      />
      {isPending ? (
        <p role="status" className="text-sm text-slate-500">
          Loading stores…
        </p>
      ) : isError ? (
        <div
          role="alert"
          className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          Could not load stores. Please try again.
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="ml-3 rounded border border-rose-300 px-3 py-1 disabled:opacity-50"
          >
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : (
        <DataTable rows={rows} columns={cols} />
      )}
    </div>
  );
}
