import { LogOut, Eye } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export function AdminTopbar({ userName }: { userName?: string | null }) {
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };
  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div className="flex items-center gap-3 text-[15px] text-slate-700">
        <span>
          Welcome, <span className="font-mono text-slate-900">{userName || "Admin"}</span>
        </span>
        <button
          onClick={signOut}
          title="Sign out"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-[15px] text-slate-600 hover:text-slate-900"
      >
        <Eye className="h-4 w-4" /> View Site
      </Link>
    </header>
  );
}
