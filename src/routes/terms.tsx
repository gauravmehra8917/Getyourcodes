import { createFileRoute, Link } from "@tanstack/react-router";
import { abs } from "@/lib/seo";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — Getyourcodes" },
      {
        name: "description",
        content:
          "Read the terms for using Getyourcodes, including changing offers, merchant purchases, responsible account use, affiliate links and Dealio AI.",
      },
      { property: "og:title", content: "Terms of Use — Getyourcodes" },
      {
        property: "og:description",
        content:
          "Plain-language terms for coupon and deal discovery, merchant links, user accounts and Dealio.",
      },
      { property: "og:url", content: abs("/terms") },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: abs("/terms") }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Terms of Use</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: 5 October 2026</p>
        <p className="mt-6 leading-relaxed text-muted-foreground">
          Getyourcodes is owned and operated by Pixorads. By using the site, you agree to these
          terms. If you do not agree, please stop using the service.
        </p>
      </header>

      <div className="mt-10 space-y-8 leading-relaxed text-muted-foreground">
        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">
            Coupon and deal discovery
          </h2>
          <p className="mt-3">
            Getyourcodes provides information to help you discover coupons and deals. Offers, codes,
            prices, availability and merchant terms can change. We aim to keep information useful
            and current, but cannot guarantee that every coupon will work at every moment or that
            every listing will be complete or accurate.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">
            Purchases and external websites
          </h2>
          <p className="mt-3">
            Purchases and checkout happen on merchant websites, under the merchant's terms. Check
            the final price, eligibility, exclusions and other conditions at checkout before
            purchasing. Merchant terms control the actual purchase, including payment, delivery,
            returns and refunds. Getyourcodes does not operate those external websites or control
            their content, availability or privacy practices.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">
            Affiliate relationships
          </h2>
          <p className="mt-3">
            Some merchant links are affiliate links, and Pixorads/Getyourcodes may receive a
            commission after qualifying activity. The merchant sets the purchase price. See our{" "}
            <Link to="/affiliate-disclosure" className="text-primary underline underline-offset-4">
              Affiliate Disclosure
            </Link>{" "}
            for details.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">
            Accounts and responsible use
          </h2>
          <p className="mt-3">
            Keep your account details accurate and your sign-in credentials secure. You are
            responsible for activity through your account. Use the service lawfully and respect
            other users. Do not use automated abuse or unauthorized scraping, attempt to access
            other accounts, bypass access controls or interfere with the service.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">Using Dealio</h2>
          <p className="mt-3">
            Dealio is an AI shopping assistant and may make mistakes or provide outdated
            information. Its responses should not be treated as authoritative merchant information.
            Confirm offer details and purchase conditions on the merchant's website.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">
            Content and ownership
          </h2>
          <p className="mt-3">
            Site design, branding and original content belong to Pixorads or their respective
            owners. Merchant names, logos and offer materials remain the property of their
            respective owners. Using the service does not transfer ownership or grant permission to
            reproduce protected materials beyond what their owners or applicable law allow.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">
            Service availability and limitations
          </h2>
          <p className="mt-3">
            Features and these terms may change, and the service may occasionally be unavailable. We
            provide the service and discovery information as available, without promising
            uninterrupted access or a particular saving. You are responsible for checking whether an
            offer suits your needs before acting on it. These terms do not limit rights that cannot
            be excluded under applicable law.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-foreground">Contact</h2>
          <p className="mt-3">
            Questions about these terms can be sent to{" "}
            <a
              className="text-primary underline underline-offset-4"
              href="mailto:partner@pixorads.com"
            >
              partner@pixorads.com
            </a>
            . The date above identifies the latest revision.
          </p>
        </section>
      </div>
    </article>
  );
}
