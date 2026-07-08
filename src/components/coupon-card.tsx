import { useState } from "react";
import { Copy, Check, Calendar, Tag, Percent } from "lucide-react";
import { trackClick, type Coupon, type Store } from "@/lib/db";

type Props = { coupon: Coupon; store?: Pick<Store, "name" | "logo_url" | "slug"> };

export function CouponCard({ coupon, store }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isDeal = coupon.coupon_type === "deal";
  const expiry = coupon.expiry_date ? new Date(coupon.expiry_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

  const handleClick = async () => {
    await trackClick(coupon.id, typeof window !== "undefined" ? window.location.pathname : "");
    if (isDeal) {
      if (coupon.affiliate_url) window.open(coupon.affiliate_url, "_blank", "noopener,noreferrer");
      return;
    }
    setOpen(true);
  };

  const copy = async () => {
    if (!coupon.coupon_code) return;
    await navigator.clipboard.writeText(coupon.coupon_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <article className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition hover:border-primary/30 hover:shadow-sm sm:p-5">
        {store?.logo_url ? (
          <img src={store.logo_url} alt={`${store.name} official store logo`} width={56} height={56} loading="lazy" decoding="async" className="h-14 w-14 shrink-0 rounded-xl border border-border bg-background object-contain p-1.5" />
        ) : (
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
            <Tag className="h-6 w-6" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isDeal ? "bg-success-soft text-success" : "bg-primary-soft text-primary"}`}>
              {isDeal ? <><Percent className="h-3 w-3" /> Deal</> : <><Tag className="h-3 w-3" /> Code</>}
            </span>
            {expiry && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" /> Expires {expiry}
              </span>
            )}
          </div>
          <h3 className="truncate font-semibold text-foreground">{coupon.title}</h3>
          {coupon.description && <p className="line-clamp-1 text-sm text-muted-foreground">{coupon.description}</p>}
        </div>

        <button
          onClick={handleClick}
          className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          {isDeal ? "Get Deal" : "Get Code"}
        </button>
      </article>

      {open && !isDeal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-3xl bg-card p-6 shadow-xl sm:p-8" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-muted-foreground">{store?.name ?? "Coupon"}</p>
            <h3 className="mt-1 font-display text-xl font-bold">{coupon.title}</h3>

            <div className="my-6 flex items-stretch gap-0 rounded-2xl border-2 border-dashed border-primary/40 bg-primary-soft p-1">
              <div className="flex-1 px-4 py-3 text-center font-mono text-lg font-bold tracking-wider text-primary">
                {coupon.coupon_code}
              </div>
              <button
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
              </button>
            </div>

            {coupon.terms && (
              <details className="mb-4 text-sm">
                <summary className="cursor-pointer font-medium text-muted-foreground">Terms & conditions</summary>
                <p className="mt-2 text-muted-foreground">{coupon.terms}</p>
              </details>
            )}

            <a
              href={coupon.affiliate_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setTimeout(() => setOpen(false), 300)}
              className="block w-full rounded-full bg-foreground px-5 py-3 text-center text-sm font-semibold text-background hover:opacity-90"
            >
              Continue to {store?.name ?? "store"} →
            </a>
          </div>
        </div>
      )}
    </>
  );
}
