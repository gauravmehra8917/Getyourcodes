import { Link, useRouterState } from "@tanstack/react-router";
import { SITE_URL, SITE_NAME } from "@/lib/seo";
import {
  LayoutDashboard,
  Megaphone,
  Tag,
  Store,
  Users,
  Bell,
  Mail,
  Newspaper,
  FolderOpen,
  BarChart3,
  History,
  Plug,
  Code2,
  Scale,
} from "lucide-react";

type Item = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "Overview",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/admin/reports", label: "Reports", icon: BarChart3 },
      { to: "/admin/activity", label: "Activity Log", icon: History },
    ],
  },
  {
    title: "Catalog",
    items: [
      { to: "/admin/coupons", label: "Coupons", icon: Megaphone },
      { to: "/admin/categories", label: "Categories", icon: Tag },
      { to: "/admin/stores", label: "Stores", icon: Store },
    ],
  },
  {
    title: "Content",
    items: [
      { to: "/admin/posts", label: "Posts", icon: Newspaper },
      { to: "/admin/blog-categories", label: "Blog Categories", icon: FolderOpen },
    ],
  },
  {
    title: "Audience",
    items: [
      { to: "/admin/users", label: "Users", icon: Users },
      { to: "/admin/subscribers", label: "Subscribers", icon: Bell },
      { to: "/admin/newsletters", label: "Newsletters", icon: Mail },
    ],
  },
  {
    title: "System",
    items: [
      { to: "/admin/head-manager", label: "Head Manager", icon: Code2 },
      { to: "/admin/integrations", label: "API Integrations", icon: Plug },
      { to: "/admin/publishing-policies", label: "Publishing Policies", icon: Scale },
    ],
  },
];

export function AdminNavContent({
  onNavigate,
  mobile = false,
}: {
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`flex h-16 shrink-0 items-center border-b border-white/5 ${mobile ? "justify-start pl-5 pr-14" : "justify-center"}`}
      >
        <a
          href={SITE_URL}
          onClick={onNavigate}
          className="font-display text-xl font-extrabold tracking-tight text-white"
          aria-label={`${SITE_NAME} — go to homepage`}
        >
          GET<span className="italic font-light">YOURCODES</span>
          <sup className="text-xs">®</sup>
        </a>
      </div>
      <nav aria-label="Admin" className="min-h-0 flex-1 overflow-y-auto py-2 text-[13px]">
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-2">
            <div className="px-5 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-white/40">
              {g.title}
            </div>
            {g.items.map((item) => {
              const active = item.exact
                ? pathname === item.to
                : pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.exact ?? false }}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 border-l-2 px-5 py-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-400 ${mobile ? "min-h-11" : ""} ${
                    active
                      ? "border-emerald-400 bg-white/5 text-white"
                      : "border-transparent text-slate-300/80 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon aria-hidden="true" className="h-4 w-4 opacity-80" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}

export function AdminSidebar() {
  return (
    <aside className="hidden w-[230px] shrink-0 flex-col bg-[#2f3e51] text-slate-200 md:flex">
      <AdminNavContent />
    </aside>
  );
}
