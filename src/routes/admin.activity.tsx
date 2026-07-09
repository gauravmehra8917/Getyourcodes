import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";

export const Route = createFileRoute("/admin/activity")({ component: ActivityPage });

type Row = {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  meta: { name?: string; description?: string; op?: string } | null;
  created_at: string;
  actor_name?: string;
};

const ENTITY_LABEL: Record<string, string> = {
  stores: "Store",
  categories: "Category",
  subcategories: "Sub Category",
  coupons: "Coupon",
  posts: "Blog Post",
  pages: "Page",
  profiles: "User",
  user_roles: "User Role",
  site_settings: "Setting",
};

const ACTION_STYLE: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-rose-100 text-rose-700",
};

function ActivityPage() {
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-activity"],
    queryFn: async () => {
      const { data } = await sb
        .from("admin_activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      const logs = (data ?? []) as Row[];
      const actorIds = Array.from(
        new Set(logs.map((r) => r.actor_id).filter((v): v is string => !!v))
      );
      if (actorIds.length) {
        const { data: profiles } = await sb
          .from("profiles")
          .select("id, display_name")
          .in("id", actorIds);
        const map = new Map(
          ((profiles ?? []) as { id: string; display_name: string | null }[]).map(
            (p) => [p.id, p.display_name ?? ""]
          )
        );
        logs.forEach((r) => {
          if (r.actor_id) r.actor_name = map.get(r.actor_id) ?? "";
        });
      }
      return logs;
    },
  });

  const cols: Column<Row>[] = [
    {
      key: "created_at",
      header: "When",
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-slate-500">
          {new Date(r.created_at).toLocaleString()}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      searchValue: (r) => r.action,
      render: (r) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
            ACTION_STYLE[r.action] ?? "bg-slate-100 text-slate-700"
          }`}
        >
          {r.action === "create" ? "Created" : r.action === "update" ? "Updated" : r.action === "delete" ? "Deleted" : r.action}
        </span>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      searchValue: (r) => r.entity,
      render: (r) => (
        <span className="font-medium text-slate-700">
          {ENTITY_LABEL[r.entity] ?? r.entity}
        </span>
      ),
    },
    {
      key: "name",
      header: "Name",
      searchValue: (r) => r.meta?.name ?? "",
      render: (r) => (
        <span className="text-slate-800">{r.meta?.name || "—"}</span>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      searchValue: (r) => r.actor_name ?? "",
      render: (r) => (
        <span className="text-slate-600">
          {r.actor_name || (r.actor_id ? r.actor_id.slice(0, 8) : "System")}
        </span>
      ),
    },
    {
      key: "entity_id",
      header: "Entity ID",
      render: (r) => (
        <code className="text-xs text-slate-400">
          {r.entity_id ? r.entity_id.slice(0, 8) : "—"}
        </code>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Activity Log" />
      <DataTable rows={rows} columns={cols} emptyText="No admin actions logged yet." />
    </div>
  );
}
