import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plug, Plus, Pencil, Zap, Power, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { IntegrationWizard } from "@/components/admin/integration-wizard";

export const Route = createFileRoute("/admin/integrations")({
  head: () => ({
    meta: [
      { title: "API Integrations — Getyourcodes Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: IntegrationsPage,
});

type DemoCard = {
  provider: string;
  name: string;
  status: "Coming Soon" | "Demo";
  connection: "Not connected" | "Sandbox";
  lastTested: string;
  created: string;
};

const DEMO: DemoCard[] = [
  { provider: "Awin", name: "Awin Publisher Feed", status: "Coming Soon", connection: "Not connected", lastTested: "—", created: "—" },
  { provider: "CJ Affiliate", name: "Commission Junction Deals", status: "Coming Soon", connection: "Not connected", lastTested: "—", created: "—" },
  { provider: "Impact.com", name: "Impact Coupon Sync", status: "Demo", connection: "Sandbox", lastTested: "—", created: "—" },
];

function IntegrationsPage() {
  const [open, setOpen] = useState(false);
  const hasIntegrations = false; // UI only

  return (
    <div>
      <PageHeader
        title="API Integrations"
        action={
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900"
          >
            <Plus className="h-4 w-4" /> Add Integration
          </button>
        }
      />
      <p className="-mt-3 mb-6 text-sm text-slate-500">
        Manage external API connections and affiliate network integrations.
      </p>

      {!hasIntegrations && (
        <div className="mb-8 flex flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Plug className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-semibold text-slate-800">No integrations configured</h3>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            Connect affiliate networks and external services to automate coupon, store, and deal imports.
          </p>
          <button
            onClick={() => setOpen(true)}
            className="mt-5 inline-flex items-center gap-2 rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" /> Add Your First Integration
          </button>
        </div>
      )}

      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">Preview</h2>
          <p className="text-xs text-slate-400">Sample layout for upcoming integrations.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {DEMO.map((c) => (
          <DemoCardView key={c.name} card={c} />
        ))}
      </div>

      {open && <IntegrationWizard onClose={() => setOpen(false)} />}
    </div>
  );
}

function DemoCardView({ card }: { card: DemoCard }) {
  return (
    <div className="relative flex flex-col rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <span className="absolute right-3 top-3 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {card.status}
      </span>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-100 text-slate-500">
          <Plug className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium uppercase tracking-wider text-slate-500">{card.provider}</div>
          <div className="truncate text-sm font-semibold text-slate-800">{card.name}</div>
        </div>
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-y-2 text-xs">
        <dt className="text-slate-500">Connection</dt>
        <dd className="text-right font-medium text-slate-700">{card.connection}</dd>
        <dt className="text-slate-500">Last Tested</dt>
        <dd className="text-right font-medium text-slate-700">{card.lastTested}</dd>
        <dt className="text-slate-500">Created</dt>
        <dd className="text-right font-medium text-slate-700">{card.created}</dd>
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <DisabledBtn icon={<Pencil className="h-3.5 w-3.5" />}>Edit</DisabledBtn>
        <DisabledBtn icon={<Zap className="h-3.5 w-3.5" />}>Test</DisabledBtn>
        <DisabledBtn icon={<Power className="h-3.5 w-3.5" />}>Enable</DisabledBtn>
        <DisabledBtn icon={<Trash2 className="h-3.5 w-3.5" />} tone="danger">Delete</DisabledBtn>
      </div>
    </div>
  );
}

function DisabledBtn({ icon, children, tone }: { icon: React.ReactNode; children: React.ReactNode; tone?: "danger" }) {
  return (
    <button
      disabled
      aria-disabled="true"
      title="Available in the next phase"
      className={`inline-flex cursor-not-allowed items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${
        tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-400"
          : "border-slate-200 bg-slate-50 text-slate-400"
      }`}
    >
      {icon} {children}
    </button>
  );
}

function PlaceholderModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="integration-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h3 id="integration-modal-title" className="text-lg font-semibold text-slate-800">
            Add Integration
          </h3>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-600">
          Integration setup will be available in the next implementation phase.
        </div>
        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
