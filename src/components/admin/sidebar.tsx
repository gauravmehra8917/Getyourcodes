import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Megaphone, Tag, Tags, Store, GalleryHorizontal,
  FileText, Users, Bell, Languages, ListOrdered, Image as ImageIcon,
  Brush, Mail, Settings, Newspaper, FolderOpen, MessageSquare, Star, BarChart3, History,
} from "lucide-react";

type Item = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  { title: "Overview", items: [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { to: "/admin/reports", label: "Reports", icon: BarChart3 },
    { to: "/admin/activity", label: "Activity Log", icon: History },
  ]},
  { title: "Catalog", items: [
    { to: "/admin/coupons", label: "Coupons", icon: Megaphone },
    { to: "/admin/categories", label: "Categories", icon: Tag },
    { to: "/admin/subcategories", label: "Sub Categories", icon: Tags },
    { to: "/admin/stores", label: "Stores", icon: Store },
    { to: "/admin/reviews", label: "Store Reviews", icon: Star },
  ]},
  { title: "Content", items: [
    { to: "/admin/posts", label: "Posts", icon: Newspaper },
    { to: "/admin/blog-categories", label: "Blog Categories", icon: FolderOpen },
    { to: "/admin/comments", label: "Comments", icon: MessageSquare },
    { to: "/admin/pages", label: "Pages", icon: FileText },
    { to: "/admin/sliders", label: "Sliders", icon: GalleryHorizontal },
    { to: "/admin/ads", label: "Ads", icon: ImageIcon },
  ]},
  { title: "Audience", items: [
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/subscribers", label: "Subscribers", icon: Bell },
  ]},
  { title: "System", items: [
    { to: "/admin/menus", label: "Menus", icon: ListOrdered },
    { to: "/admin/translations", label: "Translations", icon: Languages },
    { to: "/admin/theme", label: "Theme", icon: Brush },
    { to: "/admin/etemplates", label: "Email Templates", icon: Mail },
    { to: "/admin/settings", label: "Settings", icon: Settings },
  ]},
];

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="hidden w-[230px] shrink-0 flex-col bg-[#2f3e51] text-slate-200 md:flex">
      <div className="flex h-16 items-center justify-center border-b border-white/5">
        <Link to="/admin" className="font-display text-xl font-extrabold tracking-tight text-white">
          SAVE<span className="italic font-light">HUB</span><sup className="text-xs">®</sup>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto py-2 text-[13px]">
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-2">
            <div className="px-5 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-white/40">{g.title}</div>
            {g.items.map((item) => {
              const active = item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 border-l-2 px-5 py-2 transition ${
                    active
                      ? "border-emerald-400 bg-white/5 text-white"
                      : "border-transparent text-slate-300/80 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 opacity-80" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
