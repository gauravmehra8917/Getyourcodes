import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PostForm } from "@/components/admin/post-form";

export const Route = createFileRoute("/admin/posts/$id")({ component: EditPost });

function EditPost() {
  const { id } = useParams({ from: "/admin/posts/$id" });
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["admin-post", id],
    queryFn: async () => {
      const { data } = await sb.from("posts").select("*").eq("id", id).maybeSingle();
      return data;
    },
  });
  if (!data) return <div className="p-6 text-slate-500">Loading…</div>;
  return <PostForm initial={data} onSaved={() => navigate({ to: "/admin/posts" })} />;
}
