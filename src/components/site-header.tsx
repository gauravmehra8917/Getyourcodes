import { Link, useNavigate } from "@tanstack/react-router";
import { Search, Tag } from "lucide-react";
import { useState } from "react";

export function SiteHeader() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

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
            if (q.trim()) navigate({ to: "/search", search: { q: q.trim() } });
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
          <Link to="/search" search={{ q: "" }} className="rounded-full p-2 text-muted-foreground hover:bg-secondary md:hidden">
            <Search className="h-5 w-5" />
          </Link>
          <Link to="/admin" className="hidden rounded-full px-4 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground sm:inline-flex">
            Admin
          </Link>
        </nav>
      </div>
    </header>
  );
}
