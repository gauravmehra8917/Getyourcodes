import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Page-width container — consistent responsive gutters and max-width. */
export function Container({
  children,
  className,
  size = "page",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  size?: "page" | "narrow";
  as?: ElementType;
}) {
  return (
    <Tag className={cn(size === "narrow" ? "container-narrow" : "container-page", className)}>
      {children}
    </Tag>
  );
}

/** Vertical rhythm wrapper for page sections. */
export function Section({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}) {
  return <Tag className={cn("section-y", className)}>{children}</Tag>;
}
