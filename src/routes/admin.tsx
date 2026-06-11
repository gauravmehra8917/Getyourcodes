import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadStoreLogo } from "@/lib/admin.functions";
import { sb, type Store, type Coupon, type Category } from "@/lib/db";
import { LogOut, Pencil, Plus, Trash2, Upload, X } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin dashboard — SaveHub" }, { name: "robots", content: "noindex" }] }),
  component: AdminPage,
});

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function fileToBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read logo file."));
    reader.readAsDataURL(file);
  });
  return dataUrl.split(",")[1] ?? "";
}

function AdminPage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"stores" | "coupons" | "categories">("stores");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!mounted) return;
      if (!data.user) { navigate({ to: "/login" }); return; }
      setUserId(data.user.id);
      const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", data.user.id);
      setIsAdmin(Array.isArray(roles) && roles.some((r: { role: string }) => r.role === "admin"));
    });
    return () => { mounted = false; };
  }, [navigate]);

  if (!userId) return <p className="py-16 text-center text-muted-foreground">Loading…</p>;
  if (isAdmin === false) return (
    <div className="py-16 text-center">
      <p className="text-muted-foreground">You're signed in but not an admin.</p>
      <button onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }} className="mt-4 rounded-full border border-border px-4 py-2 text-sm">Sign out</button>
    </div>
  );
  if (isAdmin === null) return <p className="py-16 text-center text-muted-foreground">Checking permissions…</p>;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Admin dashboard</h1>
          <p className="text-sm text-muted-foreground">Manage stores, coupons and categories.</p>
        </div>
        <button onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>

      <div className="mt-8 inline-flex rounded-full bg-secondary p-1">
        {(["stores", "coupons", "categories"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-5 py-2 text-sm font-medium capitalize transition ${tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === "stores" && <StoresTab />}
        {tab === "coupons" && <CouponsTab />}
        {tab === "categories" && <CategoriesTab />}
      </div>
    </div>
  );
}

function StoresTab() {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => {
      const { data } = await sb.from("stores").select("*").order("name");
      return (data ?? []) as Store[];
    },
  });
  const [form, setForm] = useState({ name: "", description: "", affiliate_url: "", featured: false });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setSaving(true);
    try {
      let logo_url: string | null = null;
      if (logoFile) {
        const ext = logoFile.name.split(".").pop();
        const path = `${slugify(form.name)}-${Date.now()}.${ext}`;
        const result = await uploadStoreLogo({ data: { path, contentType: logoFile.type || "image/*", base64: await fileToBase64(logoFile) } });
        logo_url = result.publicUrl;
      }
      const { error } = await sb.from("stores").insert({
        name: form.name, slug: slugify(form.name),
        description: form.description || null, affiliate_url: form.affiliate_url || null,
        featured: form.featured, logo_url,
      });
      if (error) throw error;
      setForm({ name: "", description: "", affiliate_url: "", featured: false });
      setLogoFile(null);
      refetch();
      qc.invalidateQueries({ queryKey: ["stores"] });
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this store and all its coupons?")) return;
    await sb.from("stores").delete().eq("id", id);
    refetch();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.5fr]">
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h3 className="font-semibold">Add store</h3>
        <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <Textarea label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
        <Input label="Affiliate URL" value={form.affiliate_url} onChange={(v) => setForm({ ...form, affiliate_url: v })} placeholder="https://…" />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Logo</span>
          <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border bg-secondary/40 px-4 text-sm text-muted-foreground hover:border-primary">
            <Upload className="h-4 w-4" /> {logoFile ? logoFile.name : "Choose image"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
          </label>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
          Featured on homepage
        </label>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <button disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          <Plus className="h-4 w-4" /> {saving ? "Saving…" : "Add store"}
        </button>
      </form>

      <div className="space-y-2">
        {data?.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            {s.logo_url ? <img src={s.logo_url} className="h-10 w-10 rounded-lg border border-border object-contain p-1" /> : <div className="h-10 w-10 rounded-lg bg-secondary" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.name} {s.featured && <span className="ml-1 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold uppercase text-success">Featured</span>}</p>
              <p className="truncate text-xs text-muted-foreground">/{s.slug}-coupons</p>
            </div>
            <button onClick={() => remove(s.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {!data?.length && <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No stores yet.</p>}
      </div>
    </div>
  );
}

function CouponsTab() {
  const { data: stores } = useQuery({
    queryKey: ["admin-stores-select"],
    queryFn: async () => {
      const { data } = await sb.from("stores").select("id, name").order("name");
      return (data ?? []) as Pick<Store, "id" | "name">[];
    },
  });
  const { data, refetch } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async () => {
      const { data } = await sb.from("coupons").select("*, stores(name)").order("created_at", { ascending: false });
      return (data ?? []) as (Coupon & { stores: { name: string } })[];
    },
  });

  const [form, setForm] = useState({
    store_id: "", title: "", description: "", coupon_code: "",
    coupon_type: "code" as "code" | "deal", affiliate_url: "", expiry_date: "", terms: "",
    featured_in_banner: false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setSaving(true);
    try {
      const { error } = await sb.from("coupons").insert({
        store_id: form.store_id, title: form.title,
        description: form.description || null,
        coupon_code: form.coupon_type === "code" ? form.coupon_code : null,
        coupon_type: form.coupon_type,
        affiliate_url: form.affiliate_url || null,
        expiry_date: form.expiry_date || null,
        terms: form.terms || null,
        status: "active",
        featured_in_banner: form.featured_in_banner,
      });
      if (error) throw error;
      setForm({ ...form, title: "", description: "", coupon_code: "", affiliate_url: "", expiry_date: "", terms: "", featured_in_banner: false });
      refetch();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };

  const setStatus = async (id: string, status: "active" | "expired" | "draft") => {
    await sb.from("coupons").update({ status }).eq("id", id);
    refetch();
  };
  const toggleBanner = async (id: string, value: boolean) => {
    await sb.from("coupons").update({ featured_in_banner: value }).eq("id", id);
    refetch();
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this coupon?")) return;
    await sb.from("coupons").delete().eq("id", id);
    refetch();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.5fr]">
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h3 className="font-semibold">Add coupon</h3>
        <Select label="Store" value={form.store_id} onChange={(v) => setForm({ ...form, store_id: v })} options={(stores ?? []).map((s) => ({ value: s.id, label: s.name }))} required />
        <Select label="Type" value={form.coupon_type} onChange={(v) => setForm({ ...form, coupon_type: v as "code" | "deal" })} options={[{ value: "code", label: "Code" }, { value: "deal", label: "Deal" }]} />
        <Input label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required placeholder="20% off sitewide" />
        <Textarea label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
        {form.coupon_type === "code" && <Input label="Coupon code" value={form.coupon_code} onChange={(v) => setForm({ ...form, coupon_code: v.toUpperCase() })} placeholder="SAVE20" />}
        <Input label="Affiliate URL" value={form.affiliate_url} onChange={(v) => setForm({ ...form, affiliate_url: v })} placeholder="https://…" />
        <Input label="Expiry date" type="date" value={form.expiry_date} onChange={(v) => setForm({ ...form, expiry_date: v })} />
        <Textarea label="Terms & conditions" value={form.terms} onChange={(v) => setForm({ ...form, terms: v })} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.featured_in_banner} onChange={(e) => setForm({ ...form, featured_in_banner: e.target.checked })} />
          Feature in global deals banner
        </label>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <button disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          <Plus className="h-4 w-4" /> {saving ? "Saving…" : "Add coupon"}
        </button>
      </form>

      <div className="space-y-2">
        {data?.map((c) => (
          <div key={c.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {c.title}
                  {c.featured_in_banner && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">In banner</span>}
                </p>
                <p className="text-xs text-muted-foreground">{c.stores?.name} · {c.coupon_type}{c.coupon_code ? ` · ${c.coupon_code}` : ""}{c.expiry_date ? ` · exp ${c.expiry_date}` : ""}</p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Show in global deals banner">
                <input type="checkbox" checked={c.featured_in_banner} onChange={(e) => toggleBanner(c.id, e.target.checked)} />
                Banner
              </label>
              <select value={c.status} onChange={(e) => setStatus(c.id, e.target.value as "active" | "expired" | "draft")} className="rounded-lg border border-border bg-card px-2 py-1 text-xs">
                <option value="active">active</option>
                <option value="expired">expired</option>
                <option value="draft">draft</option>
              </select>
              <button onClick={() => remove(c.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
        {!data?.length && <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No coupons yet.</p>}
      </div>
    </div>
  );
}

function CategoriesTab() {
  const { data, refetch } = useQuery({
    queryKey: ["admin-categories"],
    queryFn: async () => {
      const { data } = await sb.from("categories").select("*").order("name");
      return (data ?? []) as Category[];
    },
  });
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const { error } = await sb.from("categories").insert({ name, slug: slugify(name) });
    if (error) { setErr(error.message); return; }
    setName(""); refetch();
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    await sb.from("categories").delete().eq("id", id);
    refetch();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.5fr]">
      <form onSubmit={add} className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h3 className="font-semibold">Add category</h3>
        <Input label="Name" value={name} onChange={setName} required placeholder="Fashion" />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <button className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" /> Add
        </button>
      </form>
      <div className="space-y-2">
        {data?.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.name}</p>
              <p className="truncate text-xs text-muted-foreground">/{c.slug}-offers</p>
            </div>
            <button onClick={() => remove(c.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {!data?.length && <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No categories yet.</p>}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", required, placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-input bg-card px-3 outline-none focus:border-primary" />
    </label>
  );
}
function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-input bg-card px-3 py-2 outline-none focus:border-primary" />
    </label>
  );
}
function Select({ label, value, onChange, options, required }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required}
        className="h-10 w-full rounded-xl border border-input bg-card px-3 outline-none focus:border-primary">
        <option value="">Select…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
