import { useState } from "react";
import { Copy, Check, Calendar, Tag, Percent, Globe, ExternalLink, Sparkles } from "lucide-react";
import { trackClick, type Coupon, type Store } from "@/lib/db";
import { formatDiscount, formatStructuredTerms, structuredTermsText } from "@/lib/presentation/terms";

type Props = {
  coupon: Coupon;
  store?: Pick<Store, "name" | "logo_url" | "slug"> & { country?: string | null };
  /** Highlights the strongest offer from a store. */
  best?: boolean;
};

export function CouponCard({ coupon, store, best }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isDeal = coupon.coupon_type === "deal";
  const expiry = coupon.expiry_date
    ? new Date(coupon.expiry_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;
  const discount = formatDiscount(coupon.discount_type, coupon.discount_value);
  const termRows = formatStructuredTerms(coupon.structured_terms);
  const termsText = coupon.terms ?? structuredTermsText(coupon.structured_terms);
  const landingPage = coupon.landing_page_url ?? null;
  const country = store?.country ?? null;

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
      <article
        id={coupon.id}
        className={`group flex items-center gap-4 rounded-2xl border bg-card p-4 transition hover:shadow-sm sm:p-5 ${
          best ? "border-primary/60 ring-1 ring-primary/20" : "border-border hover:border-primary/30"
        }`}
      >
        {store?.logo_url ? (
          <img src={store.logo_url} alt={`${store.name} official store logo`} width={56} height={56} loading="lazy" decoding="async" className="h-14 w-14 shrink-0 rounded-xl border border-border bg-background object-contain p-1.5" />
        ) : (
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
            <Tag className="h-6 w-6" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isDeal ? "bg-success-soft text-success" : "bg-primary-soft text-primary"}`}>
              {isDeal ? <><Percent className="h-3 w-3" /> Deal</> : <><Tag className="h-3 w-3" /> Code</>}
            </span>
            {discount && (
              <span className="inline-flex items-center rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">
                {discount}
              </span>
            )}
            {best && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                <Sparkles className="h-3 w-3" /> Best offer
              </span>
            )}
            {!isDeal && coupon.coupon_code && (
              <span className="rounded-md border border-dashed border-primary/40 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-primary">
                {coupon.coupon_code.length > 3 ? `${coupon.coupon_code.slice(0, 3)}•••` : coupon.coupon_code}
              </span>
            )}
            {country && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                <Globe className="h-3 w-3" /> {country}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" /> {expiry ? `Expires ${expiry}` : "No expiry date"}
            </span>
          </div>
          <h3 className="truncate font-semibold text-foreground">{coupon.title}</h3>
          <p className="line-clamp-1 text-sm text-muted-foreground">
            {coupon.description ?? (store?.name ? `Verified offer at ${store.name}.` : "Verified offer.")}
          </p>
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
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-3xl bg-card p-6 shadow-xl sm:p-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              {store?.logo_url && (
                <img src={store.logo_url} alt={`${store.name} logo`} width={40} height={40} className="h-10 w-10 rounded-lg border border-border bg-background object-contain p-1" />
              )}
              <div>
                <p className="text-sm text-muted-foreground">{store?.name ?? "Coupon"}</p>
                {discount && <p className="text-xs font-semibold text-primary">{discount}</p>}
              </div>
            </div>
            <h3 className="mt-3 font-display text-xl font-bold">{coupon.title}</h3>
            {coupon.description && <p className="mt-1 text-sm text-muted-foreground">{coupon.description}</p>}

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

            {termRows.length > 0 && (
              <dl className="mb-4 grid gap-1 rounded-2xl border border-border bg-secondary/30 p-4 text-sm">
                {termRows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="font-medium text-foreground">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {termsText && (
              <details className="mb-4 text-sm">
                <summary className="cursor-pointer font-medium text-muted-foreground">Terms & conditions</summary>
                <p className="mt-2 text-muted-foreground">{termsText}</p>
              </details>
            )}

            {expiry && <p className="mb-4 text-xs text-muted-foreground">Valid until {expiry}</p>}

            <a
              href={coupon.affiliate_url ?? landingPage ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setTimeout(() => setOpen(false), 300)}
              className="block w-full rounded-full bg-foreground px-5 py-3 text-center text-sm font-semibold text-background hover:opacity-90"
            >
              Continue to {store?.name ?? "store"} →
            </a>

            {landingPage && (
              <p className="mt-3 flex items-center justify-center gap-1 truncate text-xs text-muted-foreground">
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{landingPage.replace(/^https?:\/\//, "")}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
