import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { Field, TextInput, TextArea, SelectInput, FieldSet } from "@/components/admin/form-fields";
import { SeoSettings, emptySeo, fromRow, toPayload, type SeoValues } from "@/components/admin/seo-settings";
import { couponCanonical, couponSeoDescription, couponSeoTitle } from "@/lib/presentation/seo-templates";



export const Route = createFileRoute("/admin/coupons/$id")({
  component: () => <CouponForm mode="edit" />,
});

export function CouponForm({ mode }: { mode: "new" | "edit" }) {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { id?: string };
  const id = mode === "edit" ? params.id : undefined;

  const { data: stores = [] } = useQuery({
    queryKey: ["admin-stores-options"],
    queryFn: async () => {
      const { data } = await sb.from("stores").select("id, name, slug").order("name");
      return (data ?? []) as { id: string; name: string; slug: string | null }[];
    },
  });


  const [form, setForm] = useState({
    store_id: "",
    title: "",
    description: "",
    coupon_code: "",
    coupon_type: "deal" as "deal" | "code",
    affiliate_url: "",
    expiry_date: "",
    status: "active" as "active" | "expired" | "draft",
    terms: "",
    featured_in_banner: false,
  });
  const [seo, setSeo] = useState<SeoValues>(emptySeo);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    sb.from("coupons").select("*").eq("id", id).maybeSingle().then(({ data }: { data: Record<string, unknown> | null }) => {
      if (data) {
        setForm({
          store_id: (data.store_id as string) ?? "",
          title: (data.title as string) ?? "",
          description: (data.description as string) ?? "",
          coupon_code: (data.coupon_code as string) ?? "",
          coupon_type: ((data.coupon_type as "deal" | "code") ?? "deal"),
          affiliate_url: (data.affiliate_url as string) ?? "",
          expiry_date: data.expiry_date ? String(data.expiry_date).slice(0, 10) : "",
          status: ((data.status as typeof form.status) ?? "active"),
          terms: (data.terms as string) ?? "",
          featured_in_banner: Boolean(data.featured_in_banner),
        });
        setSeo(fromRow(data as Record<string, string | null>));
      }
    });
  }, [id, mode]);


  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.store_id || !form.title) { setError("Store and title are required"); return; }
    setBusy(true);
    // Deterministic SEO for both CODE and DEAL offers — only empty fields are
    // filled, so administrator edits are preserved.
    const store = stores.find((s) => s.id === form.store_id);
    const storeName = store?.name ?? "this store";
    const seoFilled: SeoValues = {
      ...seo,
      seo_title: seo.seo_title || couponSeoTitle(form.title, storeName),
      seo_description: seo.seo_description || couponSeoDescription(form.title, storeName),
      seo_canonical_url:
        seo.seo_canonical_url || (store?.slug ? couponCanonical(store.slug, form.title) : ""),
    };

    const payload = {
      ...form,
      expiry_date: form.expiry_date || null,
      coupon_code: form.coupon_code || null,
      affiliate_url: form.affiliate_url || null,
      description: form.description || null,
      terms: form.terms || null,
      ...toPayload(seoFilled),
    };

    const { error: err } = mode === "edit" && id
      ? await sb.from("coupons").update(payload).eq("id", id)
      : await sb.from("coupons").insert(payload);
    setBusy(false);
    if (err) { setError(err.message); return; }
    navigate({ to: "/admin/coupons" });
  };

  return (
    <div>
      <PageHeader title={mode === "edit" ? "Edit Coupon" : "Add Coupon"} />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6 rounded-md border border-slate-200 bg-white p-6 shadow-sm">
          <FieldSet title="General">
            <Field label="Store" required>
              <SelectInput value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })} required>
                <option value="">— Select Store —</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SelectInput>
            </Field>
            <Field label="Title" required>
              <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
            <Field label="Description">
              <TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </FieldSet>

          <FieldSet title="Coupon Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" required>
                <SelectInput value={form.coupon_type} onChange={(e) => setForm({ ...form, coupon_type: e.target.value as "deal" | "code" })}>
                  <option value="deal">Deal</option>
                  <option value="code">Code</option>
                </SelectInput>
              </Field>
              <Field label="Coupon Code">
                <TextInput value={form.coupon_code} onChange={(e) => setForm({ ...form, coupon_code: e.target.value })} placeholder="SAVE20" />
              </Field>
              <Field label="Affiliate URL">
                <TextInput value={form.affiliate_url} onChange={(e) => setForm({ ...form, affiliate_url: e.target.value })} placeholder="https://" />
              </Field>
              <Field label="Expiry Date">
                <TextInput type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
              </Field>
            </div>
            <Field label="Terms & Conditions">
              <TextArea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
            </Field>
          </FieldSet>
          <SeoSettings
            value={seo}
            onChange={setSeo}
            previewFallback={{
              title: form.title,
              description: form.description,
              url: `${typeof window !== "undefined" ? window.location.origin : ""}/coupons/${id ?? ""}`,
            }}
          />
        </div>


        <aside className="space-y-6">
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            {error && <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-600">Publish</h3>
            <Field label="Status">
              <SelectInput value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="expired">Expired</option>
              </SelectInput>
            </Field>
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.featured_in_banner}
                onChange={(e) => setForm({ ...form, featured_in_banner: e.target.checked })}
                className="h-4 w-4"
              />
              Feature in global deals banner
            </label>
            <div className="mt-5 flex items-center gap-2">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? "Saving…" : mode === "edit" ? "Update" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => navigate({ to: "/admin/coupons" })}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
