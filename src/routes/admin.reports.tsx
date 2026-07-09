import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";

export const Route = createFileRoute("/admin/reports")({ component: ReportsPage });

type ClickRow = { id: string; coupon_id: string; source_page: string | null; clicked_at: string };

function ReportsPage() {
  const [days, setDays] = useState(30);
  const from = new Date(Date.now() - days * 86400000).toISOString();

  const { data: clicks = [] } = useQuery({
    queryKey: ["admin-clicks", days],
    queryFn: async () => {
      const { data, error } = await sb
        .from("coupon_clicks")
        .select("id,coupon_id,source_page,clicked_at")
        .gte("clicked_at", from)
        .order("clicked_at", { ascending: false })
        .limit(5000);
      if (error) console.error("[reports] coupon_clicks query failed:", error);
      return (data ?? []) as ClickRow[];
    },
  });

  const totals = aggregate(clicks);

  const exportCsv = () => {
    const headers = ["created_at", "coupon_id", "source_page"];
    const rows = clicks.map((c) => [c.created_at, c.coupon_id, c.source_page ?? ""].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `clicks-${days}d.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Reports & Analytics" action={
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded border border-slate-300 bg-white px-3 text-sm">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button onClick={exportCsv} className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900">Export CSV</button>
        </div>
      } />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total clicks" value={clicks.length.toLocaleString()} />
        <StatCard label="Unique coupons clicked" value={new Set(clicks.map((c) => c.coupon_id)).size.toLocaleString()} />
        <StatCard label="Days in range" value={String(days)} />
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Clicks per day</h3>
        <SparkBars data={totals.byDay} />
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Top coupons by clicks</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr><th className="py-2">Coupon ID</th><th className="py-2">Clicks</th></tr>
          </thead>
          <tbody>
            {totals.byCoupon.slice(0, 10).map(([id, n]) => (
              <tr key={id} className="border-t border-slate-100"><td className="py-2"><code className="text-xs">{id.slice(0, 8)}…</code></td><td className="py-2 font-medium">{n}</td></tr>
            ))}
            {!totals.byCoupon.length && <tr><td colSpan={2} className="py-6 text-center text-slate-500">No clicks yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}

function SparkBars({ data }: { data: { day: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (!data.length) return <div className="py-8 text-center text-sm text-slate-500">No data.</div>;
  return (
    <div className="flex h-32 items-end gap-1">
      {data.map((d) => (
        <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.count}`}>
          <div className="w-full rounded-t bg-indigo-500/80" style={{ height: `${(d.count / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

function aggregate(rows: ClickRow[]) {
  const byDayMap = new Map<string, number>();
  const byCouponMap = new Map<string, number>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1);
    byCouponMap.set(r.coupon_id, (byCouponMap.get(r.coupon_id) ?? 0) + 1);
  }
  const byDay = Array.from(byDayMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));
  const byCoupon = Array.from(byCouponMap.entries()).sort((a, b) => b[1] - a[1]);
  return { byDay, byCoupon };
}
