import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/admin/coming-soon";
export const Route = createFileRoute("/admin/subcategories")({ component: () => <ComingSoon title="Sub Categories" /> });
