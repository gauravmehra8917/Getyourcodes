import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PostForm } from "@/components/admin/post-form";

export const Route = createFileRoute("/admin/posts/new")({ component: NewPost });

function NewPost() {
  const navigate = useNavigate();
  return <PostForm onSaved={() => navigate({ to: "/admin/posts" })} />;
}
