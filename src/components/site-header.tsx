import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Search, Tag, User, LogOut, Heart, BarChart3, Menu, X, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trackSearch } from "@/lib/db";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAssistant } from "@/components/ai-assistant-provider";
import type { User as AuthUser } from "@supabase/supabase-js";

type NavItem = { label: string; to: string; hash?: string };

const NAV: NavItem[] = [
  { label: "Home", to: "/" },
  { label: "Categories", to: "/categories" },
  { label: "Stores", to: "/stores" },
  { label: "Coupons", to: "/coupons" },
  { label: "Deals", to: "/deals" },
  { label: "Blog", to: "/blog" },
];

export function SiteHeader() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const assistant = useAssistant();
  const [q, setQ] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const initial = (user?.user_metadata?.display_name as string | undefined ?? user?.email ?? "?").charAt(0).toUpperCase();
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  const signOut = async () => {
    await supabase.auth.signOut();
    setMenuOpen(false);
    navigate({ to: "/" });
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    trackSearch(term, "search");
    setMobileOpen(false);
    navigate({ to: "/search", search: { q: term } });
  };

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-[background-color,box-shadow,border-color] duration-200 ${
        scrolled
          ? "border-border bg-background/85 shadow-sm backdrop-blur-md"
          : "border-transparent bg-background"
      }`}
    >
      <div className="container-page flex h-[70px] items-center gap-3 lg:gap-6">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-display text-lg font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Tag className="h-[18px] w-[18px]" />
          </span>
          <span>Getyourcodes</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              hash={item.hash}
              className="focus-ring rounded-full px-3 py-2 text-[0.9375rem] font-medium text-muted-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground"
              activeOptions={{ exact: item.to === "/" && !item.hash, includeHash: false }}
              activeProps={{ className: "text-foreground" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form className="ml-auto hidden max-w-sm flex-1 md:flex" onSubmit={submitSearch}>
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search stores, brands, deals…"
              aria-label="Search stores, brands and deals"
              type="search"
              className="focus-ring h-10 w-full rounded-full border border-input bg-secondary pl-10 pr-4 text-sm outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-primary focus:bg-card"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1 md:ml-0">
          <button
            type="button"
            onClick={() => assistant.open()}
            aria-label="Ask Dealio AI assistant"
            className="focus-ring hidden h-9 w-9 place-items-center sm:h-10 sm:w-10 rounded-full text-muted-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground sm:inline-grid"
          >
            <Sparkles className="h-[18px] w-[18px]" />
          </button>

          <Link
            to="/search"
            search={{ q: "" }}
            aria-label="Search"
            className="focus-ring inline-grid h-9 w-9 place-items-center sm:h-10 sm:w-10 rounded-full text-muted-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground md:hidden"
          >
            <Search className="h-[18px] w-[18px]" />
          </Link>

          <ThemeToggle />

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="focus-ring flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-sm font-semibold text-primary transition-opacity duration-150 hover:opacity-90"
                aria-label="Account menu"
              >
                {avatarUrl ? <img src={avatarUrl} alt="" width={36} height={36} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : initial}
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg">
                  <div className="border-b border-border px-4 py-3">
                    <p className="truncate text-xs text-muted-foreground">Signed in as</p>
                    <p className="truncate text-sm font-medium">{user.email}</p>
                  </div>
                  <Link to="/account" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-hover">
                    <User className="h-4 w-4" /> My account
                  </Link>
                  <Link to="/account" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-hover">
                    <Heart className="h-4 w-4" /> Saved
                  </Link>
                  <Link to="/analytics" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-hover">
                    <BarChart3 className="h-4 w-4" /> Deal analytics
                  </Link>
                  <button onClick={signOut} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-destructive hover:bg-hover">
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/auth"
              search={{}}
              className="focus-ring ml-1 inline-flex h-9 items-center whitespace-nowrap rounded-full bg-primary px-3.5 text-[0.8125rem] sm:h-10 sm:px-4 sm:text-sm font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90"
            >
              Sign in
            </Link>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            className="focus-ring inline-grid h-9 w-9 place-items-center sm:h-10 sm:w-10 rounded-full text-muted-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground lg:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-background lg:hidden">
          <div className="container-page py-3">
            <form className="mb-2 md:hidden" onSubmit={submitSearch}>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search stores, brands, deals…"
                  aria-label="Search stores, brands and deals"
                  type="search"
                  className="focus-ring h-11 w-full rounded-full border border-input bg-secondary pl-10 pr-4 text-sm outline-none focus:border-primary"
                />
              </div>
            </form>
            <nav className="flex flex-col">
              {NAV.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  hash={item.hash}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-xl px-3 py-3 text-base font-medium text-muted-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
