import * as React from "react";
import {
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Download,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
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


function PublishingSummaryPanel({ summary }: { summary: NonNullable<SyncRunReport["publishing"]> }) {
  const total = summary.couponsFetched + summary.dealsFetched;
  const published = summary.couponsPublished + summary.dealsPublished;
  const held = summary.couponsHeld + summary.dealsHeld;
  return (
    <Section title={`Publishing policy — ${summary.policyName}${summary.applied ? "" : " (disabled)"}`}>
      <Row label="Offers Evaluated" value={total} />
      <Row label="Published" value={<span className="font-semibold text-emerald-700">{published}</span>} />
      <Row label="Held Back" value={<span className="font-semibold text-amber-700">{held}</span>} />
      <Row label="Coupons (published / held)" value={`${summary.couponsPublished} / ${summary.couponsHeld}`} />
      <Row label="Deals (published / held)" value={`${summary.dealsPublished} / ${summary.dealsHeld}`} />
      <Row label="Stores Covered" value={summary.storesCovered} />
      <Row label="Avg Offers per Store" value={`${summary.averageCouponsPerStore} coupons · ${summary.averageDealsPerStore} deals`} />
      <Row label="Coverage" value={`${summary.coveragePercent}%`} />
      {summary.holdReasons.length > 0 && (
        <Row
          label="Hold Reasons"
          value={
            <span className="text-slate-700">
              {summary.holdReasons.slice(0, 5).map((r) => `${r.reason} (${r.count})`).join("; ")}
            </span>
          }
        />
      )}
      {summary.distribution.length > 0 && (
        <div className="mt-2 max-h-48 overflow-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-2 py-1">Store</th>
                <th className="px-2 py-1">Coupons</th>
                <th className="px-2 py-1">Deals</th>
                <th className="px-2 py-1">Held</th>
              </tr>
            </thead>
            <tbody>
              {summary.distribution.map((d) => (
                <tr key={d.storeKey} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-slate-800">{d.storeName}</td>
                  <td className="px-2 py-1">{d.couponsPublished}</td>
                  <td className="px-2 py-1">{d.dealsPublished}</td>
                  <td className="px-2 py-1 text-amber-700">{d.couponsHeld + d.dealsHeld}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function LifecyclePanel({ summary, rows }: {
  summary: NonNullable<SyncRunReport["lifecycle"]>;
  rows: SyncRunReport["lifecycleDiagnostics"];
}) {
  return (
    <>
      <Section title="Store lifecycle">
        <Row label="Stores fetched" value={summary.storesFetched} />
        <Row label="Stores evaluated" value={summary.storesEvaluated} />
        <Row label="Stores qualified" value={summary.storesQualified} />
        <Row label="Stores held" value={summary.storesHeld} />
        <Row label="Stores to create" value={summary.storesToCreate} />
        <Row label="Stores to update" value={summary.storesToUpdate} />
        <Row label="Stores to lifecycle-hide" value={summary.storesToLifecycleHide} />
        <Row label="Stores to lifecycle-republish" value={summary.storesToLifecycleRepublish} />
      </Section>

      {rows.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Store lifecycle diagnostics</div>
          <div className="max-h-80 overflow-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold">Store</th>
                  <th className="px-3 py-2 font-semibold">Provider identity</th>
                  <th className="px-3 py-2 font-semibold">Eligible coupons</th>
                  <th className="px-3 py-2 font-semibold">Eligible deals</th>
                  <th className="px-3 py-2 font-semibold">Selected coupons</th>
                  <th className="px-3 py-2 font-semibold">Selected deals</th>
                  <th className="px-3 py-2 font-semibold">Qualified</th>
                  <th className="px-3 py-2 font-semibold">Lifecycle action</th>
                  <th className="px-3 py-2 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.providerEntityId} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-800">{row.store}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{row.providerEntityId}</td>
                    <td className="px-3 py-2">{row.eligibleCoupons}</td>
                    <td className="px-3 py-2">{row.eligibleDeals}</td>
                    <td className="px-3 py-2">{row.selectedCoupons}</td>
                    <td className="px-3 py-2">{row.selectedDeals}</td>
                    <td className={`px-3 py-2 ${row.qualified ? "text-emerald-700" : "text-amber-700"}`}>{row.qualified ? "Yes" : "No"}</td>
                    <td className="px-3 py-2 text-slate-700">{row.action}</td>
                    <td className="px-3 py-2 text-slate-600">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function IdentityDiagnosticsPanel({ diagnostics }: {
  diagnostics: NonNullable<SyncRunReport["identityDiagnostics"]>;
}) {
  return (
    <>
      <Section title="Identity diagnostics (temporary preview)">
        <Row label="Normalized coupons" value={diagnostics.totalNormalizedCoupons} />
        <Row label="Normalized deals" value={diagnostics.totalNormalizedDeals} />
        <Row label="Unique provider advertiser IDs" value={diagnostics.uniqueProviderAdvertiserIds} />
        <Row label="Unique provider store IDs" value={diagnostics.uniqueProviderStoreIds} />
        <Row label="Unique provider campaign IDs" value={diagnostics.uniqueProviderCampaignIds} />
        <Row label="Unique effective store keys" value={diagnostics.uniqueEffectiveStoreKeys} />
        <Row label="Offers resolving to **unassigned**" value={diagnostics.offersResolvingToUnassigned} />
      </Section>

      <div className="mb-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Top effective store keys</div>
        <div className="max-h-80 overflow-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-semibold">Effective store key</th>
                <th className="px-3 py-2 font-semibold">Coupons</th>
                <th className="px-3 py-2 font-semibold">Deals</th>
                <th className="px-3 py-2 font-semibold">Merchant / store names</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.topStoreKeys.map((row) => (
                <tr key={row.effectiveStoreKey} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-slate-700">{row.effectiveStoreKey}</td>
                  <td className="px-3 py-2">{row.coupons}</td>
                  <td className="px-3 py-2">{row.deals}</td>
                  <td className="px-3 py-2 text-slate-600">{row.merchantNames.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Sample normalized offers</div>
        <div className="max-h-80 overflow-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-semibold">Offer title</th>
                <th className="px-3 py-2 font-semibold">Merchant / store</th>
                <th className="px-3 py-2 font-semibold">Provider entity ID</th>
                <th className="px-3 py-2 font-semibold">Advertiser ID</th>
                <th className="px-3 py-2 font-semibold">Store ID</th>
                <th className="px-3 py-2 font-semibold">Campaign ID</th>
                <th className="px-3 py-2 font-semibold">Effective store key</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.sampleOffers.map((row) => (
                <tr key={`${row.providerEntityId}-${row.effectiveStoreKey}`} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-800">{row.offerTitle}</td>
                  <td className="px-3 py-2 text-slate-600">{row.merchantName ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-slate-700">{row.providerEntityId}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{row.providerAdvertiserId ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{row.providerStoreId ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{row.providerCampaignId ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-slate-700">{row.effectiveStoreKey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}


/* ------------------------------------------------------------------ *
 * V2 read-only preview operator experience (frontend-only).
 * Every value below is derived from the EXISTING report payload.
 * Nothing here writes, persists, or calls an additional endpoint.
 * ------------------------------------------------------------------ */

const NOT_AVAILABLE = "Not available";

function Metric({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string | null | undefined;
  tone?: "ok" | "warn" | "bad";
  hint?: string;
}) {
  const missing = value === null || value === undefined || value === "";
  const toneClass =
    tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-rose-700" : "text-slate-800";
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${missing ? "text-slate-400" : toneClass}`}>
        {missing ? NOT_AVAILABLE : value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function MetricGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>
    </div>
  );
}

function Collapsible({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="mb-4 rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          {title}
          {typeof count === "number" ? ` (${count})` : ""}
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
      </button>
      {open && <div className="border-t border-slate-100 px-4 py-3">{children}</div>}
    </div>
  );
}

type PreviewState =
  | "loading"
  | "auth_failure"
  | "network_failure"
  | "provider_failure"
  | "validation_failure"
  | "completed_with_diagnostics"
  | "completed"
  | "idle";

function classifyError(message: string): PreviewState {
  const m = message.toLowerCase();
  if (m.includes("unauthor") || m.includes("unauthenticated") || m.includes("forbidden") || m.includes("401") || m.includes("403"))
    return "auth_failure";
  if (m.includes("network") || m.includes("fetch failed") || m.includes("timeout") || m.includes("econn"))
    return "network_failure";
  if (m.includes("validation") || m.includes("invalid")) return "validation_failure";
  return "provider_failure";
}

const STATE_TEXT: Record<PreviewState, { title: string; body: string; tone: "ok" | "warn" | "bad" | "idle" }> = {
  idle: { title: "Idle", body: "No preview has been run yet.", tone: "idle" },
  loading: { title: "Running read-only preview…", body: "Fetching provider data. Nothing is written.", tone: "idle" },
  completed: { title: "Preview completed", body: "Read-only preview finished with no reported problems.", tone: "ok" },
  completed_with_diagnostics: {
    title: "Preview completed with diagnostics",
    body: "The preview finished, but returned warnings, validation failures, or held records. Review the diagnostics below.",
    tone: "warn",
  },
  auth_failure: {
    title: "Authentication / authorization failure",
    body: "The preview request was rejected before any provider call. Sign in again as an administrator and retry.",
    tone: "bad",
  },
  provider_failure: {
    title: "Provider failure",
    body: "The affiliate provider rejected or failed the request. No data was written.",
    tone: "bad",
  },
  validation_failure: {
    title: "Validation failure",
    body: "The provider responded, but the payload failed validation. No data was written.",
    tone: "bad",
  },
  network_failure: {
    title: "Network failure",
    body: "The preview request could not complete. No data was written.",
    tone: "bad",
  },
};

function StatusBanner({ state, detail }: { state: PreviewState; detail?: string | null }) {
  const meta = STATE_TEXT[state];
  const cls =
    meta.tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : meta.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : meta.tone === "bad"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-slate-200 bg-white text-slate-700";
  const Icon = meta.tone === "ok" ? CheckCircle2 : meta.tone === "bad" ? AlertTriangle : meta.tone === "warn" ? AlertTriangle : Loader2;
  return (
    <div className={`mb-4 flex items-start gap-2 rounded border px-4 py-3 text-sm ${cls}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${state === "loading" ? "animate-spin" : ""}`} />
      <div>
        <div className="font-semibold">{meta.title}</div>
        <div className="mt-0.5 text-[13px] opacity-90">{meta.body}</div>
        {detail && <div className="mt-1 break-words font-mono text-[11px] opacity-90">{detail}</div>}
      </div>
    </div>
  );
}

function ReadOnlyNotice() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded border border-sky-200 bg-sky-50 px-4 py-3">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
      <div className="text-sm text-sky-900">
        <div className="font-semibold">Affiliate Sync V2 — Read-only Preview</div>
        <div className="mt-0.5 text-[13px]">
          V2 Preview is read-only. No stores, offers, or import history are changed.
        </div>
      </div>
    </div>
  );
}

function PersistencePanel() {
  return (
    <div className="mb-5 rounded border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">V2 Production Persistence</span>
        <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">Not enabled</span>
      </div>
      <p className="mt-2 text-[13px] text-slate-600">
        V2 Preview is available and read-only. Production persistence will remain disabled until the reviewed database
        migration and write-path verification are completed.
      </p>
    </div>
  );
}

/** Identity safety — derived strictly from values already present in the report. */
function IdentitySafetyPanel({ report }: { report: SyncRunReport }) {
  const d = report.identityDiagnostics;
  const unresolved = d?.offersResolvingToUnassigned ?? null;
  const conflicts = report.conflicts.length;
  const duplicateRecords = report.identity.reduce((n, r) => n + r.duplicateRecords, 0);
  const collapseDetected =
    d != null &&
    d.uniqueEffectiveStoreKeys > 0 &&
    d.uniqueProviderAdvertiserIds > 1 &&
    d.uniqueEffectiveStoreKeys === 1;

  const hasRisk = collapseDetected || (unresolved ?? 0) > 0 || conflicts > 0;
  if (!d && !conflicts) return null;

  return (
    <div
      className={`mb-5 rounded border px-4 py-3 ${
        collapseDetected ? "border-rose-300 bg-rose-50" : hasRisk ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-2">
        {hasRisk ? (
          <AlertTriangle className={`h-4 w-4 ${collapseDetected ? "text-rose-700" : "text-amber-700"}`} />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-700" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Identity safety</span>
      </div>
      {collapseDetected && (
        <p className="mt-2 text-sm font-semibold text-rose-800">
          Identity collapse detected — {d!.uniqueProviderAdvertiserIds} provider advertisers resolved to a single effective
          store key. Do not enable persistence until this is resolved.
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Identity collapse" value={d ? (collapseDetected ? "Detected" : "None") : null} tone={collapseDetected ? "bad" : "ok"} hint="Derived from resolution counts" />
        <Metric label="Unresolved merchants" value={unresolved} tone={(unresolved ?? 0) > 0 ? "warn" : "ok"} hint="Offers resolving to unassigned" />
        <Metric label="Provider identity conflicts" value={conflicts} tone={conflicts > 0 ? "warn" : "ok"} />
        <Metric label="Duplicate records removed" value={duplicateRecords} />
      </div>
    </div>
  );
}

function PreviewSummary({ report }: { report: SyncRunReport }) {
  const o = report.orchestration;
  const d = report.identityDiagnostics;
  const pub = report.publishing;
  const plan = report.planCounts;
  const raw = report.rawPromotionDiagnostics;

  const rawPromotions = raw ? raw.pages.reduce((n, p) => n + p.promotionCount, 0) : null;
  const duplicateProviderIds = raw ? raw.duplicatePromotionProvenance.length : null;
  const uniqueIdentities = report.identity.length
    ? report.identity.reduce((n, r) => n + r.uniqueIdentities, 0)
    : null;
  const duplicateIdentities = report.identity.length
    ? report.identity.reduce((n, r) => n + r.duplicateIdentities, 0)
    : null;

  return (
    <>
      <MetricGroup title="1 · Provider fetch">
        <Metric label="Records fetched" value={o?.recordsFetched} />
        <Metric label="Raw promotions observed" value={rawPromotions} />
        <Metric label="Canonical (normalized)" value={report.progress?.recordsNormalized} />
        <Metric label="Duplicate promotion IDs" value={duplicateProviderIds} tone={(duplicateProviderIds ?? 0) > 0 ? "warn" : undefined} />
        <Metric label="Pages crawled" value={o?.pagesCrawled} />
        <Metric label="API calls used" value={o?.apiCallsUsed} />
        <Metric label="Strategy" value={o?.strategy.replaceAll("_", " ")} />
        <Metric label="Stop reason" value={o?.stopReason ?? null} />
      </MetricGroup>

      <MetricGroup title="2 · Identity">
        <Metric label="Unique identities" value={uniqueIdentities} />
        <Metric label="Duplicate identities" value={duplicateIdentities} />
        <Metric label="Duplicate records removed" value={report.identity.length ? report.identity.reduce((n, r) => n + r.duplicateRecords, 0) : null} />
        <Metric label="New provider identities" value={o?.newProviderIdentitiesDiscovered} />
      </MetricGroup>

      <MetricGroup title="3 · Merchant resolution">
        <Metric label="Distinct advertiser IDs" value={d?.uniqueProviderAdvertiserIds} />
        <Metric label="Distinct provider store keys" value={d?.uniqueEffectiveStoreKeys} />
        <Metric label="Resolved offers" value={d ? d.totalNormalizedCoupons + d.totalNormalizedDeals - d.offersResolvingToUnassigned : null} tone="ok" />
        <Metric label="Unresolved offers" value={d?.offersResolvingToUnassigned} tone={(d?.offersResolvingToUnassigned ?? 0) > 0 ? "warn" : undefined} />
      </MetricGroup>

      <MetricGroup title="4 · Offer normalization">
        <Metric label="Coupons" value={d?.totalNormalizedCoupons} />
        <Metric label="Deals" value={d?.totalNormalizedDeals} />
        <Metric label="Eligible offers" value={pub ? pub.couponsFetched + pub.dealsFetched : null} />
        <Metric label="Held by policy" value={pub ? pub.couponsHeld + pub.dealsHeld : null} tone={pub && pub.couponsHeld + pub.dealsHeld > 0 ? "warn" : undefined} />
      </MetricGroup>

      <MetricGroup title={`5 · Publishing policy${pub ? ` — ${pub.policyName}${pub.applied ? "" : " (disabled)"}` : ""}`}>
        <Metric label="Selected coupons" value={pub?.couponsPublished} tone="ok" />
        <Metric label="Selected deals" value={pub?.dealsPublished} tone="ok" />
        <Metric label="Total selected" value={pub ? pub.couponsPublished + pub.dealsPublished : null} tone="ok" />
        <Metric label="Qualified stores" value={report.lifecycle?.storesQualified ?? pub?.storesCovered} />
      </MetricGroup>

      <MetricGroup title="6 · Preview plan">
        <Metric label="New store candidates" value={plan?.storesToCreate} />
        <Metric label="Existing stores" value={plan?.storesToUpdate} />
        <Metric label="Offer creates" value={plan ? plan.couponsToCreate + plan.dealsToCreate : null} />
        <Metric label="Existing offers" value={plan ? plan.couponsToUpdate + plan.dealsToUpdate : null} />
        <Metric label="Skipped" value={plan?.skipped} />
        <Metric label="Held" value={pub ? pub.couponsHeld + pub.dealsHeld : null} />
        <Metric label="Unresolved" value={d?.offersResolvingToUnassigned} />
        <Metric label="Duration" value={`${report.durationMs}ms`} />
      </MetricGroup>
    </>
  );
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

              {report.orchestration && (
                <Section title="Import orchestration">
                  <Row label="Strategy" value={report.orchestration.strategy.replaceAll("_", " ")} />
                  <Row label="Pages crawled" value={report.orchestration.pagesCrawled} />
                  <Row label="API calls used" value={report.orchestration.apiCallsUsed} />
                  <Row label="Records fetched" value={report.orchestration.recordsFetched} />
                  <Row label="New provider identities" value={report.orchestration.newProviderIdentitiesDiscovered} />
                  <Row label="Existing provider identities" value={report.orchestration.existingProviderIdentitiesEncountered} />
                  <Row label="Stop reason" value={report.orchestration.stopReason ?? "—"} />
                  <Row label="Execution duration" value={`${report.durationMs}ms`} />
                </Section>
              )}

              <IdentitySummaryTable rows={report.identity} />

              {report.preview && report.identityDiagnostics && (
                <IdentityDiagnosticsPanel diagnostics={report.identityDiagnostics} />
              )}

              {report.publishing && <PublishingSummaryPanel summary={report.publishing} />}

              {report.lifecycle && <LifecyclePanel summary={report.lifecycle} rows={report.lifecycleDiagnostics} />}

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

              {report.coverage && (
                <Section title="Content coverage">
                  <Row
                    label="Stores with hosted logo"
                    value={`${report.coverage.storesWithHostedLogo} / ${report.coverage.stores}`}
                  />
                  <Row
                    label="Offers with description"
                    value={`${report.coverage.offersWithDescription} / ${report.coverage.offers}`}
                  />
                  <Row
                    label="Offers with terms"
                    value={`${report.coverage.offersWithTerms} / ${report.coverage.offers}`}
                  />
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
