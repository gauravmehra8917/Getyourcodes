import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Plug, Plus, Pencil, Zap, Power, Trash2, Loader2, Search, X, ChevronLeft, ChevronRight,
  ShieldCheck, Database, Activity, History, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, DownloadCloud, Eye,
  Image as ImageIcon,
} from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { ImportResultModal } from "@/components/admin/import-result-modal";
import { runProviderSync, getImportHistory, type SyncRunReport } from "@/lib/sync-execution.functions";
import { listPublishingPolicies, setIntegrationPolicy } from "@/lib/publishing-policies.functions";
import { syncStoreLogos, type LogoSyncReport } from "@/lib/presentation.functions";
import { IntegrationWizard, type IntegrationRecord as WizardRecord } from "@/components/admin/integration-wizard";
import {
  listIntegrations,
  toggleIntegration,
  deleteIntegration,
  testIntegration,
  getTestHistory,
  getAuditHistory,
  getMaskedCredentials,
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

type IntegrationRecord = WizardRecord & {
  status?: string | null;
  environment?: string | null;
  last_tested_at?: string | null;
  last_test_result?: TestResult | null;
  created_at?: string;
  updated_at?: string;
};

type TestResult = {
  status: "connected" | "failed" | "warning" | string;
  http_status: number | null;
  latency_ms: number;
  auth_status: string;
  message: string;
  environment: string;
  tested_at: string;
  debug?: {
    resolvedUrl?: string;
    baseUrl?: string;
    endpointPath?: string;
    joinedCorrectly?: boolean;
    method?: string;
    authScheme?: string;
    authorizationHeaderAttached?: boolean;
    authConfigured?: boolean;
    headers?: Record<string, string>;
    resolvedVariables?: string[];
    unresolvedVariables?: string[];
    reachedHttpClient?: boolean;
    responseStatus?: number | null;
    responseBodyPreview?: string;
  } | null;
};

const PROVIDER_TYPE_LABEL: Record<string, string> = {
  affiliate_network: "Affiliate Network",
  email_service: "Email",
  ai_service: "AI",
  analytics: "Analytics",
  payment_gateway: "Payment",
  custom_rest_api: "Custom API",
};

const STATUS_META: Record<string, { label: string; dot: string; badge: string }> = {
  connected: { label: "Connected", dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700" },
  never_tested: { label: "Never Tested", dot: "bg-amber-400", badge: "bg-amber-100 text-amber-700" },
  warning: { label: "Warning", dot: "bg-orange-500", badge: "bg-orange-100 text-orange-700" },
  failed: { label: "Failed", dot: "bg-rose-500", badge: "bg-rose-100 text-rose-700" },
  disabled: { label: "Disabled", dot: "bg-slate-400", badge: "bg-slate-200 text-slate-600" },
};

const PAGE_SIZE = 20;

type SortKey = "integration_name" | "provider_name" | "created_at" | "updated_at" | "last_tested_at" | "status";

function fmtLastTested(iso?: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.floor((startOf(now) - startOf(d)) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function IntegrationsPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<IntegrationRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<IntegrationRecord | null>(null);
  const [drawer, setDrawer] = useState<{ rec: IntegrationRecord; tab: "overview" | "history" | "audit" } | null>(null);
  const [testModal, setTestModal] = useState<{ rec: IntegrationRecord; running: boolean; result: TestResult | null; error?: string } | null>(null);
  const [importModal, setImportModal] = useState<{ rec: IntegrationRecord; preview: boolean; running: boolean; report: SyncRunReport | null; error?: string } | null>(null);

  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const listFn = useServerFn(listIntegrations);
  const toggleFn = useServerFn(toggleIntegration);
  const deleteFn = useServerFn(deleteIntegration);
  const testFn = useServerFn(testIntegration);
  const syncFn = useServerFn(runProviderSync);
  const logoFn = useServerFn(syncStoreLogos);
  const logoMutation = useMutation({
    mutationFn: (rec: { id: string; provider_type: string }) =>
      logoFn({ data: { provider: rec.provider_type, integrationId: rec.id } }) as Promise<LogoSyncReport>,
    onSuccess: (r: LogoSyncReport) =>

      toast.success(
        `Logos synced — ${r.downloaded} downloaded, ${r.skipped} already cached${r.failed ? `, ${r.failed} failed` : ""}`,
      ),
    onError: (e: Error) => toast.error(e.message),
  });

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

  const testMutation = useMutation({
    mutationFn: (id: string) => testFn({ data: { id } }) as Promise<TestResult>,
  });

  const runTest = (rec: IntegrationRecord) => {
    setTestModal({ rec, running: true, result: null });
    testMutation.mutate(rec.id, {
      onSuccess: (result) => {
        setTestModal({ rec, running: false, result });
        qc.invalidateQueries({ queryKey: ["admin-integrations"] });
        if (result.status === "connected") toast.success("Connection successful");
        else if (result.status === "warning") toast.warning("Test returned a warning");
        else toast.error("Connection failed");
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : "Test failed";
        setTestModal({ rec, running: false, result: null, error: msg });
        toast.error(msg);
      },
    });
  };

  const runImportFlow = (rec: IntegrationRecord, preview: boolean) => {
    setImportModal({ rec, preview, running: true, report: null });
    (syncFn({ data: { integrationId: rec.id, preview } }) as Promise<SyncRunReport>)
      .then((report) => {
        setImportModal({ rec, preview, running: false, report });
        if (report.error) toast.error(report.error);
        else if (report.validationErrors.length) toast.warning(`${report.validationErrors.length} record(s) failed validation`);
        else toast.success(preview ? "Preview completed" : "Import completed");
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Import failed";
        setImportModal({ rec, preview, running: false, report: null, error: msg });
        toast.error(msg);
      });
  };

  // Derived summary
  const summary = useMemo(() => {
    const s = { total: integrations.length, connected: 0, disabled: 0, failed: 0, never_tested: 0, warning: 0 };
    for (const r of integrations) {
      const st = effectiveStatus(r);
      if (st in s) (s as any)[st] += 1;
    }
    return s;
  }, [integrations]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = integrations.filter((r) => {
      if (q) {
        const hay = `${r.integration_name} ${r.provider_name} ${PROVIDER_TYPE_LABEL[r.provider_type] ?? r.provider_type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (providerFilter !== "all" && r.provider_type !== providerFilter) return false;
      if (statusFilter !== "all" && effectiveStatus(r) !== statusFilter) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const va = sortVal(a, sortKey);
      const vb = sortVal(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return rows;
  }, [integrations, search, providerFilter, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);
  const pageRows = filteredSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hasAny = integrations.length > 0;
  const hasFilters = search || providerFilter !== "all" || statusFilter !== "all";
  const clearFilters = () => {
    setSearch("");
    setProviderFilter("all");
    setStatusFilter("all");
    setPage(1);
  };

  const openCreate = () => { setEditing(null); setWizardOpen(true); };
  const openEdit = (rec: IntegrationRecord) => { setEditing(rec); setWizardOpen(true); };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const lastSuccess = useMemo(() => {
    let best: string | null = null;
    for (const r of integrations) {
      const st = r.last_test_result?.status;
      const at = r.last_tested_at;
      if (st === "connected" && at && (!best || at > best)) best = at;
    }
    return best;
  }, [integrations]);
  const lastFailed = useMemo(() => {
    let best: string | null = null;
    for (const r of integrations) {
      const st = r.last_test_result?.status;
      const at = r.last_tested_at;
      if ((st === "failed" || st === "warning") && at && (!best || at > best)) best = at;
    }
    return best;
  }, [integrations]);

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

      {/* Summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Total" value={summary.total} tone="slate" />
        <SummaryCard label="Connected" value={summary.connected} tone="emerald" />
        <SummaryCard label="Never Tested" value={summary.never_tested} tone="amber" />
        <SummaryCard label="Failed" value={summary.failed + summary.warning} tone="rose" />
        <SummaryCard label="Disabled" value={summary.disabled} tone="slate-dark" />
      </div>

      {/* Search + filters */}
      <div className="mb-4 flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input
            aria-label="Search integrations"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, provider, or type…"
            className="w-full rounded border border-slate-200 py-2 pl-8 pr-3 text-sm focus:border-slate-400 focus:outline-none"
          />
        </div>
        <select
          aria-label="Filter by provider type"
          value={providerFilter}
          onChange={(e) => { setProviderFilter(e.target.value); setPage(1); }}
          className="rounded border border-slate-200 bg-white px-2 py-2 text-sm"
        >
          <option value="all">All Providers</option>
          {Object.entries(PROVIDER_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded border border-slate-200 bg-white px-2 py-2 text-sm"
        >
          <option value="all">All Statuses</option>
          <option value="connected">Connected</option>
          <option value="never_tested">Never Tested</option>
          <option value="warning">Warning</option>
          <option value="failed">Failed</option>
          <option value="disabled">Disabled</option>
        </select>
        <select
          aria-label="Sort by"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded border border-slate-200 bg-white px-2 py-2 text-sm"
        >
          <option value="integration_name">Name</option>
          <option value="provider_name">Provider</option>
          <option value="created_at">Created</option>
          <option value="updated_at">Updated</option>
          <option value="last_tested_at">Last Tested</option>
          <option value="status">Status</option>
        </select>
        <button
          aria-label={`Sort ${sortDir === "asc" ? "descending" : "ascending"}`}
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          {sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          <ArrowUpDown className="h-3 w-3 text-slate-300" />
        </button>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {isLoading && <SkeletonGrid />}

      {!isLoading && !hasAny && (
        <EmptyState onCreate={openCreate} />
      )}

      {!isLoading && hasAny && filteredSorted.length === 0 && (
        <div className="mb-8 flex flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Search className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-800">No matching integrations found</h3>
          <p className="mt-1 text-sm text-slate-500">Try adjusting your search or filters.</p>
          <button onClick={clearFilters} className="mt-4 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900">
            Clear Filters
          </button>
        </div>
      )}

      {!isLoading && pageRows.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {pageRows.map((rec) => (
              <IntegrationCard
                key={rec.id}
                rec={rec}
                testing={testMutation.isPending && testModal?.rec.id === rec.id}
                onOpen={() => setDrawer({ rec, tab: "overview" })}
                onEdit={() => openEdit(rec)}
                onTest={() => runTest(rec)}
                onToggle={() => toggleMutation.mutate({ id: rec.id, enabled: !rec.is_enabled })}
                onDelete={() => setConfirmDelete(rec)}
                onHistory={() => setDrawer({ rec, tab: "audit" })}
                onPreviewImport={() => runImportFlow(rec, true)}
                onRunImport={() => runImportFlow(rec, false)}
                syncingLogos={logoMutation.isPending && logoMutation.variables?.id === rec.id}
                onSyncLogos={() => logoMutation.mutate(rec)}
              />
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between text-sm text-slate-600">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredSorted.length)} of {filteredSorted.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Previous page"
                className="rounded border border-slate-200 bg-white p-1.5 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Next page"
                className="rounded border border-slate-200 bg-white p-1.5 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* System Health */}
      <SystemHealth
        total={summary.total}
        lastSuccess={lastSuccess}
        lastFailed={lastFailed}
      />

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

      {drawer && (
        <DetailsDrawer
          rec={drawer.rec}
          initialTab={drawer.tab}
          onClose={() => setDrawer(null)}
          onTest={() => { const r = drawer.rec; setDrawer(null); runTest(r); }}
          onEdit={() => { const r = drawer.rec; setDrawer(null); openEdit(r); }}
        />
      )}

      {importModal && (
        <ImportResultModal
          title={`${importModal.preview ? "Preview Import" : "Run Import"} — ${importModal.rec.integration_name}`}
          running={importModal.running}
          report={importModal.report}
          error={importModal.error}
          onClose={() => setImportModal(null)}
          onRetry={() => runImportFlow(importModal.rec, importModal.preview)}
        />
      )}

      {testModal && (
        <TestResultModal
          rec={testModal.rec}
          running={testModal.running}
          result={testModal.result}
          error={testModal.error}
          onClose={() => setTestModal(null)}
          onRetry={() => runTest(testModal.rec)}
        />
      )}
    </div>
  );
}

function effectiveStatus(r: IntegrationRecord): string {
  if (!r.is_enabled) return "disabled";
  if (r.status && r.status !== "disabled") return r.status;
  return r.last_test_result?.status ?? "never_tested";
}

function sortVal(r: IntegrationRecord, key: SortKey): string | number | null {
  switch (key) {
    case "integration_name": return r.integration_name?.toLowerCase() ?? "";
    case "provider_name": return r.provider_name?.toLowerCase() ?? "";
    case "created_at": return r.created_at ?? null;
    case "updated_at": return r.updated_at ?? null;
    case "last_tested_at": return r.last_tested_at ?? null;
    case "status": return effectiveStatus(r);
  }
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.never_tested;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden />
      {m.label}
    </span>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "slate" | "emerald" | "amber" | "rose" | "slate-dark" }) {
  const tones: Record<string, string> = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
    "slate-dark": "border-slate-300 bg-slate-100",
  };
  return (
    <div className={`rounded-md border p-4 shadow-sm ${tones[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-md border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-slate-200" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 rounded bg-slate-200" />
              <div className="h-4 w-40 rounded bg-slate-200" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-slate-100" />
            <div className="h-3 w-3/4 rounded bg-slate-100" />
            <div className="h-3 w-1/2 rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mb-8 flex flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Plug className="h-8 w-8" />
      </div>
      <h3 className="text-lg font-semibold text-slate-800">No integrations configured</h3>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        Connect affiliate networks and external services to automate coupon, store, and deal imports.
      </p>
      <button
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-2 rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700"
      >
        <Plus className="h-4 w-4" /> Add Your First Integration
      </button>
    </div>
  );
}

function IntegrationCard({
  rec, testing, onOpen, onEdit, onTest, onToggle, onDelete, onHistory, onPreviewImport, onRunImport,
  syncingLogos, onSyncLogos,
}: {
  rec: IntegrationRecord;
  testing: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onPreviewImport: () => void;
  onRunImport: () => void;
  syncingLogos: boolean;
  onSyncLogos: () => void;
}) {
  const status = effectiveStatus(rec);
  return (
    <div className="relative flex flex-col rounded-md border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="absolute right-3 top-3">
        <StatusBadge status={status} />
      </div>
      <button
        onClick={onOpen}
        aria-label={`Open details for ${rec.integration_name}`}
        className="mb-3 flex items-center gap-3 text-left"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-100 text-slate-500">
          <Plug className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium uppercase tracking-wider text-slate-500">{rec.provider_name}</div>
          <div className="truncate text-sm font-semibold text-slate-800 hover:text-slate-900">{rec.integration_name}</div>
        </div>
      </button>

      <dl className="mb-4 grid grid-cols-2 gap-y-2 text-xs">
        <dt className="text-slate-500">Provider Type</dt>
        <dd className="text-right font-medium text-slate-700">
          {PROVIDER_TYPE_LABEL[rec.provider_type] ?? rec.provider_type}
        </dd>
        <dt className="text-slate-500">Last Tested</dt>
        <dd className="text-right font-medium text-slate-700">{fmtLastTested(rec.last_tested_at)}</dd>
        <dt className="text-slate-500">Latency</dt>
        <dd className="text-right font-medium text-slate-700">
          {rec.last_test_result?.latency_ms != null ? `${rec.last_test_result.latency_ms} ms` : "—"}
        </dd>
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <ActionBtn icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</ActionBtn>
        <ActionBtn
          icon={testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          onClick={onTest}
          disabled={testing}
        >
          {testing ? "Testing…" : "Test"}
        </ActionBtn>
        <ActionBtn
          icon={<Power className="h-3.5 w-3.5" />}
          onClick={onToggle}
          tone={rec.is_enabled ? "warn" : "success"}
        >
          {rec.is_enabled ? "Disable" : "Enable"}
        </ActionBtn>
        <ActionBtn icon={<Eye className="h-3.5 w-3.5" />} onClick={onPreviewImport}>Preview Import</ActionBtn>
        <ActionBtn icon={<DownloadCloud className="h-3.5 w-3.5" />} onClick={onRunImport}>Run Import</ActionBtn>
        <ActionBtn
          icon={syncingLogos ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
          onClick={onSyncLogos}
          disabled={syncingLogos}
          title="Download merchant logos into storage"
        >
          {syncingLogos ? "Syncing logos…" : "Sync Logos"}
        </ActionBtn>
        <ActionBtn icon={<History className="h-3.5 w-3.5" />} onClick={onHistory}>History</ActionBtn>
        <ActionBtn icon={<Trash2 className="h-3.5 w-3.5" />} tone="danger" onClick={onDelete}>Delete</ActionBtn>
      </div>
    </div>
  );
}

function ActionBtn({
  icon, children, tone, disabled, onClick, title,
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

function ConfirmDelete({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-md bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h4 className="text-base font-semibold text-slate-800">Delete integration?</h4>
        <p className="mt-1 text-sm text-slate-600">
          This will permanently remove <span className="font-medium">{name}</span> and its stored credentials. This action cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={onConfirm} className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">Delete</button>
        </div>
      </div>
    </div>
  );
}

function TestResultModal({
  rec, running, result, error, onClose, onRetry,
}: {
  rec: IntegrationRecord;
  running: boolean;
  result: TestResult | null;
  error?: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const ok = result?.status === "connected";
  const warn = result?.status === "warning";
  const headerColor = running ? "bg-slate-50 text-slate-700" : ok ? "bg-emerald-50 text-emerald-700" : warn ? "bg-orange-50 text-orange-700" : "bg-rose-50 text-rose-700";
  const headline = running ? "Testing connection…" : ok ? "✅ Connection Successful" : warn ? "⚠️ Connection Warning" : "❌ Connection Failed";

  return (
    <div role="dialog" aria-modal="true" aria-label="Test result" className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-md bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-3 ${headerColor}`}>
          <div className="text-sm font-semibold">{headline}</div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-white/40"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 px-5 py-4 text-sm">
          <div className="flex items-center justify-between border-b border-slate-100 py-1.5">
            <span className="text-slate-500">Integration</span>
            <span className="font-medium text-slate-800">{rec.integration_name}</span>
          </div>
          {running && (
            <div className="flex items-center gap-2 py-4 text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Running validation & health check…
            </div>
          )}
          {!running && error && (
            <div className="rounded border border-rose-200 bg-rose-50 p-3 text-rose-700">{error}</div>
          )}
          {!running && result && (
            <>
              <Row label="Status"><StatusBadge status={result.status} /></Row>
              <Row label="HTTP Status">{result.http_status ?? "—"}</Row>
              <Row label="Authentication">{authLabel(result.auth_status)}</Row>
              <Row label="Response Time">{result.latency_ms} ms</Row>
              <Row label="Environment">{result.environment}</Row>
              <Row label="Timestamp">{new Date(result.tested_at).toLocaleString()}</Row>
              {result.message && (
                <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">{result.message}</div>
              )}
              {result.debug && <DebugInformation debug={result.debug} />}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button onClick={onRetry} disabled={running} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
          <button onClick={onClose} className="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900">Close</button>
        </div>
      </div>
    </div>
  );
}

function DebugInformation({ debug }: { debug: NonNullable<TestResult["debug"]> }) {
  const [open, setOpen] = React.useState(true);
  const item = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[150px_1fr] gap-2 border-b border-slate-100 py-1">
      <span className="text-slate-500">{label}</span>
      <span className="break-all font-mono text-[11px] text-slate-800">{value}</span>
    </div>
  );
  return (
    <div className="rounded border border-amber-200 bg-amber-50/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-amber-800"
      >
        Debug Information
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="max-h-72 overflow-auto px-3 pb-3 text-xs">
          {item("Resolved Request URL", debug.resolvedUrl ?? "—")}
          {item("Base URL", debug.baseUrl ?? "—")}
          {item("Endpoint Path", debug.endpointPath ?? "—")}
          {item("URL Join OK", debug.joinedCorrectly ? "yes" : "no — check slashes")}
          {item("HTTP Method", debug.method ?? "—")}
          {item("Authentication Scheme", debug.authScheme ?? "none")}
          {item("Authorization Header", debug.authorizationHeaderAttached ? "attached" : "not attached")}
          {item(
            "Placeholder Resolution",
            <>
              <div>resolved: {debug.resolvedVariables?.length ? debug.resolvedVariables.join(", ") : "none"}</div>
              <div>unresolved: {debug.unresolvedVariables?.length ? debug.unresolvedVariables.join(", ") : "none"}</div>
            </>,
          )}
          {item("Reached HTTP Client", debug.reachedHttpClient ? "yes" : "no")}
          {item("Response Status", debug.responseStatus ?? "—")}
          {item(
            "Request Headers",
            <pre className="whitespace-pre-wrap">{JSON.stringify(debug.headers ?? {}, null, 2)}</pre>,
          )}
          {item(
            "Response Body (500 chars)",
            <pre className="whitespace-pre-wrap">{debug.responseBodyPreview || "—"}</pre>,
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{children}</span>
    </div>
  );
}

function authLabel(s: string) {
  switch (s) {
    case "valid": return "Valid";
    case "invalid": return "Invalid Token";
    case "not_configured": return "Not Configured";
    default: return "Unknown";
  }
}

function DetailsDrawer({
  rec, initialTab, onClose, onTest, onEdit,
}: {
  rec: IntegrationRecord;
  initialTab: "overview" | "history" | "audit" | "imports";
  onClose: () => void;
  onTest: () => void;
  onEdit: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const historyFn = useServerFn(getTestHistory);
  const importsFn = useServerFn(getImportHistory);
  const policiesFn = useServerFn(listPublishingPolicies);
  const assignPolicyFn = useServerFn(setIntegrationPolicy);
  const auditFn = useServerFn(getAuditHistory);
  const credsFn = useServerFn(getMaskedCredentials);

  const historyQ = useQuery({
    queryKey: ["integration-history", rec.id],
    queryFn: () => historyFn({ data: { id: rec.id } }) as Promise<any[]>,
    enabled: tab === "history",
  });
  const auditQ = useQuery({
    queryKey: ["integration-audit", rec.id],
    queryFn: () => auditFn({ data: { id: rec.id } }) as Promise<any[]>,
    enabled: tab === "audit",
  });
  const importsQ = useQuery({
    queryKey: ["integration-imports", rec.id],
    queryFn: () => importsFn({ data: { integrationId: rec.id } }),
    enabled: tab === "imports",
  });
  const policiesQ = useQuery({
    queryKey: ["admin-publishing-policies"],
    queryFn: () => policiesFn(),
    enabled: tab === "overview",
  });
  const [policyId, setPolicyId] = useState<string>(
    ((rec as unknown as { publishing_policy_id?: string | null }).publishing_policy_id ?? "") || "",
  );

  const credsQ = useQuery({
    queryKey: ["integration-masked-creds", rec.id],
    queryFn: () => credsFn({ data: { id: rec.id } }) as Promise<Record<string, string>>,
    enabled: tab === "overview",
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const status = effectiveStatus(rec);
  const endpoints = (rec.endpoint_configuration as Record<string, string> | null) ?? {};

  return (
    <div role="dialog" aria-modal="true" aria-label={`Integration details ${rec.integration_name}`} className="fixed inset-0 z-[60] flex justify-end bg-slate-900/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{rec.provider_name}</div>
            <h3 className="truncate text-lg font-semibold text-slate-800">{rec.integration_name}</h3>
            <div className="mt-1"><StatusBadge status={status} /></div>
          </div>
          <button onClick={onClose} aria-label="Close drawer" className="rounded p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-200 px-3 pt-2">
          {(["overview", "history", "imports", "audit"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t px-3 py-2 text-sm font-medium ${tab === t ? "border-b-2 border-slate-800 text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
            >
              {t === "overview" ? "Overview" : t === "history" ? "Test History" : t === "imports" ? "Imports" : "Audit"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "overview" && (
            <div className="space-y-6 text-sm">
              <Section title="General">
                <KV k="Integration Name" v={rec.integration_name} />
                <KV k="Provider" v={rec.provider_name} />
                <KV k="Provider Type" v={PROVIDER_TYPE_LABEL[rec.provider_type] ?? rec.provider_type} />
                <KV k="Authentication" v={rec.authentication_type} />
                <KV k="Base URL" v={rec.base_url} />
                <KV k="Environment" v={rec.environment ?? "production"} />
                <KV k="Created" v={rec.created_at ? new Date(rec.created_at).toLocaleString() : "—"} />
                <KV k="Updated" v={rec.updated_at ? new Date(rec.updated_at).toLocaleString() : "—"} />
                <KV k="Last Tested" v={fmtLastTested(rec.last_tested_at)} />
              </Section>
              <Section title="Configuration">
                <KV k="API Version" v={rec.api_version || "—"} />
                <KV k="Timeout" v={`${rec.timeout_seconds}s`} />
                <KV k="Retry Attempts" v={String(rec.retry_attempts)} />
                {Object.entries(endpoints).filter(([, v]) => v).map(([k, v]) => (
                  <KV key={k} k={`Endpoint · ${k}`} v={v} />
                ))}
              </Section>
              <Section title="Publishing Policy">
                <select
                  aria-label="Publishing policy for this integration"
                  value={policyId}
                  onChange={async (e) => {
                    const v = e.target.value;
                    setPolicyId(v);
                    await assignPolicyFn({ data: { integrationId: rec.id, policyId: v || null } });
                  }}
                  className="h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm text-slate-800"
                >
                  <option value="">Global default policy</option>
                  {(policiesQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.is_default ? " (default)" : ""}
                      {p.enabled ? "" : " — disabled"}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-500">
                  Applied after deduplication and before anything is published to the catalog.
                </p>
              </Section>
              <Section title="Credentials (masked)">
                {credsQ.isLoading ? (
                  <div className="text-slate-500">Loading…</div>
                ) : credsQ.data && Object.keys(credsQ.data).length > 0 ? (
                  Object.entries(credsQ.data).map(([k, v]) => <KV key={k} k={k} v={v || "—"} />)
                ) : (
                  <div className="text-slate-500">No credentials on file.</div>
                )}
                <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-500">Secrets are stored encrypted and never displayed in full.</p>
              </Section>
            </div>
          )}

          {tab === "history" && (
            <div className="space-y-2 text-sm">
              {historyQ.isLoading && <div className="text-slate-500">Loading history…</div>}
              {historyQ.data && historyQ.data.length === 0 && (
                <div className="rounded border border-dashed border-slate-200 p-6 text-center text-slate-500">No tests recorded yet.</div>
              )}
              {historyQ.data?.map((h: any) => (
                <div key={h.id} className="rounded border border-slate-200 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <StatusBadge status={h.status} />
                    <span className="text-xs text-slate-500">{new Date(h.created_at).toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-slate-600">
                    <div><span className="text-slate-400">HTTP</span> {h.http_status ?? "—"}</div>
                    <div><span className="text-slate-400">Latency</span> {h.latency_ms ?? "—"} ms</div>
                    <div><span className="text-slate-400">Auth</span> {authLabel(h.auth_status)}</div>
                  </div>
                  {h.message && <div className="mt-1 text-xs text-slate-500">{h.message}</div>}
                </div>
              ))}
            </div>
          )}

          {tab === "imports" && (
            <div className="space-y-2 text-sm">
              {importsQ.isLoading && <div className="text-slate-500">Loading import history…</div>}
              {importsQ.data && importsQ.data.length === 0 && (
                <div className="rounded border border-dashed border-slate-200 p-6 text-center text-slate-500">No imports recorded yet.</div>
              )}
              {importsQ.data?.map((r) => (
                <div key={r.id} className="rounded border border-slate-200 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${r.success ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                      {r.preview ? "Preview" : "Import"} · {r.success ? "Success" : "Failed"}
                    </span>
                    <span className="text-xs text-slate-500">{new Date(r.started_at).toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-slate-600">
                    <div><span className="text-slate-400">Created</span> {r.records_created}</div>
                    <div><span className="text-slate-400">Updated</span> {r.records_updated}</div>
                    <div><span className="text-slate-400">Skipped</span> {r.records_skipped}</div>
                    <div><span className="text-slate-400">Published</span> {Math.max(0, r.records_created + r.records_updated)}</div>
                    <div><span className="text-slate-400">Held</span> <span className="text-amber-700">{r.records_held ?? 0}</span></div>
                    <div><span className="text-slate-400">Policy</span> {r.policy_name ?? "—"}</div>
                  </div>
                  {r.error_message && <div className="mt-1 text-xs text-rose-600">{r.error_message}</div>}
                </div>
              ))}
            </div>
          )}

          {tab === "audit" && (
            <div className="space-y-2 text-sm">
              {auditQ.isLoading && <div className="text-slate-500">Loading audit log…</div>}
              {auditQ.data && auditQ.data.length === 0 && (
                <div className="rounded border border-dashed border-slate-200 p-6 text-center text-slate-500">No audit events yet.</div>
              )}
              {auditQ.data?.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between rounded border border-slate-200 p-3">
                  <div>
                    <div className="text-sm font-medium capitalize text-slate-800">{a.action} · {a.entity.replace("affiliate_", "")}</div>
                    <div className="text-xs text-slate-500">{a.meta?.description ?? ""}</div>
                  </div>
                  <span className="text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onEdit} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          <button onClick={onTest} className="inline-flex items-center gap-1 rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900">
            <Zap className="h-3.5 w-3.5" /> Test Connection
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h4>
      <div className="space-y-1 rounded border border-slate-200 bg-white p-3">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
      <span className="text-xs text-slate-500">{k}</span>
      <span className="max-w-[60%] truncate text-right text-xs font-medium text-slate-700" title={v}>{v}</span>
    </div>
  );
}

function SystemHealth({ total, lastSuccess, lastFailed }: { total: number; lastSuccess: string | null; lastFailed: string | null }) {
  return (
    <div className="mt-8 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">System Health</h3>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        <HealthItem icon={<Plug className="h-3.5 w-3.5" />} label="Total Integrations" value={String(total)} />
        <HealthItem icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />} label="Credential Storage" value="Healthy" tone="ok" />
        <HealthItem icon={<Database className="h-3.5 w-3.5 text-emerald-600" />} label="Database" value="Healthy" tone="ok" />
        <HealthItem icon={<Activity className="h-3.5 w-3.5" />} label="Last Successful Test" value={fmtLastTested(lastSuccess)} />
        <HealthItem icon={<Activity className="h-3.5 w-3.5" />} label="Last Failed Test" value={fmtLastTested(lastFailed)} />
        <HealthItem icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />} label="Security" value="Encrypted (AES-256-GCM)" tone="ok" />
        <HealthItem icon={<Activity className="h-3.5 w-3.5" />} label="Module Version" value="v1.0.0" />
      </dl>
    </div>
  );
}

function HealthItem({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "ok" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex items-center gap-1.5 text-slate-500">{icon} {label}</dt>
      <dd className={`font-medium ${tone === "ok" ? "text-emerald-700" : "text-slate-700"}`}>{value}</dd>
    </div>
  );
}
