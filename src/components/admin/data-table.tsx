import { useMemo, useState, type ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  searchValue?: (row: T) => string;
};

export function DataTable<T extends { id: string | number }>({
  rows,
  columns,
  emptyText = "No entries.",
}: {
  rows: T[];
  columns: Column<T>[];
  emptyText?: string;
}) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      columns.some((c) => {
        const v = c.searchValue ? c.searchValue(r) : String((r as Record<string, unknown>)[c.key] ?? "");
        return v.toLowerCase().includes(term);
      })
    );
  }, [rows, q, columns]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  const pageNums = (() => {
    const max = 5;
    const arr: number[] = [];
    let from = Math.max(1, safePage - 2);
    const to = Math.min(totalPages, from + max - 1);
    from = Math.max(1, to - max + 1);
    for (let i = from; i <= to; i++) arr.push(i);
    return arr;
  })();

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm text-slate-600">
          Show{" "}
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="mx-1 h-8 rounded border border-slate-300 bg-white px-2 text-sm"
          >
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>{" "}
          entries
        </label>
        <label className="text-sm text-slate-600">
          Search:{" "}
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="ml-1 h-8 w-56 rounded border border-slate-300 px-2 text-sm focus:border-slate-700 focus:outline-none"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[13px] font-semibold text-slate-500">
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-3 ${c.className ?? ""}`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-3 align-middle text-slate-700 ${c.className ?? ""}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {!slice.length && (
              <tr><td colSpan={columns.length} className="py-10 text-center text-slate-500">{emptyText}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <div>
          Showing {filtered.length === 0 ? 0 : start + 1} to {Math.min(start + pageSize, filtered.length)} of {filtered.length} entries
        </div>
        <div className="flex items-center gap-1">
          <PageBtn disabled={safePage === 1} onClick={() => setPage(1)}>First</PageBtn>
          <PageBtn disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Previous</PageBtn>
          {pageNums.map((n) => (
            <button
              key={n}
              onClick={() => setPage(n)}
              className={`h-8 min-w-8 rounded px-2 text-sm ${n === safePage ? "bg-slate-700 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {n}
            </button>
          ))}
          <PageBtn disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>Next</PageBtn>
          <PageBtn disabled={safePage === totalPages} onClick={() => setPage(totalPages)}>Last</PageBtn>
        </div>
      </div>
    </div>
  );
}

function PageBtn({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-8 rounded border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
    >
      {children}
    </button>
  );
}
