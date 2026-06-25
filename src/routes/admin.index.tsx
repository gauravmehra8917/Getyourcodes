import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { sb, type Coupon } from "@/lib/db";
import { Megaphone, Users as UsersIcon, Tag, Store as StoreIcon } from "lucide-react";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [c, u, s, cat] = await Promise.all([
        sb.from("coupons").select("id", { count: "exact", head: true }),
        sb.from("profiles").select("id", { count: "exact", head: true }),
        sb.from("stores").select("id", { count: "exact", head: true }),
        sb.from("categories").select("id", { count: "exact", head: true }),
      ]);
      return {
        coupons: c.count ?? 0,
        users: u.count ?? 0,
        stores: s.count ?? 0,
        categories: cat.count ?? 0,
      };
    },
  });
  const { data: recent } = useQuery({
    queryKey: ["admin-recent-coupons"],
    queryFn: async () => {
      const { data } = await sb
        .from("coupons")
        .select("id, title, created_at, stores(name, logo_url)")
        .order("created_at", { ascending: false })
        .limit(5);
      return (data ?? []) as (Coupon & { stores: { name: string; logo_url: string | null } })[];
    },
  });

  return (
    <div>
      <SectionHeader>Sections</SectionHeader>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Coupons" value={stats?.coupons ?? "—"} icon={<Megaphone className="h-8 w-8" />} />
        <StatCard label="Users" value={stats?.users ?? "—"} icon={<UsersIcon className="h-8 w-8" />} />
        <StatCard label="Stores" value={stats?.stores ?? "—"} icon={<StoreIcon className="h-8 w-8" />} />
        <StatCard label="Categories" value={stats?.categories ?? "—"} icon={<Tag className="h-8 w-8" />} />
      </div>

      <SectionHeader>Summary</SectionHeader>
      <div className="rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-slate-800">Coupons</h3>
          <Link
            to="/admin/coupons"
            className="rounded-full border border-slate-300 px-4 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            View All ›
          </Link>
        </div>
        <ul>
          {recent?.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 last:border-0">
              <div className="flex items-center gap-3">
                {c.stores?.logo_url
                  ? <img src={c.stores.logo_url} alt={`${c.stores.name} logo`} className="h-8 w-8 rounded border border-slate-200 object-contain p-0.5" />
                  : <div className="h-8 w-8 rounded bg-rose-200" />}
                <span className="text-sm text-slate-700">{c.title}</span>
              </div>
              <span className="text-xs text-slate-500">
                {new Date(c.created_at).toLocaleDateString("en-GB").replace(/\//g, "-")}
              </span>
            </li>
          ))}
          {!recent?.length && <li className="px-5 py-8 text-center text-sm text-slate-500">No coupons yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold text-slate-800">{children}</h2>
      <div className="mt-1 h-[3px] w-12 rounded bg-slate-700/80" />
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <div className="text-3xl font-bold text-slate-800">{value}</div>
        <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      </div>
      <div className="text-slate-400">{icon}</div>
    </div>
  );
}
