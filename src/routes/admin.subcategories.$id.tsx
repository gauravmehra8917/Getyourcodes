import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sb, type Category } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { Field, TextInput, SelectInput, FieldSet } from "@/components/admin/form-fields";
import { SeoSettings, emptySeo, fromRow, toPayload, autofillSeo, type SeoValues } from "@/components/admin/seo-settings";


export const Route = createFileRoute("/admin/subcategories/$id")({
  component: () => <SubcategoryForm mode="edit" />,
});

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export function SubcategoryForm({ mode }: { mode: "new" | "edit" }) {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { id?: string };
  const id = mode === "edit" ? params.id : undefined;

  const { data: cats = [] } = useQuery({
    queryKey: ["admin-categories-all"],
    queryFn: async () => {
      const { data } = await sb.from("categories").select("id,name,slug").order("name");
      return (data ?? []) as Category[];
    },
  });

  const [form, setForm] = useState({ name: "", slug: "", category_id: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    sb.from("subcategories").select("*").eq("id", id).maybeSingle().then(({ data }: { data: { name: string; slug: string; category_id: string } | null }) => {
      if (data) setForm({ name: data.name ?? "", slug: data.slug ?? "", category_id: data.category_id ?? "" });
    });
  }, [id, mode]);

  useEffect(() => {
    if (mode === "new" && !form.category_id && cats.length) {
      setForm((f) => ({ ...f, category_id: cats[0].id }));
    }
  }, [cats, mode, form.category_id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name) { setError("Name is required"); return; }
    if (!form.category_id) { setError("Parent category is required"); return; }
    setBusy(true);
    const payload = { name: form.name, slug: form.slug || slugify(form.name), category_id: form.category_id };
    const { error: err } = mode === "edit" && id
      ? await sb.from("subcategories").update(payload).eq("id", id)
      : await sb.from("subcategories").insert(payload);
    setBusy(false);
    if (err) { setError(err.message); return; }
    navigate({ to: "/admin/subcategories" });
  };

  return (
    <div>
      <PageHeader title={mode === "edit" ? "Edit Sub Category" : "Add Sub Category"} />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6 rounded-md border border-slate-200 bg-white p-6 shadow-sm">
          <FieldSet title="General">
            <Field label="Parent Category" required>
              <SelectInput value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} required>
                <option value="">— Select —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectInput>
            </Field>
            <Field label="Name" required>
              <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || slugify(e.target.value) })} required />
            </Field>
            <Field label="Slug">
              <TextInput value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} placeholder="auto-generated" />
            </Field>
          </FieldSet>
        </div>
        <aside className="space-y-6">
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            {error && <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-600">Publish</h3>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={busy} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                {busy ? "Saving…" : mode === "edit" ? "Update" : "Save"}
              </button>
              <button type="button" onClick={() => navigate({ to: "/admin/subcategories" })} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
