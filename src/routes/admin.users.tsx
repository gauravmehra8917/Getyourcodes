import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";

type Row = {
  id: string;
  display_name: string | null;
  created_at: string;
  is_admin: boolean;
};

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

function UsersPage() {
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        sb.from("profiles").select("id, display_name, created_at").order("created_at", { ascending: false }),
        sb.from("user_roles").select("user_id, role"),
      ]);
      const adminSet = new Set(
        (roles ?? []).filter((r: { role: string }) => r.role === "admin").map((r: { user_id: string }) => r.user_id)
      );
      return ((profiles ?? []) as { id: string; display_name: string | null; created_at: string }[]).map((p) => ({
        ...p,
        is_admin: adminSet.has(p.id),
      })) as Row[];
    },
  });

  const cols: Column<Row>[] = [
    { key: "display_name", header: "Name", searchValue: (r) => r.display_name ?? "", render: (r) => <span className="font-medium text-slate-800">{r.display_name ?? "—"}</span> },
    {
      key: "role",
      header: "Role",
      render: (r) => (
        <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${r.is_admin ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
          {r.is_admin ? "Admin" : "User"}
        </span>
      ),
    },
    { key: "created_at", header: "Joined", render: (r) => <span className="text-xs text-slate-500">{new Date(r.created_at).toLocaleDateString("en-GB").replace(/\//g, "-")}</span> },
  ];

  return (
    <div>
      <PageHeader title="Users" />
      <DataTable rows={rows} columns={cols} />
    </div>
  );
}
