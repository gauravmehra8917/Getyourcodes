import { createFileRoute } from "@tanstack/react-router";
import { CouponForm } from "./admin.coupons.$id";

export const Route = createFileRoute("/admin/coupons/new")({
  component: () => <CouponForm mode="new" />,
});
