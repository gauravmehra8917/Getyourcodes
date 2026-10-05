import { useEffect, useState } from "react";
import { LogOut, Eye, Menu } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AdminNavContent } from "@/components/admin/sidebar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function AdminTopbar({ userName }: { userName?: string | null }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 text-sm text-slate-700 sm:gap-3 sm:text-[15px]">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open admin navigation"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700 md:hidden"
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="flex w-[min(20rem,85vw)] flex-col gap-0 bg-[#2f3e51] p-0 text-slate-200 [&>button]:right-2 [&>button]:top-2 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center [&>button]:text-white"
          >
            <SheetTitle className="sr-only">Admin navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Navigate between administration pages.
            </SheetDescription>
            <AdminNavContent mobile onNavigate={() => setMenuOpen(false)} />
          </SheetContent>
        </Sheet>
        <span className="min-w-0 truncate">
          <span className="sr-only sm:not-sr-only">Welcome, </span>
          <span className="font-mono text-slate-900">{userName || "Admin"}</span>
        </span>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          title="Sign out"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 md:h-auto md:w-auto md:p-1"
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <Link
        to="/"
        className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm text-slate-600 hover:text-slate-900 sm:text-[15px] md:min-h-0"
      >
        <Eye aria-hidden="true" className="h-4 w-4" /> View Site
      </Link>
    </header>
  );
}
