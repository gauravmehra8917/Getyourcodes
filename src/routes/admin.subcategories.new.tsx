import { createFileRoute } from "@tanstack/react-router";
import { SubcategoryForm } from "./admin.subcategories.$id";

export const Route = createFileRoute("/admin/subcategories/new")({
  component: () => <SubcategoryForm mode="new" />,
});
