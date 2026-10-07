import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { runAdminSecondaryAction } from "@/lib/admin-secondary-actions";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Trash2, Check } from "lucide-react";

export const Route = createFileRoute("/admin/subscribers")({ component: SubscribersPage });

type Sub = { id: string; email: string; active: boolean; created_at: string };

function SubscribersPage() {
  const qc = useQueryClient();
  const pendingActions = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState(new Set<string>());
  const {
    data: rows = [],
    isPending,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["admin-subscribers"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("subscribers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error("Could not load subscribers. Please try again.");
      return (data ?? []) as Sub[];
    },
  });

  const toggle = (r: Sub) =>
    runAdminSecondaryAction({
      key: r.id,
      pending: pendingActions.current,
      mutate: () => sb.from("subscribers").update({ active: !r.active }).eq("id", r.id),
      failureMessage: "Could not update this subscriber. Please try again.",
      refreshFailureMessage:
        "Subscriber status was updated, but the list could not be refreshed. Please retry loading the list.",
      onBusyChange: () => setBusyIds(new Set(pendingActions.current)),
      onError: (message) => toast.error(message),
      refresh: () =>
        qc.invalidateQueries({ queryKey: ["admin-subscribers"] }, { throwOnError: true }),
    });
  const onDelete = (id: string) =>
    runAdminSecondaryAction({
      key: id,
      pending: pendingActions.current,
      confirm: () => confirm("Delete this subscriber?"),
      mutate: () => sb.from("subscribers").delete().eq("id", id),
      failureMessage: "Could not delete this subscriber. Please try again.",
      refreshFailureMessage:
        "The subscriber was deleted, but the list could not be refreshed. Please retry loading the list.",
      onBusyChange: () => setBusyIds(new Set(pendingActions.current)),
      onError: (message) => toast.error(message),
      refresh: () =>
        qc.invalidateQueries({ queryKey: ["admin-subscribers"] }, { throwOnError: true }),
    });

  const exportCsv = () => {
    if (isPending || isError || isFetching) return;
    const csv = [
      "email,active,subscribed_at",
      ...rows.map((r) => `${r.email},${r.active},${r.created_at}`),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subscribers.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const cols: Column<Sub>[] = [
    {
      key: "email",
      header: "Email",
      searchValue: (r) => r.email,
      render: (r) => <span className="font-medium text-slate-800">{r.email}</span>,
    },
    {
      key: "active",
      header: "Status",
      render: (r) => (
        <button
          onClick={() => void toggle(r)}
          disabled={busyIds.has(r.id)}
          title={busyIds.has(r.id) ? "Change pending…" : "Toggle subscriber status"}
          aria-label={busyIds.has(r.id) ? "Subscriber change pending…" : "Toggle subscriber status"}
          className="text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          {r.active ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
              <Check className="h-3 w-3" /> Active
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
              Unsubscribed
            </span>
          )}
        </button>
      ),
    },
    {
      key: "date",
      header: "Subscribed",
      render: (r) => (
        <span className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</span>
      ),
    },
    {
      key: "actions",
      header: "Action",
      render: (r) => (
        <button
          onClick={() => void onDelete(r.id)}
          disabled={busyIds.has(r.id)}
          aria-label={busyIds.has(r.id) ? "Subscriber change pending…" : "Delete subscriber"}
          title={busyIds.has(r.id) ? "Change pending…" : "Delete"}
          className="rounded p-1.5 text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Subscribers"
        action={
          <button
            onClick={exportCsv}
            disabled={isPending || isError || isFetching}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900 disabled:opacity-50"
          >
            Export CSV
          </button>
        }
      />
      {isPending ? (
        <p role="status" className="text-sm text-slate-500">
          Loading subscribers…
        </p>
      ) : isError ? (
        <div
          role="alert"
          className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          Could not load subscribers. Please try again.
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="ml-3 rounded border border-rose-300 px-3 py-1 disabled:opacity-50"
          >
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : (
        <DataTable rows={rows} columns={cols} emptyText="No subscribers yet." />
      )}
    </div>
  );
}
