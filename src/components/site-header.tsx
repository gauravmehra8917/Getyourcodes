import { Link, useNavigate } from "@tanstack/react-router";
import { Search, Tag, User, LogOut, Heart, BarChart3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trackSearch } from "@/lib/db";
import type { User as AuthUser } from "@supabase/supabase-js";

export function SiteHeader() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

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

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Tag className="h-5 w-5" />
          </span>
          <span>SaveHub</span>
        </Link>

        <form
          className="ml-auto hidden flex-1 max-w-md md:flex"
          onSubmit={(e) => {
            e.preventDefault();
            const term = q.trim();
            if (!term) return;
            trackSearch(term, "search");
            navigate({ to: "/search", search: { q: term } });
          }}
        >
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search stores, brands, deals…"
              className="h-10 w-full rounded-full border border-input bg-secondary pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:bg-card"
            />
          </div>
        </form>

        <nav className="ml-auto flex items-center gap-1 text-sm md:ml-0">
          <Link to="/search" search={{ q: "" }} aria-label="Search" className="rounded-full p-2 text-muted-foreground hover:bg-secondary md:hidden">
            <Search className="h-5 w-5" />
          </Link>

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-sm font-semibold text-primary hover:opacity-90"
                aria-label="Account menu"
              >
                {avatarUrl ? <img src={avatarUrl} alt="" width={36} height={36} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : initial}
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
                  <div className="border-b border-border px-4 py-3">
                    <p className="truncate text-xs text-muted-foreground">Signed in as</p>
                    <p className="truncate text-sm font-medium">{user.email}</p>
                  </div>
                  <Link to="/account" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-secondary">
                    <User className="h-4 w-4" /> My account
                  </Link>
                  <Link to="/account" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-secondary">
                    <Heart className="h-4 w-4" /> Saved
                  </Link>
                  <Link to="/analytics" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-secondary">
                    <BarChart3 className="h-4 w-4" /> Deal analytics
                  </Link>
                  <button onClick={signOut} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-destructive hover:bg-secondary">
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to="/auth" className="hidden rounded-full px-4 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground sm:inline-flex">
                Sign in
              </Link>
              <Link to="/auth" className="inline-flex rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
