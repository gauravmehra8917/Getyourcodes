import { createFileRoute } from "@tanstack/react-router";
import { StoreForm } from "./admin.stores.$id";

export const Route = createFileRoute("/admin/stores/new")({
  component: () => <StoreForm mode="new" />,
});
