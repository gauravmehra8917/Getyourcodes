import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { Field, TextInput, FieldSet } from "@/components/admin/form-fields";

export const Route = createFileRoute("/admin/theme")({ component: ThemePage });

const THEME_KEYS = [
  { key: "theme.primary_color", label: "Primary Color", placeholder: "#4f46e5", type: "color" },
  { key: "theme.accent_color", label: "Accent Color", placeholder: "#7c3aed", type: "color" },
  { key: "theme.logo_url", label: "Logo URL", placeholder: "https://…", type: "text" },
  { key: "theme.favicon_url", label: "Favicon URL", placeholder: "/favicon.ico", type: "text" },
  { key: "theme.font_family", label: "Font Family", placeholder: "Inter, sans-serif", type: "text" },
];

function ThemePage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sb.from("site_settings").select("key,value").like("key", "theme.%").then(({ data }: { data: { key: string; value: string | null }[] | null }) => {
      const next: Record<string, string> = {};
      (data ?? []).forEach((r) => { next[r.key] = r.value ?? ""; });
      setValues(next);
      setLoading(false);
    });
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const upserts = THEME_KEYS.map((f) => ({ key: f.key, value: values[f.key] ?? "" }));
    await sb.from("site_settings").upsert(upserts, { onConflict: "key" });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div>
      <PageHeader title="Theme" />
      <form onSubmit={save} className="rounded-md border border-slate-200 bg-white p-6 shadow-sm">
        <FieldSet title="Branding">
          <div className="grid gap-4 md:grid-cols-2">
            {THEME_KEYS.map((f) => (
              <Field key={f.key} label={f.label}>
                <TextInput type={f.type} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.placeholder} />
              </Field>
            ))}
          </div>
        </FieldSet>
        <div className="mt-6 flex items-center gap-3">
          <button type="submit" className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700">Save Theme</button>
          {saved && <span className="text-sm text-emerald-600">Saved ✓</span>}
        </div>
      </form>
    </div>
  );
}
