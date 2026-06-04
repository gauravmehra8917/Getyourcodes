import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tag, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot password — SaveHub" }, { name: "robots", content: "noindex" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset-password",
    });
    setLoading(false);
    if (error) return setErr(error.message);
    setSent(true);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <Link to="/" className="mb-8 inline-flex items-center gap-2 font-display text-xl font-bold">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Tag className="h-5 w-5" />
        </span>
        SaveHub
      </Link>

      <h1 className="font-display text-3xl font-bold">Forgot your password?</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter your email and we'll send you a link to reset it.
      </p>

      {sent ? (
        <div className="mt-8 space-y-4">
          <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
            If an account exists for <strong>{email}</strong>, a reset link is on its way.
            Check your inbox (and spam folder).
          </p>
          <button onClick={() => navigate({ to: "/auth" })} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Email</span>
            <input
              type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary"
            />
          </label>

          {err && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}

          <button disabled={loading} className="h-11 w-full rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {loading ? "Sending…" : "Send reset link"}
          </button>

          <Link to="/auth" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </form>
      )}
    </div>
  );
}
