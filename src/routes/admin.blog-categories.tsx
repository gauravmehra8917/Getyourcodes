import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { runAdminSecondaryAction, blogCategoryErrorMessage } from "@/lib/admin-secondary-actions";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Field, TextInput, TextArea } from "@/components/admin/form-fields";
import { Pencil, Trash2, Plus, X } from "lucide-react";

export const Route = createFileRoute("/admin/blog-categories")({ component: BlogCategoriesPage });

type Row = { id: string; name: string; slug: string; description: string | null };
const empty = { name: "", slug: "", description: "" };

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function BlogCategoriesPage() {
  const qc = useQueryClient();
  const pendingActions = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState(new Set<string>());
  const saving = busyIds.has("save");
  const {
    data: rows = [],
    isPending,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["admin-blog-categories"],
    queryFn: async () => {
      const { data, error } = await sb.from("blog_categories").select("*").order("name");
      if (error) throw new Error("Could not load blog categories. Please try again.");
      return (data ?? []) as Row[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState(empty);
  const [formError, setFormError] = useState<string | null>(null);

  const startNew = () => {
    if (pendingActions.current.has("save")) return;
    setEditing(null);
    setForm(empty);
    setFormError(null);
    setOpen(true);
  };
  const startEdit = (r: Row) => {
    if (pendingActions.current.has("save") || pendingActions.current.has(r.id)) return;
    setEditing(r);
    setForm({ name: r.name, slug: r.slug, description: r.description ?? "" });
    setFormError(null);
    setOpen(true);
  };
  const close = () => {
    if (!pendingActions.current.has("save")) setOpen(false);
  };
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["admin-blog-categories"] }, { throwOnError: true });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      slug: form.slug || slugify(form.name),
      description: form.description || null,
    };
    return runAdminSecondaryAction({
      key: "save",
      pending: pendingActions.current,
      mutate: () =>
        editing
          ? sb.from("blog_categories").update(payload).eq("id", editing.id)
          : sb.from("blog_categories").insert(payload),
      failureMessage: (error) => blogCategoryErrorMessage("save", error),
      refreshFailureMessage:
        "The blog category was saved, but the list could not be refreshed. Please retry loading the list.",
      onBusyChange: () => setBusyIds(new Set(pendingActions.current)),
      onStart: () => setFormError(null),
      onError: setFormError,
      onSuccess: () => setOpen(false),
      onRefreshError: (message) => toast.error(message),
      refresh,
    });
  };
  const onDelete = (id: string) => {
    if (pendingActions.current.has("save")) return;
    return runAdminSecondaryAction({
      key: id,
      pending: pendingActions.current,
      confirm: () => confirm("Delete this blog category?"),
      mutate: () => sb.from("blog_categories").delete().eq("id", id),
      failureMessage: (error) => blogCategoryErrorMessage("delete", error),
      refreshFailureMessage:
        "The blog category was deleted, but the list could not be refreshed. Please retry loading the list.",
      onBusyChange: () => setBusyIds(new Set(pendingActions.current)),
      onError: (message) => toast.error(message),
      refresh,
    });
  };

  const cols: Column<Row>[] = [
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
      render: (r) => <code className="text-xs text-slate-600">{r.slug}</code>,
    },
    {
      key: "description",
      header: "Description",
      render: (r) => <span className="text-slate-600">{r.description ?? "—"}</span>,
    },
    {
      key: "actions",
      header: "Action",
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => startEdit(r)}
            disabled={saving || busyIds.has(r.id)}
            title="Edit"
            aria-label="Edit blog category"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => void onDelete(r.id)}
            disabled={saving || busyIds.has(r.id)}
            title={busyIds.has(r.id) ? "Deleting…" : "Delete"}
            aria-label={busyIds.has(r.id) ? "Deleting blog category…" : "Delete blog category"}
            className="rounded p-1.5 text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
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
        title="Blog Categories"
        action={
          <button
            onClick={startNew}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-900 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add New
          </button>
        }
      />
      {isPending ? (
        <p role="status" className="text-sm text-slate-500">
          Loading blog categories…
        </p>
      ) : isError ? (
        <div
          role="alert"
          className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          Could not load blog categories. Please try again.
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-md bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-800">
                {editing ? "Edit Category" : "New Category"}
              </h3>
              <button
                onClick={close}
                disabled={saving}
                aria-label="Close blog category form"
                className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-5">
              {formError && (
                <div
                  role="alert"
                  className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                >
                  {formError}
                </div>
              )}
              <fieldset disabled={saving} className="space-y-4">
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
                <Field label="Slug" required>
                  <TextInput
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Description">
                  <TextArea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </Field>
              </fieldset>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={saving}
                  className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? (editing ? "Updating…" : "Saving…") : editing ? "Update" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
