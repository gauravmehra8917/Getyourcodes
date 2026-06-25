import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";

export const Route = createFileRoute("/admin/activity")({ component: ActivityPage });

type Row = { id: string; actor_id: string | null; action: string; entity: string; entity_id: string | null; meta: Record<string, unknown>; created_at: string };

function ActivityPage() {
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-activity"],
    queryFn: async () => {
      const { data } = await sb.from("admin_activity_log").select("*").order("created_at", { ascending: false }).limit(500);
      return (data ?? []) as Row[];
    },
  });

  const cols: Column<Row>[] = [
    { key: "created_at", header: "When", render: (r) => new Date(r.created_at).toLocaleString() },
    { key: "action", header: "Action", searchValue: (r) => r.action, render: (r) => <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.action}</code> },
    { key: "entity", header: "Entity", searchValue: (r) => r.entity, render: (r) => <span className="text-slate-700">{r.entity}</span> },
    { key: "entity_id", header: "Entity ID", render: (r) => <code className="text-xs text-slate-500">{r.entity_id ?? "—"}</code> },
    { key: "actor_id", header: "Actor", render: (r) => <code className="text-xs text-slate-500">{r.actor_id?.slice(0, 8) ?? "—"}</code> },
    { key: "meta", header: "Details", render: (r) => <span className="line-clamp-1 max-w-sm text-xs text-slate-500">{Object.keys(r.meta ?? {}).length ? JSON.stringify(r.meta) : "—"}</span> },
  ];

  return (
    <div>
      <PageHeader title="Activity Log" />
      <DataTable rows={rows} columns={cols} emptyText="No admin actions logged yet." />
    </div>
  );
}
