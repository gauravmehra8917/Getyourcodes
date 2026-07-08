import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Field, TextInput, TextArea, SelectInput } from "@/components/admin/form-fields";
import { uploadStoreLogo } from "@/lib/admin.functions";
import { SITE_URL } from "@/lib/seo";

export type SeoValues = {
  seo_title: string;
  seo_description: string;
  seo_canonical_url: string;
  seo_robots: string;
  seo_og_image: string;
};

export const emptySeo: SeoValues = {
  seo_title: "",
  seo_description: "",
  seo_canonical_url: "",
  seo_robots: "index,follow",
  seo_og_image: "",
};

export function fromRow(r: Partial<Record<keyof SeoValues, string | null>> | null | undefined): SeoValues {
  return {
    seo_title: r?.seo_title ?? "",
    seo_description: r?.seo_description ?? "",
    seo_canonical_url: r?.seo_canonical_url ?? "",
    seo_robots: r?.seo_robots ?? "index,follow",
    seo_og_image: r?.seo_og_image ?? "",
  };
}

export function toPayload(v: SeoValues) {
  return {
    seo_title: v.seo_title.trim() || null,
    seo_description: v.seo_description.trim() || null,
    seo_canonical_url: v.seo_canonical_url.trim() || null,
    seo_robots: v.seo_robots || "index,follow",
    seo_og_image: v.seo_og_image.trim() || null,
  };
}

/**
 * Autofills unset SEO fields from source (name/title, description, slug prefix).
 * Never overwrites values the user already set.
 */
export function autofillSeo(
  current: SeoValues,
  src: { name?: string | null; description?: string | null; slug?: string | null; pathPrefix?: string },
): SeoValues {
  const next = { ...current };
  if (!next.seo_title && src.name) next.seo_title = src.name.slice(0, 60);
  if (!next.seo_description && src.description) {
    next.seo_description = src.description.replace(/\s+/g, " ").trim().slice(0, 160);
  }
  if (!next.seo_canonical_url && src.slug) {
    const prefix = src.pathPrefix ?? "";
    next.seo_canonical_url = `${SITE_URL}${prefix}/${src.slug}`;
  }
  return next;
}

function Counter({ value, min, max }: { value: number; min: number; max: number }) {
  const warn = value > 0 && (value < min || value > max);
  return (
    <span className={`text-[11px] font-medium ${warn ? "text-amber-600" : "text-slate-500"}`}>
      {value} chars {warn && `(recommended ${min}–${max})`}
    </span>
  );
}

export function SeoSettings({
  value,
  onChange,
  previewFallback,
}: {
  value: SeoValues;
  onChange: (v: SeoValues) => void;
  previewFallback?: { title?: string; description?: string; url?: string };
}) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof SeoValues>(k: K, v: SeoValues[K]) => onChange({ ...value, [k]: v });

  const previewTitle = value.seo_title || previewFallback?.title || "Page title";
  const previewDesc = value.seo_description || previewFallback?.description || "Meta description preview will appear here.";
  const previewUrl = value.seo_canonical_url || previewFallback?.url || SITE_URL;

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `og-${Date.now()}.${ext}`.toLowerCase();
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const res = await uploadStoreLogo({
        data: { path, contentType: file.type || "image/png", base64: btoa(binary) },
      });
      set("seo_og_image", res.publicUrl);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">SEO Settings</span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-200 p-5">
          <div>
            <Field label="SEO Title">
              <TextInput value={value.seo_title} maxLength={120} onChange={(e) => set("seo_title", e.target.value)} />
            </Field>
            <div className="mt-1 flex justify-end"><Counter value={value.seo_title.length} min={30} max={60} /></div>
          </div>

          <div>
            <Field label="Meta Description">
              <TextArea rows={3} maxLength={320} value={value.seo_description} onChange={(e) => set("seo_description", e.target.value)} />
            </Field>
            <div className="mt-1 flex justify-end"><Counter value={value.seo_description.length} min={120} max={160} /></div>
          </div>

          <Field label="Canonical URL">
            <TextInput type="url" placeholder="https://…" value={value.seo_canonical_url} onChange={(e) => set("seo_canonical_url", e.target.value)} />
          </Field>

          <Field label="Meta Robots">
            <SelectInput value={value.seo_robots} onChange={(e) => set("seo_robots", e.target.value)}>
              <option value="index,follow">index,follow</option>
              <option value="noindex,follow">noindex,follow</option>
              <option value="index,nofollow">index,nofollow</option>
              <option value="noindex,nofollow">noindex,nofollow</option>
            </SelectInput>
          </Field>

          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-600">Social Sharing Image</span>
            <div className="flex items-center gap-3">
              {value.seo_og_image ? (
                <img src={value.seo_og_image} alt="OG preview" className="h-16 w-28 rounded border border-slate-200 object-cover" />
              ) : (
                <div className="h-16 w-28 rounded border border-dashed border-slate-300 bg-slate-50" />
              )}
              <label className="cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                {uploading ? "Uploading…" : "Choose image"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </label>
              {value.seo_og_image && (
                <button type="button" onClick={() => set("seo_og_image", "")} className="text-xs text-rose-600 hover:underline">Remove</button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Used for Open Graph &amp; Twitter Card sharing. Optional.</p>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Google Search Preview</div>
            <div className="space-y-1">
              <div className="text-xs text-emerald-800 truncate">{previewUrl}</div>
              <div className="text-lg leading-snug text-[#1a0dab] truncate">{previewTitle}</div>
              <div className="text-sm text-slate-700 line-clamp-2">{previewDesc}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
