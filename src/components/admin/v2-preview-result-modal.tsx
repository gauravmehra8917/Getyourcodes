import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, X } from "lucide-react";
import {
  buildAffiliateSyncPreviewV2Sections,
  getAdminV2PreviewOperatorStatus,
  type AdminV2PreviewHostResponse,
  type AffiliateSyncPreviewV2Metric,
} from "@/lib/affiliate-sync-v2-preview";

function Metric({ label, value, tone }: AffiliateSyncPreviewV2Metric) {
  const valueClass =
    tone === "bad"
      ? "text-rose-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "ok"
          ? "text-emerald-700"
          : "text-slate-800";
  const rendered =
    value === null ? "—" : typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-right text-sm font-semibold ${valueClass}`}>{rendered}</span>
    </div>
  );
}

function ReadOnlyNotice() {
  return (
    <div className="mb-5 rounded border border-sky-200 bg-sky-50 px-4 py-3 text-sky-900">
      <div className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4" />
        Affiliate Sync V2 Preview · READ ONLY
      </div>
      <p className="mt-1 text-sm">NO DATABASE WRITES · NO IMPORT HISTORY WRITES</p>
      <p className="mt-1 text-xs text-sky-800">
        V2 Preview itself is read-only. Production execution is a separate, explicitly authorized
        path.
      </p>
    </div>
  );
}

export function V2PreviewResultModal({
  title,
  running,
  response,
  error,
  onClose,
  onRetry,
}: {
  title: string;
  running: boolean;
  response: AdminV2PreviewHostResponse | null;
  error?: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const sections = response ? buildAffiliateSyncPreviewV2Sections(response) : [];
  const operatorStatus = response ? getAdminV2PreviewOperatorStatus(response.preview) : null;
  const collapseDetected =
    response?.preview.identityIntegrityDiagnostics.identityCollapseDetected === true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            <p className="text-[11px] text-slate-500">
              Affiliate Sync V2 · Read-only provider preview
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-50 px-5 py-4">
          <ReadOnlyNotice />

          {running && (
            <div className="mb-5 flex items-center gap-2 rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching and planning with Affiliate Sync
              V2…
            </div>
          )}

          {!running && error && (
            <div className="mb-5 flex items-start gap-2 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">V2 preview failed</div>
                <div className="mt-0.5">{error}</div>
              </div>
            </div>
          )}

          {!running && response && (
            <>
              <div
                className={`mb-5 flex items-start gap-2 rounded border px-4 py-3 text-sm ${
                  operatorStatus?.tone === "bad"
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : operatorStatus?.tone === "warn"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                }`}
              >
                {operatorStatus?.tone === "bad" || operatorStatus?.tone === "warn" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div>
                  <div className="font-semibold">{operatorStatus?.title}</div>
                  <div className="mt-0.5 text-xs">
                    Identity collapse: {collapseDetected ? "detected" : "none"}. Status uses only
                    authoritative V2 diagnostics.
                  </div>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                {sections.map((section) => (
                  <section key={section.title}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {section.title}
                    </h3>
                    <div className="rounded border border-slate-200 bg-white px-4">
                      {section.metrics.map((metric) => (
                        <Metric key={metric.label} {...metric} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
          <button
            onClick={onRetry}
            disabled={running}
            className="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            Run V2 preview again
          </button>
        </div>
      </div>
    </div>
  );
}
