import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Tag, Heart } from "lucide-react";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({ meta: [{ title: "My account — SaveHub" }, { name: "robots", content: "noindex" }] }),
  component: AccountPage,
});

type Profile = { id: string; display_name: string | null; avatar_url: string | null };
type SavedCoupon = { coupon_id: string; coupons: { id: string; title: string; store_id: string; stores: { name: string; slug: string } | null } | null };
type SavedStore = { store_id: string; stores: { id: string; name: string; slug: string; logo_url: string | null } | null };

function AccountPage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string>("");
  const [displayName, setDisplayName] = useState("");
  const [savedCoupons, setSavedCoupons] = useState<SavedCoupon[]>([]);
  const [savedStores, setSavedStores] = useState<SavedStore[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      setEmail(userData.user.email ?? "");
      const [{ data: p }, { data: sc }, { data: ss }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userData.user.id).maybeSingle(),
        supabase.from("saved_coupons").select("coupon_id, coupons(id, title, store_id, stores(name, slug))").order("created_at", { ascending: false }),
        supabase.from("saved_stores").select("store_id, stores(id, name, slug, logo_url)").order("created_at", { ascending: false }),
      ]);
      setProfile(p as Profile | null);
      setDisplayName((p as Profile | null)?.display_name ?? "");
      setSavedCoupons((sc ?? []) as unknown as SavedCoupon[]);
      setSavedStores((ss ?? []) as unknown as SavedStore[]);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userData.user.id, display_name: displayName });
    setSaving(false);
    setMsg(error ? error.message : "Saved.");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const unsaveCoupon = async (id: string) => {
    await supabase.from("saved_coupons").delete().eq("coupon_id", id);
    setSavedCoupons((cs) => cs.filter((c) => c.coupon_id !== id));
  };
  const unsaveStore = async (id: string) => {
    await supabase.from("saved_stores").delete().eq("store_id", id);
    setSavedStores((cs) => cs.filter((c) => c.store_id !== id));
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">My account</h1>
          <p className="mt-1 text-sm text-muted-foreground">{email}</p>
        </div>
        <button onClick={signOut} className="inline-flex items-center gap-2 rounded-full border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-secondary">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>

      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-lg font-semibold">Profile</h2>
        <div className="mt-4 flex items-center gap-4">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" width={56} height={56} loading="lazy" decoding="async" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="grid h-14 w-14 place-items-center rounded-full bg-primary-soft text-primary font-semibold">
              {(displayName || email || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <label className="flex-1">
            <span className="mb-1.5 block text-sm font-medium">Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background px-4 outline-none focus:border-primary"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {saving ? "Saving…" : "Save changes"}
          </button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Heart className="h-4 w-4 text-primary" /> Saved coupons</h2>
        {savedCoupons.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No saved coupons yet. Tap the heart on any coupon to save it.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {savedCoupons.map((s) => (
              <li key={s.coupon_id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.coupons?.title ?? "Coupon"}</p>
                  {s.coupons?.stores && (
                    <Link to="/$slug" params={{ slug: `${s.coupons.stores.slug}-coupons` }} className="text-xs text-muted-foreground hover:text-primary">
                      {s.coupons.stores.name}
                    </Link>
                  )}
                </div>
                <button onClick={() => unsaveCoupon(s.coupon_id)} className="text-xs text-muted-foreground hover:text-destructive">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Tag className="h-4 w-4 text-primary" /> Saved stores</h2>
        {savedStores.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No saved stores yet.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {savedStores.map((s) => s.stores && (
              <li key={s.store_id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <Link to="/$slug" params={{ slug: `${s.stores.slug}-coupons` }} className="flex min-w-0 flex-1 items-center gap-2">
                  {s.stores.logo_url ? <img src={s.stores.logo_url} alt="" width={32} height={32} loading="lazy" decoding="async" className="h-8 w-8 rounded object-contain" /> : <Tag className="h-5 w-5 text-primary" />}
                  <span className="truncate text-sm font-medium">{s.stores.name}</span>
                </Link>
                <button onClick={() => unsaveStore(s.store_id)} className="text-xs text-muted-foreground hover:text-destructive">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
