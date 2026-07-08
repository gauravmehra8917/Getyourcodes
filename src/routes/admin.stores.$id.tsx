import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { Field, TextInput, TextArea, SelectInput, FieldSet } from "@/components/admin/form-fields";
import { SeoSettings, emptySeo, fromRow, toPayload, autofillSeo, type SeoValues } from "@/components/admin/seo-settings";
import { uploadStoreLogo } from "@/lib/admin.functions";


export const Route = createFileRoute("/admin/stores/$id")({
  component: () => <StoreForm mode="edit" />,
});

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export function StoreForm({ mode }: { mode: "new" | "edit" }) {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { id?: string };
  const id = mode === "edit" ? params.id : undefined;

  const { data: categories = [] } = useQuery({
    queryKey: ["admin-cats-options"],
    queryFn: async () => {
      const { data } = await sb.from("categories").select("id, name").order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
    logo_url: "",
    affiliate_url: "",
    featured: false,
    category_id: "" as string,
  });
  const [seo, setSeo] = useState<SeoValues>(emptySeo);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    sb.from("stores").select("*").eq("id", id).maybeSingle().then(({ data }: { data: Record<string, unknown> | null }) => {
      if (data) {
        setForm({
          name: (data.name as string) ?? "",
          slug: (data.slug as string) ?? "",
          description: (data.description as string) ?? "",
          logo_url: (data.logo_url as string) ?? "",
          affiliate_url: (data.affiliate_url as string) ?? "",
          featured: Boolean(data.featured),
          category_id: (data.category_id as string) ?? "",
        });
        setSeo(fromRow(data as Record<string, string | null>));
      }
    });
  }, [id, mode]);


  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const baseSlug = form.slug || slugify(form.name) || `logo-${Date.now()}`;
      const path = `${baseSlug}-${Date.now()}.${ext}`.toLowerCase();
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const res = await uploadStoreLogo({ data: { path, contentType: file.type || "image/png", base64 } });
      setForm((f) => ({ ...f, logo_url: res.publicUrl }));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name) { setError("Name is required"); return; }
    setBusy(true);
    const slug = form.slug || slugify(form.name);
    const seoFilled = autofillSeo(seo, { name: form.name, description: form.description, slug, pathPrefix: "" });
    const payload = {
      ...form,
      slug,
      description: form.description || null,
      logo_url: form.logo_url || null,
      affiliate_url: form.affiliate_url || null,
      category_id: form.category_id || null,
      ...toPayload(seoFilled),
    };

    const { error: err } = mode === "edit" && id
      ? await sb.from("stores").update(payload).eq("id", id)
      : await sb.from("stores").insert(payload);
    setBusy(false);
    if (err) { setError(err.message); return; }
    navigate({ to: "/admin/stores" });
  };

  return (
    <div>
      <PageHeader title={mode === "edit" ? "Edit Store" : "Add Store"} />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6 rounded-md border border-slate-200 bg-white p-6 shadow-sm">
          <FieldSet title="General">
            <Field label="Name" required>
              <TextInput
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || slugify(e.target.value) })}
                required
              />
            </Field>
            <Field label="Slug">
              <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} placeholder="auto-generated" />
            </Field>
            <Field label="Description">
              <TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Affiliate URL">
              <TextInput value={form.affiliate_url} onChange={(e) => setForm({ ...form, affiliate_url: e.target.value })} placeholder="https://" />
            </Field>
            <Field label="Category">
              <SelectInput value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">— None —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectInput>
            </Field>
          </FieldSet>
        </div>

          <SeoSettings
            value={seo}
            onChange={setSeo}
            previewFallback={{
              title: form.name,
              description: form.description,
              url: `${typeof window !== "undefined" ? window.location.origin : ""}/${form.slug || slugify(form.name)}`,
            }}
          />
        </div>

        <aside className="space-y-6">
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">

            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-600">Logo</h3>
            <div className="flex items-center gap-3">
              {form.logo_url ? (
                <img src={form.logo_url} alt="Logo preview" className="h-16 w-16 rounded border border-slate-200 object-contain p-1" />
              ) : (
                <div className="h-16 w-16 rounded border border-dashed border-slate-300 bg-slate-50" />
              )}
              <label className="cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                {uploading ? "Uploading…" : "Choose file"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </label>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            {error && <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-600">Publish</h3>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} className="h-4 w-4" />
              Featured store
            </label>
            <div className="mt-5 flex items-center gap-2">
              <button type="submit" disabled={busy} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                {busy ? "Saving…" : mode === "edit" ? "Update" : "Save"}
              </button>
              <button type="button" onClick={() => navigate({ to: "/admin/stores" })} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
