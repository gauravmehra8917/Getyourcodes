import { Construction } from "lucide-react";
import { PageHeader } from "./page-header";

export function ComingSoon({ title }: { title: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white py-20 text-center shadow-sm">
        <Construction className="h-10 w-10 text-slate-400" />
        <h2 className="mt-4 text-lg font-semibold text-slate-700">{title} module — coming soon</h2>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          This section is reserved in the navigation to match the reference admin. Let us know when you'd like it
          wired up and we'll build it on top of Lovable Cloud.
        </p>
      </div>
    </div>
  );
}
