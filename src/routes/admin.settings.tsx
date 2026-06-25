import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/admin/page-header";
import { Field, TextInput, TextArea, FieldSet } from "@/components/admin/form-fields";

export const Route = createFileRoute("/admin/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" />
      <form
        onSubmit={(e) => { e.preventDefault(); alert("Settings UI is a placeholder — wire to a site_settings table when ready."); }}
        className="grid gap-6 lg:grid-cols-[1fr_320px]"
      >
        <div className="space-y-6 rounded-md border border-slate-200 bg-white p-6 shadow-sm">
          <FieldSet title="Site">
            <Field label="Site Name"><TextInput defaultValue="SaveHub" /></Field>
            <Field label="Tagline"><TextInput defaultValue="Best deals & coupons across the globe" /></Field>
            <Field label="Contact Email"><TextInput defaultValue="partner@pixorads.com" /></Field>
            <Field label="Office Address"><TextArea defaultValue="68 Circular Road, #02-01, Singapore 049422" /></Field>
          </FieldSet>
          <FieldSet title="SEO Defaults">
            <Field label="Meta Title"><TextInput defaultValue="SaveHub — Coupons & Deals" /></Field>
            <Field label="Meta Description"><TextArea defaultValue="Find verified coupons, promo codes and the best deals from your favourite brands." /></Field>
            <Field label="Meta Keywords"><TextInput defaultValue="coupons, deals, promo codes" /></Field>
          </FieldSet>
        </div>
        <aside>
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-600">Save</h3>
            <button type="submit" className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
              Update Settings
            </button>
            <p className="mt-3 text-xs text-slate-500">
              Persisted settings will be wired to a dedicated table on request.
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}
