import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plug, Plus, Pencil, Zap, Power, Trash2, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { IntegrationWizard, type IntegrationRecord } from "@/components/admin/integration-wizard";
import {
  listIntegrations,
  toggleIntegration,
  deleteIntegration,
} from "@/lib/integrations.functions";

export const Route = createFileRoute("/admin/integrations")({
  head: () => ({
    meta: [
      { title: "API Integrations — Getyourcodes Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: IntegrationsPage,
});

const PROVIDER_TYPE_LABEL: Record<string, string> = {
  affiliate_network: "Affiliate Network",
  email_service: "Email Service",
  ai_service: "AI Service",
  analytics: "Analytics",
  payment_gateway: "Payment Gateway",
  custom_rest_api: "Custom REST API",
};

function IntegrationsPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<IntegrationRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<IntegrationRecord | null>(null);

  const listFn = useServerFn(listIntegrations);
  const toggleFn = useServerFn(toggleIntegration);
  const deleteFn = useServerFn(deleteIntegration);
  const qc = useQueryClient();

  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ["admin-integrations"],
    queryFn: () => listFn({}) as Promise<IntegrationRecord[]>,
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) => toggleFn({ data: vars }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["admin-integrations"] });
      const prev = qc.getQueryData<IntegrationRecord[]>(["admin-integrations"]);
      qc.setQueryData<IntegrationRecord[]>(["admin-integrations"], (rows) =>
        (rows ?? []).map((r) => (r.id === vars.id ? { ...r, is_enabled: vars.enabled } : r)),
      );
      return { prev };
    },
    onError: (err, _v, ctx) => {
      qc.setQueryData(["admin-integrations"], ctx?.prev);
      toast.error(err instanceof Error ? err.message : "Failed to update");
    },
    onSuccess: (_d, vars) => toast.success(vars.enabled ? "Integration enabled" : "Integration disabled"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin-integrations"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Integration deleted");
      qc.invalidateQueries({ queryKey: ["admin-integrations"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete"),
  });

  const hasIntegrations = integrations.length > 0;

  const openCreate = () => {
    setEditing(null);
    setWizardOpen(true);
  };
  const openEdit = (rec: IntegrationRecord) => {
    setEditing(rec);
    setWizardOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="API Integrations"
        action={
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900"
          >
            <Plus className="h-4 w-4" /> Add Integration
          </button>
        }
      />
      <p className="-mt-3 mb-6 text-sm text-slate-500">
        Manage external API connections and affiliate network integrations.
      </p>

      {isLoading && (
        <div className="flex items-center justify-center rounded-md border border-slate-200 bg-white py-10 text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading integrations…
        </div>
      )}

      {!isLoading && !hasIntegrations && (
        <div className="mb-8 flex flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Plug className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-semibold text-slate-800">No integrations configured</h3>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            Connect affiliate networks and external services to automate coupon, store, and deal imports.
          </p>
          <button
            onClick={openCreate}
            className="mt-5 inline-flex items-center gap-2 rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" /> Add Your First Integration
          </button>
        </div>
      )}

      {!isLoading && hasIntegrations && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {integrations.map((rec) => (
            <IntegrationCard
              key={rec.id}
              rec={rec}
              onEdit={() => openEdit(rec)}
              onToggle={() => toggleMutation.mutate({ id: rec.id, enabled: !rec.is_enabled })}
              onDelete={() => setConfirmDelete(rec)}
            />
          ))}
        </div>
      )}

      {wizardOpen && (
        <IntegrationWizard
          editing={editing}
          onClose={() => setWizardOpen(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["admin-integrations"] })}
        />
      )}

      {confirmDelete && (
        <ConfirmDelete
          name={confirmDelete.integration_name}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const id = confirmDelete.id;
            setConfirmDelete(null);
            deleteMutation.mutate(id);
          }}
        />
      )}
    </div>
  );
}

function IntegrationCard({
  rec,
  onEdit,
  onToggle,
  onDelete,
}: {
  rec: IntegrationRecord & { updated_at?: string };
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative flex flex-col rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <span
        className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
          rec.is_enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
        }`}
      >
        {rec.is_enabled ? "Enabled" : "Disabled"}
      </span>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-100 text-slate-500">
          <Plug className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium uppercase tracking-wider text-slate-500">
            {rec.provider_name}
          </div>
          <div className="truncate text-sm font-semibold text-slate-800">{rec.integration_name}</div>
        </div>
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-y-2 text-xs">
        <dt className="text-slate-500">Provider Type</dt>
        <dd className="text-right font-medium text-slate-700">
          {PROVIDER_TYPE_LABEL[rec.provider_type] ?? rec.provider_type}
        </dd>
        <dt className="text-slate-500">Connection Status</dt>
        <dd className="text-right font-medium text-amber-600">Pending</dd>
        <dt className="text-slate-500">Last Updated</dt>
        <dd className="text-right font-medium text-slate-700">
          {rec.updated_at ? new Date(rec.updated_at).toLocaleDateString() : "—"}
        </dd>
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <ActionBtn icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</ActionBtn>
        <ActionBtn icon={<Zap className="h-3.5 w-3.5" />} disabled title="Available in Phase 1D">Test</ActionBtn>
        <ActionBtn
          icon={<Power className="h-3.5 w-3.5" />}
          onClick={onToggle}
          tone={rec.is_enabled ? "warn" : "success"}
        >
          {rec.is_enabled ? "Disable" : "Enable"}
        </ActionBtn>
        <ActionBtn icon={<Trash2 className="h-3.5 w-3.5" />} tone="danger" onClick={onDelete}>
          Delete
        </ActionBtn>
      </div>
    </div>
  );
}

function ActionBtn({
  icon,
  children,
  tone,
  disabled,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: "danger" | "success" | "warn";
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const toneCls = disabled
    ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
    : tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        : tone === "warn"
          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      aria-disabled={disabled}
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${toneCls}`}
    >
      {icon} {children}
    </button>
  );
}

function ConfirmDelete({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4"
      onClick={onCancel}
    >
      <div className="w-full max-w-sm rounded-md bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h4 className="text-base font-semibold text-slate-800">Delete integration?</h4>
        <p className="mt-1 text-sm text-slate-600">
          This will permanently remove <span className="font-medium">{name}</span> and its stored credentials. This action cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
