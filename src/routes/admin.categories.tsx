import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { deleteAdminCatalogRow } from "@/lib/admin-catalog-delete";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sb, type Category } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X } from "lucide-react";
import {
  SeoSettings,
  emptySeo,
  fromRow,
  toPayload,
  autofillSeo,
  type SeoValues,
} from "@/components/admin/seo-settings";
import { abs } from "@/lib/seo";
import { categorySlug } from "@/lib/coupon-actions";

export const Route = createFileRoute("/admin/categories")({
  component: CategoriesPage,
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

function CategoriesPage() {
  const qc = useQueryClient();
  const pendingDeletes = useRef(new Set<string>());
  const [deletingIds, setDeletingIds] = useState(new Set<string>());
  const {
    data: rows = [],
    isPending,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["admin-categories"],
    queryFn: async () => {
      const { data, error } = await sb.from("categories").select("*").order("name");
      if (error) throw new Error("Could not load categories. Please try again.");
      return (data ?? []) as Category[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: "", slug: "" });
  const [seo, setSeo] = useState<SeoValues>(emptySeo);
  const [error, setError] = useState<string | null>(null);

  const startNew = () => {
    setEditing(null);
    setForm({ name: "", slug: "" });
    setSeo(emptySeo);
    setError(null);
    setOpen(true);
  };
  const startEdit = (c: Category) => {
    setEditing(c);
    setForm({ name: c.name, slug: c.slug });
    setSeo(fromRow(c as unknown as Record<string, string | null>));
    setError(null);
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name) {
      setError("Name is required");
      return;
    }
    const slug = form.slug || slugify(form.name);
    const seoFilled = autofillSeo(seo, {
      name: form.name,
      slug: categorySlug(slug),
      pathPrefix: "",
    });
    const payload = { name: form.name, slug, ...toPayload(seoFilled) };
    const { error: err } = editing
      ? await sb.from("categories").update(payload).eq("id", editing.id)
      : await sb.from("categories").insert(payload);
    if (err) {
      setError(err.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-categories"] });
    setOpen(false);
  };

  const onDelete = (row: Category) =>
    deleteAdminCatalogRow({
      kind: "category",
      row,
      pendingIds: pendingDeletes.current,
      confirmDelete: () => confirm("Delete this category?"),
      deleteRow: () => sb.from("categories").delete().eq("id", row.id),
      onBusyChange: () => setDeletingIds(new Set(pendingDeletes.current)),
      onError: (message) => toast.error(message),
      refresh: () => qc.invalidateQueries({ queryKey: ["admin-categories"] }),
    });

  const cols: Column<Category>[] = [
    {
      key: "name",
      header: "Name",
      searchValue: (r) => r.name,
      render: (r) => <span className="font-medium text-slate-800">{r.name}</span>,
    },
    {
      key: "slug",
      header: "Slug",
      searchValue: (r) => r.slug,
      render: (r) => <span className="text-xs text-slate-500">/{r.slug}</span>,
    },
    {
      key: "actions",
      header: "Action",
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => startEdit(r)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => void onDelete(r)}
            disabled={deletingIds.has(r.id)}
            className="rounded p-1.5 text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
            title={deletingIds.has(r.id) ? "Deleting…" : "Delete"}
            aria-label="Delete category"
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
        title="Categories"
        action={
          <button
            onClick={startNew}
            className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900"
          >
            <Plus className="h-4 w-4" /> Add New
          </button>
        }
      />
      {isPending ? (
        <p role="status" className="text-sm text-slate-500">
          Loading categories…
        </p>
      ) : isError ? (
        <div
          role="alert"
          className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          Could not load categories. Please try again.
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="ml-3 rounded border border-rose-300 px-3 py-1 disabled:opacity-50"
          >
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : (
        <DataTable rows={rows} columns={cols} />
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="my-8 w-full max-w-xl rounded-md bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">
                {editing ? "Edit Category" : "New Category"}
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              {error && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              )}
              <Field label="Name" required>
                <TextInput
                  value={form.name}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      name: e.target.value,
                      slug: form.slug || slugify(e.target.value),
                    })
                  }
                  required
                />
              </Field>
              <Field label="Slug">
                <TextInput
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })}
                />
              </Field>
              <SeoSettings
                value={seo}
                onChange={setSeo}
                canonicalPreviewUrl={abs(`/${categorySlug(form.slug || slugify(form.name))}`)}
                previewFallback={{
                  title: form.name,
                  url: abs(`/${categorySlug(form.slug || slugify(form.name))}`),
                }}
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  {editing ? "Update" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
