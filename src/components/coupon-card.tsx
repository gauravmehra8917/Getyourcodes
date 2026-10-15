import { useRef, useState } from "react";
import { Copy, Check, Calendar, Tag, Percent, Globe, ExternalLink, Sparkles } from "lucide-react";
import { type Coupon, type Store } from "@/lib/db";
import { activateCoupon } from "@/lib/coupon-actions";
import { copyCouponCode, isEmbeddedFrame } from "@/lib/presentation/clipboard";
import {
  formatDiscount,
  hasDiscountTypeConflict,
  humanizeProviderTerms,
  formatStructuredTerms,
  structuredTermsText,
} from "@/lib/presentation/terms";
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Props = {
  coupon: Coupon;
  store?: Pick<Store, "name" | "logo_url" | "slug"> & { country?: string | null };
  /** Highlights the strongest offer from a store. */
  best?: boolean;
  /** "row" = horizontal list row (default), "tile" = compact vertical card. */
  variant?: "row" | "tile";
};

export function CouponCard({ coupon, store, best, variant = "row" }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const couponCodeRef = useRef<HTMLDivElement>(null);

  const isDeal = coupon.coupon_type === "deal";
  const expiry = coupon.expiry_date
    ? new Date(coupon.expiry_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;
  const discountConflict = hasDiscountTypeConflict(
    coupon.title,
    coupon.description,
    coupon.discount_type,
    coupon.discount_value,
  );
  const discount = discountConflict
    ? null
    : formatDiscount(coupon.discount_type, coupon.discount_value);
  const displayTitle = discountConflict ? "Offer details require verification" : coupon.title;
  const displayDescription = discountConflict
    ? "The reported discount details are inconsistent. Confirm the actual offer with the merchant before purchase."
    : coupon.description;
  const termRows = formatStructuredTerms(coupon.structured_terms);
  const termsText =
    humanizeProviderTerms(coupon.terms) ?? structuredTermsText(coupon.structured_terms);
  const landingPage = coupon.landing_page_url ?? null;
  const country = store?.country ?? null;

  const renderAction = (className: string) => {
    const button = (
      <button onClick={() => void activateCoupon(coupon)} className={className}>
        {isDeal ? "Get Deal" : "Get Code"}
      </button>
    );
    return isDeal ? button : <DialogTrigger asChild>{button}</DialogTrigger>;
  };

  const copy = async () => {
    const success = await copyCouponCode(coupon.coupon_code ?? "");
    setCopied(success);
    setCopyFailed(!success);
    if (success) {
      setTimeout(() => setCopied(false), 1800);
      return;
    }

    // Make the code ready for keyboard copying when an iframe blocks the APIs.
    const codeElement = couponCodeRef.current;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (codeElement && selection) {
      const range = document.createRange();
      range.selectNodeContents(codeElement);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  return (
    <Dialog open={open && !isDeal} onOpenChange={setOpen}>
      {variant === "tile" ? (
        <article
          id={coupon.id}
          className={`group flex h-full min-w-0 max-w-full flex-col rounded-2xl border bg-card p-4 transition hover:-translate-y-0.5 hover:shadow-md ${
            best
              ? "border-primary/60 ring-1 ring-primary/20"
              : "border-border hover:border-primary/30"
          }`}
        >
          <div className="flex flex-wrap items-start gap-3">
            {store?.logo_url ? (
              <img
                src={store.logo_url}
                alt={`${store.name} official store logo`}
                width={40}
                height={40}
                loading="lazy"
                decoding="async"
                className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background object-contain p-1"
              />
            ) : (
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                <Tag className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-muted-foreground">
                {store?.name ?? "Offer"}
              </p>
              <span
                className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isDeal ? "bg-success-soft text-success" : "bg-primary-soft text-primary"}`}
              >
                {isDeal ? (
                  <>
                    <Percent className="h-3 w-3" /> Deal
                  </>
                ) : (
                  <>
                    <Tag className="h-3 w-3" /> Code
                  </>
                )}
              </span>
            </div>
            {discount && (
              <span className="max-w-full rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background [overflow-wrap:anywhere]">
                {discount}
              </span>
            )}
          </div>

          <h3
            title={displayTitle}
            className="mt-3 line-clamp-3 text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere] sm:line-clamp-2"
          >
            {displayTitle}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!isDeal && coupon.coupon_code && (
              <span className="rounded-md border border-dashed border-primary/40 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-primary">
                {coupon.coupon_code.length > 3
                  ? `${coupon.coupon_code.slice(0, 3)}•••`
                  : coupon.coupon_code}
              </span>
            )}
            {expiry && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" /> {expiry}
              </span>
            )}
          </div>

          {discountConflict && (
            <p className="mt-2 text-xs coupon-warning" role="status">
              Verify discount with merchant
            </p>
          )}

          {renderAction(
            "mt-4 min-h-11 w-full rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90",
          )}
        </article>
      ) : (
        <article
          id={coupon.id}
          className={`coupon-row group min-w-0 max-w-full rounded-2xl border bg-card p-4 transition hover:shadow-sm sm:p-5 ${
            best
              ? "border-primary/60 ring-1 ring-primary/20"
              : "border-border hover:border-primary/30"
          }`}
        >
          <div className="coupon-row-layout">
            {store?.logo_url ? (
              <img
                src={store.logo_url}
                alt={`${store.name} official store logo`}
                width={56}
                height={56}
                loading="lazy"
                decoding="async"
                className="h-14 w-14 shrink-0 rounded-xl border border-border bg-background object-contain p-1.5"
              />
            ) : (
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <Tag className="h-6 w-6" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isDeal ? "bg-success-soft text-success" : "bg-primary-soft text-primary"}`}
                >
                  {isDeal ? (
                    <>
                      <Percent className="h-3 w-3" /> Deal
                    </>
                  ) : (
                    <>
                      <Tag className="h-3 w-3" /> Code
                    </>
                  )}
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
                    {coupon.coupon_code.length > 3
                      ? `${coupon.coupon_code.slice(0, 3)}•••`
                      : coupon.coupon_code}
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
              <h3
                title={displayTitle}
                className="line-clamp-3 font-semibold leading-snug text-foreground [overflow-wrap:anywhere]"
              >
                {displayTitle}
              </h3>
              <p className="coupon-row-description line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {displayDescription ??
                  (store?.name ? `Verified offer at ${store.name}.` : "Verified offer.")}
              </p>
              {discountConflict && (
                <p role="status" className="mt-1 text-xs coupon-warning">
                  Verify discount
                </p>
              )}
            </div>

            {renderAction(
              "coupon-row-action min-h-11 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90",
            )}
          </div>
        </article>
      )}

      {!isDeal && (
        <DialogContent className="coupon-dialog top-[calc(1rem+env(safe-area-inset-top))] block max-w-md translate-y-0 overflow-y-auto overscroll-contain rounded-3xl bg-card p-5 shadow-xl [overflow-wrap:anywhere] sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-8 [&>button:last-child]:right-2 [&>button:last-child]:top-2 [&>button:last-child]:grid [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:place-items-center [&>button:last-child]:rounded-full">
          <div className="flex min-w-0 items-center gap-3 pr-10">
            {store?.logo_url && (
              <img
                src={store.logo_url}
                alt={`${store.name} logo`}
                width={40}
                height={40}
                className="h-10 w-10 shrink-0 rounded-lg border border-border bg-background object-contain p-1"
              />
            )}
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{store?.name ?? "Coupon"}</p>
              {discount && <p className="text-xs font-semibold text-primary">{discount}</p>}
            </div>
          </div>
          <DialogTitle className="mt-3 pr-6 font-display text-xl font-bold leading-snug">
            {displayTitle}
          </DialogTitle>
          <DialogDescription
            className={displayDescription ? "mt-1 text-sm text-muted-foreground" : "sr-only"}
          >
            {displayDescription || "Copy this coupon code and continue to the store to use it."}
          </DialogDescription>

          <div className="my-5 flex min-w-0 flex-col items-stretch rounded-2xl border-2 border-dashed border-primary/40 bg-primary-soft p-1 sm:flex-row">
            <div
              ref={couponCodeRef}
              className="min-w-0 flex-1 select-text px-3 py-3 text-center font-mono text-lg font-bold tracking-wider text-glow [overflow-wrap:anywhere]"
            >
              {coupon.coupon_code}
            </div>
            <button
              onClick={copy}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy
                </>
              )}
            </button>
          </div>

          {copyFailed && (
            <p role="alert" className="mb-4 text-sm coupon-warning">
              {isEmbeddedFrame()
                ? "Automatic copying is blocked in this embedded preview. The code is selected; press ⌘C on Mac or Ctrl+C on Windows to copy it, or open the preview in a new tab."
                : "Automatic copying was blocked. The code is selected; press ⌘C on Mac or Ctrl+C on Windows, or open the preview in a new tab."}
            </p>
          )}

          {discountConflict && (
            <p role="status" className="mb-4 rounded-lg border border-amber-300 p-3 text-sm">
              Discount amount requires verification. Check the merchant's current terms before
              purchasing.
            </p>
          )}

          {termRows.length > 0 && (
            <dl className="mb-4 grid gap-1 rounded-2xl border border-border bg-secondary/30 p-4 text-sm">
              {termRows.map((r) => (
                <div
                  key={r.label}
                  className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-3"
                >
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="min-w-0 font-medium text-foreground sm:text-right">{r.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {termsText && (
            <details className="mb-4 text-sm">
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-muted-foreground">
                Terms & conditions
              </summary>
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
          <DialogClose asChild>
            <button
              type="button"
              className="mt-3 min-h-11 w-full rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-hover"
            >
              Close
            </button>
          </DialogClose>
        </DialogContent>
      )}
    </Dialog>
  );
}
