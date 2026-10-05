import { createFileRoute } from "@tanstack/react-router";
import { abs } from "@/lib/seo";

export const Route = createFileRoute("/affiliate-disclosure")({
  head: () => ({
    meta: [
      { title: "Affiliate Disclosure — Getyourcodes" },
      {
        name: "description",
        content:
          "Understand how affiliate links support Getyourcodes, when Pixorads may earn a commission, and why merchant prices and offer terms matter.",
      },
      { property: "og:title", content: "Affiliate Disclosure — Getyourcodes" },
      {
        property: "og:description",
        content:
          "How affiliate commissions support Getyourcodes across coupons, deals and store links.",
      },
      { property: "og:url", content: abs("/affiliate-disclosure") },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: abs("/affiliate-disclosure") }],
  }),
  component: AffiliateDisclosurePage,
});

function AffiliateDisclosurePage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Affiliate Disclosure</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: 5 October 2026</p>
        <p className="mt-6 leading-relaxed text-muted-foreground">
          Getyourcodes is owned and operated by Pixorads and participates in affiliate programs.
          This disclosure applies across the site, including coupons, deals and store links.
        </p>
      </header>

      <div className="mt-10 space-y-8 leading-relaxed text-muted-foreground">
        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">
            How affiliate links work
          </h2>
          <p className="mt-3">
            Some outbound merchant links are affiliate links. When you use one,
            Pixorads/Getyourcodes may receive a commission after qualifying activity, such as an
            eligible purchase. The purchase price is set by the merchant.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">
            Compensation and offer information
          </h2>
          <p className="mt-3">
            Compensation does not guarantee placement or a positive recommendation. Coupon and deal
            availability can change, and a listing does not guarantee that an offer will work for
            every shopper. Merchant terms prevail; confirm prices, eligibility and conditions on the
            merchant's website before purchasing.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">Questions</h2>
          <p className="mt-3">
            For questions about affiliate relationships, contact{" "}
            <a
              className="text-primary underline underline-offset-4"
              href="mailto:partner@pixorads.com"
            >
              partner@pixorads.com
            </a>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
