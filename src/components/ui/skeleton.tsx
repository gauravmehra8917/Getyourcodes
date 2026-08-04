import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton-block", className)} aria-hidden="true" {...props} />;
}

export { Skeleton };
