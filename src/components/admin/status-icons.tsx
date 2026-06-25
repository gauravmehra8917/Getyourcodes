import { Check, X } from "lucide-react";

export function YesIcon() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
      <Check className="h-3 w-3" strokeWidth={3} />
    </span>
  );
}
export function NoIcon() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-white">
      <X className="h-3 w-3" strokeWidth={3} />
    </span>
  );
}
export function DisabledIcon() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white">
      <X className="h-3 w-3" strokeWidth={3} />
    </span>
  );
}
export function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
        enabled ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
      }`}
    >
      {enabled ? "Enabled" : "Disabled"}
    </span>
  );
}
