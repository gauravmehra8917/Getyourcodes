import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
      <Loader2 className={cn("h-4 w-4 animate-spin text-muted-foreground", className)} aria-hidden="true" />
      <span className={label ? "text-sm text-muted-foreground" : "sr-only"}>{label ?? "Loading"}</span>
    </span>
  );
}

export function LoadingBlock({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center py-12", className)}>
      <Spinner label={label} />
    </div>
  );
}
