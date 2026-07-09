import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sb } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";

export const Route = createFileRoute("/admin/reports")({ component: ReportsPage });

type ClickRow = { id: string; coupon_id: string; source_page: string | null; clicked_at: string };
type CouponMeta = {
  id: string;
  title: string | null;
  coupon_code: string | null;
  store_id: string | null;
  stores: { id: string; name: string; category_id: string | null } | null;
};
type CategoryMeta = { id: string; name: string };

function ReportsPage() {
  const [days, setDays] = useState(30);
  const from = useMemo(() => new Date(Date.now() - days * 86400000).toISOString(), [days]);

  const { data: clicks = [], dataUpdatedAt } = useQuery({
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

  const couponIds = useMemo(() => Array.from(new Set(clicks.map((c) => c.coupon_id))), [clicks]);

  const { data: coupons = [] } = useQuery({
    queryKey: ["admin-clicks-coupons", couponIds],
    enabled: couponIds.length > 0,
    queryFn: async () => {
      const { data } = await sb
        .from("coupons")
        .select("id,title,coupon_code,store_id,stores(id,name,category_id)")
        .in("id", couponIds);
      return (data ?? []) as CouponMeta[];
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["admin-clicks-categories"],
    queryFn: async () => {
      const { data } = await sb.from("categories").select("id,name");
      return (data ?? []) as CategoryMeta[];
    },
  });

  const couponMap = useMemo(() => new Map(coupons.map((c) => [c.id, c])), [coupons]);
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const totals = useMemo(() => aggregate(clicks, days, couponMap, categoryMap), [clicks, days, couponMap, categoryMap]);

  const exportCsv = () => {
    const headers = ["clicked_at", "coupon_id", "coupon_title", "store", "source_page"];
    const rows = clicks.map((c) => {
      const m = couponMap.get(c.coupon_id);
      return [c.clicked_at, c.coupon_id, esc(m?.title ?? ""), esc(m?.stores?.name ?? ""), esc(c.source_page ?? "")].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `clicks-${days}d.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const updated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—";

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

      <div className="text-xs text-slate-500">Last updated: {updated}</div>

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
            <tr>
              <th className="py-2">Coupon</th>
              <th className="py-2">Code</th>
              <th className="py-2">Store</th>
              <th className="py-2 text-right">Clicks</th>
            </tr>
          </thead>
          <tbody>
            {totals.byCoupon.slice(0, 10).map(([id, n]) => {
              const m = couponMap.get(id);
              return (
                <tr key={id} className="border-t border-slate-100">
                  <td className="py-2 font-medium text-slate-800">{m?.title ?? <code className="text-xs">{id.slice(0, 8)}…</code>}</td>
                  <td className="py-2">{m?.coupon_code ? <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{m.coupon_code}</code> : <span className="text-slate-400">—</span>}</td>
                  <td className="py-2 text-slate-600">{m?.stores?.name ?? "—"}</td>
                  <td className="py-2 text-right font-medium">{n}</td>
                </tr>
              );
            })}
            {!totals.byCoupon.length && <tr><td colSpan={4} className="py-6 text-center text-slate-500">No clicks yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RankTable title="Top stores by clicks" rows={totals.byStore} emptyLabel="No store clicks yet." />
        <RankTable title="Top categories by clicks" rows={totals.byCategory} emptyLabel="No category clicks yet." />
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

function RankTable({ title, rows, emptyLabel }: { title: string; rows: [string, number][]; emptyLabel: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr><th className="py-2">Name</th><th className="py-2 text-right">Clicks</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map(([name, n]) => (
            <tr key={name} className="border-t border-slate-100">
              <td className="py-2 text-slate-800">{name}</td>
              <td className="py-2 text-right font-medium">{n}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={2} className="py-6 text-center text-slate-500">{emptyLabel}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function SparkBars({ data }: { data: { day: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (!data.length) return <div className="py-8 text-center text-sm text-slate-500">No data.</div>;
  return (
    <div className="flex h-32 items-end gap-1">
      {data.map((d) => {
        const pct = (d.count / max) * 100;
        return (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.count}`}>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-indigo-500/80"
                style={{ height: `${pct}%`, minHeight: d.count > 0 ? 2 : 0 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function aggregate(
  rows: ClickRow[],
  days: number,
  couponMap: Map<string, CouponMeta>,
  categoryMap: Map<string, string>,
) {
  const byDayMap = new Map<string, number>();
  const byCouponMap = new Map<string, number>();
  const byStoreMap = new Map<string, number>();
  const byCategoryMap = new Map<string, number>();

  // Seed every day in range so chart renders continuously even on sparse data
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    byDayMap.set(d, 0);
  }

  for (const r of rows) {
    const day = r.clicked_at.slice(0, 10);
    byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1);
    byCouponMap.set(r.coupon_id, (byCouponMap.get(r.coupon_id) ?? 0) + 1);
    const m = couponMap.get(r.coupon_id);
    const storeName = m?.stores?.name;
    if (storeName) byStoreMap.set(storeName, (byStoreMap.get(storeName) ?? 0) + 1);
    const catId = m?.stores?.category_id;
    const catName = catId ? categoryMap.get(catId) : undefined;
    if (catName) byCategoryMap.set(catName, (byCategoryMap.get(catName) ?? 0) + 1);
  }

  const byDay = Array.from(byDayMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));
  const byCoupon = Array.from(byCouponMap.entries()).sort((a, b) => b[1] - a[1]);
  const byStore = Array.from(byStoreMap.entries()).sort((a, b) => b[1] - a[1]);
  const byCategory = Array.from(byCategoryMap.entries()).sort((a, b) => b[1] - a[1]);
  return { byDay, byCoupon, byStore, byCategory };
}

function esc(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
