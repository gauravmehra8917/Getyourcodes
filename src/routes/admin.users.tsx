import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAdminUsers, type AdminUserRow } from "@/lib/admin.functions";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

function UsersPage() {
  const loadUsers = useServerFn(listAdminUsers);
  const {
    data: rows = [],
    isPending,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => loadUsers(),
  });

  const cols: Column<AdminUserRow>[] = [
    {
      key: "display_name",
      header: "Name",
      searchValue: (r) => r.display_name ?? "",
      render: (r) => <span className="font-medium text-slate-800">{r.display_name ?? "—"}</span>,
    },
    {
      key: "role",
      header: "Role",
      render: (r) => (
        <span
          className={`rounded-full px-3 py-0.5 text-xs font-semibold ${r.is_admin ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
        >
          {r.is_admin ? "Admin" : "User"}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "Joined",
      render: (r) => (
        <span className="text-xs text-slate-500">
          {new Date(r.created_at).toLocaleDateString("en-GB").replace(/\//g, "-")}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Users" />
      {isPending ? (
        <p role="status" className="text-sm text-slate-500">
          Loading users…
        </p>
      ) : isError ? (
        <div
          role="alert"
          className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          Could not load users. Please try again.
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="ml-3 rounded border border-rose-300 px-3 py-1 disabled:opacity-50"
          >
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : (
        <DataTable rows={rows} columns={cols} emptyText="No registered users found." />
      )}
    </div>
  );
}
