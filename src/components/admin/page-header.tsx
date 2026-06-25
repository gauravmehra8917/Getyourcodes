export function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-800">{title}</h1>
        <div className="mt-1 h-[3px] w-12 rounded bg-slate-700/80" />
      </div>
      {action}
    </div>
  );
}
