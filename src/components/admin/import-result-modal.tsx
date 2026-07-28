import * as React from "react";
import { X, Loader2, AlertTriangle, CheckCircle2, Download } from "lucide-react";
import type { ReportIssue, SyncRunReport } from "@/lib/sync-execution.functions";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="rounded border border-slate-200 bg-white px-4">{children}</div>
    </div>
  );
}

/** Buckets a free-form validation reason into a rule category. */
function ruleOf(issue: ReportIssue): string {
  const r = issue.reason.toLowerCase();
  if (r.includes("provider entity id")) return "Missing provider ID";
  if (r.includes("invalid status")) return "Invalid status";
  if (r.includes("url")) return "Invalid / missing URL";
  if (r.includes("date")) return "Invalid date";
  if (r.includes("empty") || r.includes("missing")) return "Missing required field";
  if (r.includes("duplicate")) return "Duplicate record";
  return "Other";
}

const ENTITY_LABEL: Record<string, string> = {
  store: "Stores",
  coupon: "Coupons",
  deal: "Deals",
  category: "Categories",
};

function Breakdown({ issues }: { issues: ReportIssue[] }) {
  const byEntity = new Map<string, number>();
  const byRule = new Map<string, number>();
  for (const i of issues) {
    byEntity.set(i.entity, (byEntity.get(i.entity) ?? 0) + 1);
    const rule = ruleOf(i);
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded border border-slate-200 bg-white px-4">
        <div className="border-b border-slate-100 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Failing entity types
        </div>
        {[...byEntity.entries()].map(([k, v]) => (
          <Row key={k} label={ENTITY_LABEL[k] ?? k} value={v} />
        ))}
      </div>
      <div className="rounded border border-slate-200 bg-white px-4">
        <div className="border-b border-slate-100 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Failing validation rules
        </div>
        {[...byRule.entries()].map(([k, v]) => (
          <Row key={k} label={k} value={v} />
        ))}
      </div>
    </div>
  );
}

function IssueTable({ issues, emptyText }: { issues: ReportIssue[]; emptyText: string }) {
  const [showAll, setShowAll] = React.useState(false);
  if (!issues.length) return <p className="text-sm text-slate-500">{emptyText}</p>;
  const rows = showAll ? issues : issues.slice(0, 25);
  return (
    <div>
      <div className="max-h-80 overflow-auto rounded border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Entity</th>
              <th className="px-3 py-2 font-semibold">Provider ID</th>
              <th className="px-3 py-2 font-semibold">Field</th>
              <th className="px-3 py-2 font-semibold">Validation error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-3 py-2 capitalize text-slate-700">{i.entity}</td>
                <td className="px-3 py-2 font-mono text-slate-700">{i.providerEntityId ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{i.field ?? "—"}</td>
                <td className="px-3 py-2 text-rose-700">{i.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {issues.length > 25 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="mt-2 text-xs font-medium text-slate-700 underline"
        >
          {showAll ? "Show fewer" : `Show all ${issues.length} records`}
        </button>
      )}
    </div>
  );
}

/** Identity accounting — provider immutable id is the only identity key. */
function IdentitySummaryTable({ rows }: { rows: SyncRunReport["identity"] }) {
  if (!rows.length) return null;
  return (
    <div className="mb-5">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Identity summary (provider identifier)
      </div>
      <div className="overflow-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Entity</th>
              <th className="px-3 py-2 font-semibold">Fetched</th>
              <th className="px-3 py-2 font-semibold">Unique identities</th>
              <th className="px-3 py-2 font-semibold">Duplicate identities</th>
              <th className="px-3 py-2 font-semibold">Duplicate records</th>
              <th className="px-3 py-2 font-semibold">Create</th>
              <th className="px-3 py-2 font-semibold">Update</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entity} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-700">{ENTITY_LABEL[r.entity] ?? r.entity}</td>
                <td className="px-3 py-2 text-slate-700">{r.fetched}</td>
                <td className="px-3 py-2 text-slate-700">{r.uniqueIdentities}</td>
                <td className="px-3 py-2 text-slate-700">{r.duplicateIdentities}</td>
                <td className="px-3 py-2 text-slate-700">{r.duplicateRecords}</td>
                <td className="px-3 py-2 text-emerald-700">{r.toCreate}</td>
                <td className="px-3 py-2 text-sky-700">{r.toUpdate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Phase 3A — how imported records will look once published. */
function PresentationTable({ rows }: { rows: SyncRunReport["presentation"] }) {
  const flag = (ok: boolean, okText: string, badText: string) => (
    <span className={ok ? "text-emerald-700" : "text-amber-700"}>{ok ? okText : badText}</span>
  );
  return (
    <div className="mb-5">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Presentation & SEO preview (first {rows.length})
      </div>
      <div className="max-h-72 overflow-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Entity</th>
              <th className="px-3 py-2 font-semibold">Generated SEO title</th>
              <th className="px-3 py-2 font-semibold">Meta description</th>
              <th className="px-3 py-2 font-semibold">Logo</th>
              <th className="px-3 py-2 font-semibold">Description</th>
              <th className="px-3 py-2 font-semibold">Tracking</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.entity}-${r.providerEntityId}`} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 capitalize text-slate-700">{r.entity}</td>
                <td className="px-3 py-2 text-slate-700">
                  {r.seoTitle}
                  <span className="ml-1 text-slate-400">({r.seoTitle.length})</span>
                </td>
                <td className="max-w-xs px-3 py-2 text-slate-500">
                  {r.seoDescription}
                  <span className="ml-1 text-slate-400">({r.seoDescription.length})</span>
                </td>
                <td className="px-3 py-2">
                  {r.entity === "store"
                    ? flag(r.logoStatus !== "missing", r.logoStatus === "hosted" ? "Hosted" : "Provider", "Missing")
                    : "—"}
                </td>
                <td className="px-3 py-2">{flag(r.descriptionStatus === "present", "Yes", "Missing")}</td>
                <td className="px-3 py-2">{flag(r.trackingSource !== "none", r.trackingSource, "none")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function DuplicateTable({ issues, provider }: { issues: ReportIssue[]; provider: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded border border-slate-200">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 font-semibold">Provider</th>
            <th className="px-3 py-2 font-semibold">Entity</th>
            <th className="px-3 py-2 font-semibold">Provider identity</th>
            <th className="px-3 py-2 font-semibold">Occurrences</th>
            <th className="px-3 py-2 font-semibold">Raw provider ID</th>
            <th className="px-3 py-2 font-semibold">Reason</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i, idx) => (
            <tr key={idx} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-700">{i.provider ?? provider}</td>
              <td className="px-3 py-2 capitalize text-slate-700">{i.entity}</td>
              <td className="px-3 py-2 font-mono text-slate-700">{i.providerEntityId ?? "—"}</td>
              <td className="px-3 py-2 text-slate-700">{i.occurrences ?? 2}</td>
              <td className="px-3 py-2 font-mono text-slate-600">{i.rawProviderId ?? i.providerEntityId ?? "—"}</td>
              <td className="px-3 py-2 text-amber-700">{i.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toCsv(report: SyncRunReport) {
  const rows = [
    ["type", "entity", "provider", "provider_id", "raw_provider_id", "occurrences", "field", "reason"],
    ...report.validationErrors.map((i) => [
      "validation", i.entity, i.provider ?? report.provider, i.providerEntityId ?? "", i.rawProviderId ?? "", "", i.field ?? "", i.reason,
    ]),
    ...report.conflicts.map((i) => [
      "duplicate", i.entity, i.provider ?? report.provider, i.providerEntityId ?? "", i.rawProviderId ?? "", i.occurrences ?? "", i.field ?? "", i.reason,
    ]),
    ...report.skipped.map((i) => [
      "skipped", i.entity, i.provider ?? report.provider, i.providerEntityId ?? "", i.rawProviderId ?? "", "", i.field ?? "", i.reason,
    ]),
  ];
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}


export function ImportResultModal({
  title,
  running,
  report,
  error,
  onClose,
  onRetry,
}: {
  title: string;
  running: boolean;
  report: SyncRunReport | null;
  error?: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const downloadCsv = () => {
    if (!report) return;
    const blob = new Blob([toCsv(report)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-issues-${report.provider}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const p = report?.planCounts;
  const s = report?.statistics;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-50 px-5 py-4">
          {running && (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Running…
            </div>
          )}

          {!running && error && (
            <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          )}

          {!running && report && (
            <>
              {report.error ? (
                <div className="mb-4 flex items-start gap-2 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {report.error}
                </div>
              ) : (
                <div className="mb-4 flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  {report.preview ? "Preview completed — nothing was written." : "Import committed."}
                </div>
              )}

              <IdentitySummaryTable rows={report.identity} />

              {report.logos && (
                <Section title="Merchant logos">
                  <Row label="Stores Processed" value={report.logos.processed} />
                  <Row label="Logos Downloaded" value={report.logos.downloaded} />
                  <Row label="Already Cached" value={report.logos.skipped} />
                  <Row label="Failed" value={report.logos.failed} />
                  {report.logos.errors.length > 0 && (
                    <Row
                      label="Errors"
                      value={<span className="text-amber-700">{report.logos.errors.slice(0, 5).join("; ")}</span>}
                    />
                  )}
                </Section>
              )}

              {report.presentation.length > 0 && <PresentationTable rows={report.presentation} />}



              {p && (
                <Section title="Plan">
                  <Row label="Stores to Create" value={p.storesToCreate} />
                  <Row label="Stores to Update" value={p.storesToUpdate} />
                  <Row label="Coupons to Create" value={p.couponsToCreate} />
                  <Row label="Coupons to Update" value={p.couponsToUpdate} />
                  <Row label="Deals to Create" value={p.dealsToCreate} />
                  <Row label="Deals to Update" value={p.dealsToUpdate} />
                  <Row label="Categories to Create" value={p.categoriesToCreate} />
                  <Row label="Categories to Update" value={p.categoriesToUpdate} />
                  <Row label="Records Skipped" value={p.skipped} />
                </Section>
              )}

              {s && (
                <Section title="Validation">
                  <Row label="Records Validated" value={s.validated} />
                  <Row label="Validation Errors" value={s.validationFailures} />
                  <Row label="Duplicate Records" value={s.duplicates} />
                  <Row label="Created" value={s.created} />
                  <Row label="Updated" value={s.updated} />
                </Section>
              )}

              {report.validationErrors.length > 0 && (
                <div className="mb-5">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Failure breakdown
                  </div>
                  <Breakdown issues={report.validationErrors} />
                </div>
              )}

              <div className="mb-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Failed records ({report.validationErrors.length})
                  </span>
                  {(report.validationErrors.length > 0 || report.skipped.length > 0) && (
                    <button
                      onClick={downloadCsv}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <Download className="h-3.5 w-3.5" /> Export CSV
                    </button>
                  )}
                </div>
                <IssueTable issues={report.validationErrors} emptyText="No validation failures." />
              </div>

              {report.conflicts.length > 0 && (
                <div className="mb-5">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Duplicate provider identities ({report.conflicts.length})
                  </div>
                  <DuplicateTable issues={report.conflicts} provider={report.provider} />
                </div>
              )}

              {report.skipped.length > 0 && (
                <div className="mb-5">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Skipped records ({report.skipped.length})
                  </div>
                  <IssueTable issues={report.skipped} emptyText="" />
                </div>
              )}

              {report.progress && (
                <Section title="Sync progress">
                  <Row label="Current Entity" value={report.progress.currentEntity ?? "—"} />
                  <Row label="Current Page" value={report.progress.currentPage} />
                  <Row label="Records Processed" value={report.progress.recordsFetched} />
                  <Row label="Status" value={report.progress.status} />
                </Section>
              )}

              {report.syncErrors.length > 0 && (
                <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-rose-700">
                  {report.syncErrors.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
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
            Run again
          </button>
        </div>
      </div>
    </div>
  );
}
