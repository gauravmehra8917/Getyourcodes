import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sb } from "@/lib/db";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminTopbar } from "@/components/admin/topbar";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — SaveHub" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const [userName, setUserName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) { navigate({ to: "/login" }); return; }
      setUserName(
        (data.user.user_metadata?.display_name as string | undefined)
          || (data.user.user_metadata?.full_name as string | undefined)
          || data.user.email?.split("@")[0]
          || "Admin"
      );
      const { data: roles, error } = await sb.from("user_roles").select("role").eq("user_id", data.user.id);
      if (cancelled) return;
      if (error) { console.error("role check failed", error); setIsAdmin(false); return; }
      setIsAdmin(Array.isArray(roles) && roles.some((r: { role: string }) => r.role === "admin"));
    })();
    return () => { cancelled = true; };
  }, [navigate]);


  if (isAdmin === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8] text-sm text-slate-500">
        Checking permissions…
      </div>
    );
  }
  if (isAdmin === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8]">
        <div className="text-center">
          <p className="text-slate-700">You're signed in but not an admin.</p>
          <button
            onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}
            className="mt-4 rounded bg-slate-800 px-4 py-2 text-sm text-white"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f4f6f8] text-slate-800">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar userName={userName} />
        <main className="flex-1 overflow-x-hidden p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
