import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { Field, TextInput, TextArea, SelectInput as Select } from "@/components/admin/form-fields";
import { SeoSettings, fromRow, toPayload, autofillSeo, type SeoValues } from "@/components/admin/seo-settings";


type PostRow = {
  id?: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  cover_image: string | null;
  category_id: string | null;
  status: "draft" | "published" | "archived";
  seo_title: string | null;
  seo_description: string | null;
  published_at: string | null;
};

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const blank: PostRow = {
  title: "", slug: "", excerpt: "", body: "", cover_image: "",
  category_id: null, status: "draft", seo_title: "", seo_description: "", published_at: null,
};

export function PostForm({ initial, onSaved }: { initial?: PostRow; onSaved: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PostRow>(initial ?? blank);
  const [saving, setSaving] = useState(false);

  const { data: cats = [] } = useQuery({
    queryKey: ["blog-categories-options"],
    queryFn: async () => {
      const { data } = await sb.from("blog_categories").select("id,name").order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const set = <K extends keyof PostRow>(k: K, v: PostRow[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent | React.MouseEvent, publish?: boolean) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const status = publish ? "published" : form.status;
    const payload = {
      title: form.title,
      slug: form.slug || slugify(form.title),
      excerpt: form.excerpt || null,
      body: form.body,
      cover_image: form.cover_image || null,
      category_id: form.category_id || null,
      status,
      seo_title: form.seo_title || null,
      seo_description: form.seo_description || null,
      published_at: status === "published" ? (form.published_at ?? new Date().toISOString()) : form.published_at,
    };
    const { data: { user } } = await sb.auth.getUser();
    if (initial?.id) await sb.from("posts").update(payload).eq("id", initial.id);
    else await sb.from("posts").insert({ ...payload, author_id: user?.id ?? null });
    qc.invalidateQueries({ queryKey: ["admin-posts"] });
    setSaving(false);
    onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader title={initial ? "Edit Post" : "New Post"} action={
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Save draft</button>
          <button type="button" onClick={(e) => submit(e, true)} disabled={saving} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Publish</button>
        </div>
      } />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2 rounded-md border border-slate-200 bg-white p-5">
          <Field label="Title" required><TextInput value={form.title} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, title: v, slug: f.slug || slugify(v) })); }} required /></Field>
          <Field label="Slug" required><TextInput value={form.slug} onChange={(e) => set("slug", e.target.value)} required /></Field>
          <Field label="Excerpt"><TextArea value={form.excerpt ?? ""} onChange={(e) => set("excerpt", e.target.value)} rows={2} /></Field>
          <Field label="Body (Markdown or HTML)" required>
            <TextArea value={form.body} onChange={(e) => set("body", e.target.value)} rows={14} required />
          </Field>
        </div>
        <div className="space-y-5">
          <div className="rounded-md border border-slate-200 bg-white p-5 space-y-4">
            <Field label="Status">
              <Select value={form.status} onChange={(e) => set("status", e.target.value as PostRow["status"]) }>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
            <Field label="Category">
              <Select value={form.category_id ?? ""} onChange={(e) => set("category_id", e.target.value || null)}>
                <option value="">— None —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Cover image URL"><TextInput value={form.cover_image ?? ""} onChange={(e) => set("cover_image", e.target.value)} placeholder="https://…" /></Field>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-5 space-y-4">
            <h4 className="text-sm font-semibold text-slate-700">SEO</h4>
            <Field label="SEO Title"><TextInput value={form.seo_title ?? ""} onChange={(e) => set("seo_title", e.target.value)} /></Field>
            <Field label="SEO Description"><TextArea value={form.seo_description ?? ""} onChange={(e) => set("seo_description", e.target.value)} rows={3} /></Field>
          </div>
        </div>
      </div>
    </form>
  );
}
