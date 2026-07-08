import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Admin login — SaveHub" },
      { name: "description", content: "Sign in to manage stores, coupons & categories. Admin accounts are provisioned by invitation only." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/admin" });
    } catch {
      setErr("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-3xl font-bold">Admin login</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Sign in to manage stores, coupons & categories. Admin accounts are provisioned by invitation only.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Email" type="email" value={email} onChange={setEmail} required />
        <Field label="Password" type="password" value={password} onChange={setPassword} required />
        {err && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
        <button disabled={loading} className="w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {loading ? "Please wait…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, type, value, onChange, required }: { label: string; type: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-input bg-card px-4 outline-none focus:border-primary"
      />
    </label>
  );
}
