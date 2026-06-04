import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tag } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password — SaveHub" }, { name: "robots", content: "noindex" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase puts the recovery tokens in the URL hash and fires PASSWORD_RECOVERY
    // once the session is established from them.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // If user lands here with an existing session (e.g. clicked again), allow update too.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    if (password !== confirm) return setErr("Passwords do not match.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setErr(error.message);
    setDone(true);
    setTimeout(() => navigate({ to: "/account" }), 1200);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <Link to="/" className="mb-8 inline-flex items-center gap-2 font-display text-xl font-bold">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Tag className="h-5 w-5" />
        </span>
        SaveHub
      </Link>

      <h1 className="font-display text-3xl font-bold">Set a new password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose a new password for your account.
      </p>

      {!ready && !done && (
        <p className="mt-8 rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
          Validating your reset link…
        </p>
      )}

      {ready && !done && (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">New password</span>
            <input
              type="password" required minLength={6} value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Confirm password</span>
            <input
              type="password" required minLength={6} value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary"
            />
          </label>

          {err && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}

          <button disabled={loading} className="h-11 w-full rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      )}

      {done && (
        <p className="mt-8 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
          Password updated. Redirecting…
        </p>
      )}
    </div>
  );
}
