import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, TextArea, FieldSet } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X, Star, ArrowUp, ArrowDown, Scale } from "lucide-react";
import {
  listPublishingPolicies,
  savePublishingPolicy,
  deletePublishingPolicy,
  setDefaultPublishingPolicy,
  type PublishingPolicyRow,
} from "@/lib/publishing-policies.functions";
import { RANKING_KEYS, RANKING_LABELS, type RankingKey } from "@/lib/publishing-policy";

export const Route = createFileRoute("/admin/publishing-policies")({
  head: () => ({
    meta: [
      { title: "Publishing Policies — Getyourcodes Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublishingPoliciesPage,
});

type Form = {
  name: string;
  description: string;
  enabled: boolean;
  is_default: boolean;
  min_coupons_per_store: number;
  max_coupons_per_store: number;
  min_deals_per_store: number;
  max_deals_per_store: number;
  ranking_priority: RankingKey[];
  fair_distribution: boolean;
  rotation: boolean;
  publish_only_active: boolean;
  skip_expired: boolean;
  skip_duplicate_identities: boolean;
  respect_manual_disable: boolean;
  never_overwrite_admin_edits: boolean;
  preview_before_import: boolean;
};

const emptyForm: Form = {
  name: "",
  description: "",
  enabled: true,
  is_default: false,
  min_coupons_per_store: 0,
  max_coupons_per_store: 6,
  min_deals_per_store: 0,
  max_deals_per_store: 4,
  ranking_priority: [...RANKING_KEYS],
  fair_distribution: true,
  rotation: false,
  publish_only_active: true,
  skip_expired: true,
  skip_duplicate_identities: true,
  respect_manual_disable: true,
  never_overwrite_admin_edits: true,
  preview_before_import: true,
};

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded border border-slate-200 bg-white p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-emerald-600"
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Field label={label}>
        <TextInput
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        />
      </Field>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function PublishingPoliciesPage() {
  const qc = useQueryClient();
  const load = useServerFn(listPublishingPolicies);
  const save = useServerFn(savePublishingPolicy);
  const remove = useServerFn(deletePublishingPolicy);
  const makeDefault = useServerFn(setDefaultPublishingPolicy);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-publishing-policies"],
    queryFn: () => load(),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PublishingPolicyRow | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-publishing-policies"] });
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const startNew = () => {
    setEditing(null);
    setError(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const startEdit = (r: PublishingPolicyRow) => {
    setEditing(r);
    setError(null);
    const ranking = (r.ranking_priority ?? []).filter((k): k is RankingKey =>
      (RANKING_KEYS as readonly string[]).includes(k),
    );
    setForm({
      name: r.name,
      description: r.description ?? "",
      enabled: r.enabled,
      is_default: r.is_default,
      min_coupons_per_store: r.min_coupons_per_store,
      max_coupons_per_store: r.max_coupons_per_store,
      min_deals_per_store: r.min_deals_per_store,
      max_deals_per_store: r.max_deals_per_store,
      ranking_priority: [...ranking, ...RANKING_KEYS.filter((k) => !ranking.includes(k))],
      fair_distribution: r.fair_distribution,
      rotation: r.rotation,
      publish_only_active: r.publish_only_active,
      skip_expired: r.skip_expired,
      skip_duplicate_identities: r.skip_duplicate_identities,
      respect_manual_disable: r.respect_manual_disable,
      never_overwrite_admin_edits: r.never_overwrite_admin_edits,
      preview_before_import: r.preview_before_import,
    });
    setOpen(true);
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...form.ranking_priority];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const a = next[index]!;
    next[index] = next[target]!;
    next[target] = a;
    set("ranking_priority", next);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await save({ data: { id: editing?.id ?? null, policy: { ...form, name: form.name.trim() } } });
      setOpen(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (r: PublishingPolicyRow) => {
    if (!window.confirm(`Delete publishing policy "${r.name}"?`)) return;
    try {
      await remove({ data: { id: r.id } });
      refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const columns: Column<PublishingPolicyRow>[] = [
    {
      key: "name",
      header: "Policy",
      searchValue: (r) => `${r.name} ${r.description ?? ""}`,
      render: (r) => (
        <div>
          <div className="flex items-center gap-2 font-medium text-slate-800">
            {r.name}
            {r.is_default && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                Default
              </span>
            )}
          </div>
          {r.description && <div className="mt-0.5 text-xs text-slate-500">{r.description}</div>}
        </div>
      ),
    },
    {
      key: "limits",
      header: "Limits per store",
      render: (r) => (
        <div className="text-xs text-slate-600">
          <div>
            Coupons: {r.min_coupons_per_store} – {r.max_coupons_per_store || "∞"}
          </div>
          <div>
            Deals: {r.min_deals_per_store} – {r.max_deals_per_store || "∞"}
          </div>
        </div>
      ),
    },
    {
      key: "ranking",
      header: "Ranking",
      render: (r) => (
        <div className="text-xs text-slate-600">
          {(r.ranking_priority ?? [])
            .map((k) => RANKING_LABELS[k as RankingKey] ?? k)
            .join(" → ")}
        </div>
      ),
    },
    {
      key: "distribution",
      header: "Distribution",
      render: (r) => (
        <div className="flex flex-wrap gap-1 text-[10px] font-semibold uppercase">
          {r.fair_distribution && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-700">Fair</span>}
          {r.rotation && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-700">Rotation</span>}
          {!r.fair_distribution && !r.rotation && <span className="text-slate-400">—</span>}
        </div>
      ),
    },
    {
      key: "enabled",
      header: "Status",
      render: (r) => (
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
            r.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {r.enabled ? "Enabled" : "Disabled"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <div className="flex justify-end gap-1">
          {!r.is_default && (
            <button
              type="button"
              onClick={async () => {
                await makeDefault({ data: { id: r.id } });
                refresh();
              }}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-amber-600"
              aria-label={`Make ${r.name} the default policy`}
              title="Make default"
            >
              <Star className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => startEdit(r)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label={`Edit ${r.name}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(r)}
            className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
            aria-label={`Delete ${r.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Publishing Policies"
        action={
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center gap-2 rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            <Plus className="h-4 w-4" /> New Policy
          </button>
        }
      />

      <p className="mb-4 flex items-start gap-2 rounded border border-slate-200 bg-white p-3 text-sm text-slate-600">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        Policies run after normalization, enrichment and deduplication, and before anything is written to the
        catalog. They cap how many offers each merchant can publish, rank the best offers first, spread coverage
        fairly across merchants, and never overwrite manual admin edits.
      </p>

      {isLoading ? (
        <div className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading policies…</div>
      ) : (
        <DataTable rows={rows} columns={columns} emptyText="No publishing policies yet." />
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
          <div className="my-8 w-full max-w-3xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="font-display text-lg font-bold text-slate-800">
                {editing ? "Edit Policy" : "New Policy"}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 p-5">
              {error && (
                <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
              )}

              <Field label="Name" required>
                <TextInput value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Description">
                <TextArea value={form.description} onChange={(e) => set("description", e.target.value)} />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="Enabled"
                  hint="Disabled policies are ignored during imports."
                  checked={form.enabled}
                  onChange={(v) => set("enabled", v)}
                />
                <Toggle
                  label="Global default"
                  hint="Used by every integration without its own policy."
                  checked={form.is_default}
                  onChange={(v) => set("is_default", v)}
                />
              </div>

              <FieldSet title="Rules">
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    label="Min coupons per store"
                    hint="Stores with fewer coupons are held back. 0 disables."
                    value={form.min_coupons_per_store}
                    onChange={(v) => set("min_coupons_per_store", v)}
                  />
                  <NumberField
                    label="Max coupons per store"
                    hint="Publish at most this many coupons per merchant. 0 = unlimited."
                    value={form.max_coupons_per_store}
                    onChange={(v) => set("max_coupons_per_store", v)}
                  />
                  <NumberField
                    label="Min deals per store"
                    hint="Stores with fewer deals are held back. 0 disables."
                    value={form.min_deals_per_store}
                    onChange={(v) => set("min_deals_per_store", v)}
                  />
                  <NumberField
                    label="Max deals per store"
                    hint="Publish at most this many deals per merchant. 0 = unlimited."
                    value={form.max_deals_per_store}
                    onChange={(v) => set("max_deals_per_store", v)}
                  />
                </div>
              </FieldSet>

              <FieldSet title="Ranking priority">
                <p className="text-xs text-slate-500">
                  Offers competing for a slot are ranked in this order, top first.
                </p>
                <ul className="space-y-2">
                  {form.ranking_priority.map((key, i) => (
                    <li
                      key={key}
                      className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2"
                    >
                      <span className="text-sm text-slate-700">
                        <span className="mr-2 text-xs font-semibold text-slate-400">{i + 1}</span>
                        {RANKING_LABELS[key]}
                      </span>
                      <span className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                          aria-label={`Move ${RANKING_LABELS[key]} up`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(i, 1)}
                          disabled={i === form.ranking_priority.length - 1}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                          aria-label={`Move ${RANKING_LABELS[key]} down`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </FieldSet>

              <FieldSet title="Distribution">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle
                    label="Fair distribution"
                    hint="Spread published offers evenly across merchants instead of letting one dominate."
                    checked={form.fair_distribution}
                    onChange={(v) => set("fair_distribution", v)}
                  />
                  <Toggle
                    label="Rotation"
                    hint="Rotate which offers get published on each run so more inventory gets exposure."
                    checked={form.rotation}
                    onChange={(v) => set("rotation", v)}
                  />
                </div>
              </FieldSet>

              <FieldSet title="Safety">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle
                    label="Publish only active offers"
                    checked={form.publish_only_active}
                    onChange={(v) => set("publish_only_active", v)}
                  />
                  <Toggle label="Skip expired offers" checked={form.skip_expired} onChange={(v) => set("skip_expired", v)} />
                  <Toggle
                    label="Skip duplicate identities"
                    checked={form.skip_duplicate_identities}
                    onChange={(v) => set("skip_duplicate_identities", v)}
                  />
                  <Toggle
                    label="Respect manually disabled offers"
                    checked={form.respect_manual_disable}
                    onChange={(v) => set("respect_manual_disable", v)}
                  />
                  <Toggle
                    label="Never overwrite admin edits"
                    checked={form.never_overwrite_admin_edits}
                    onChange={(v) => set("never_overwrite_admin_edits", v)}
                  />
                  <Toggle
                    label="Preview before import"
                    hint="Recommend a preview run before committing."
                    checked={form.preview_before_import}
                    onChange={(v) => set("preview_before_import", v)}
                  />
                </div>
              </FieldSet>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save Policy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
