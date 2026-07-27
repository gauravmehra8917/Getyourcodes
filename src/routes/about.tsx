import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, Sparkles, Users, ShieldCheck, Tag, HeartHandshake, Building2, ShoppingBag, Lock } from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Us — Getyourcodes" },
      { name: "description", content: "Getyourcodes helps shoppers save more with hand-picked, verified coupons and deals from trusted brands worldwide." },
      { property: "og:title", content: "About Getyourcodes" },
      { property: "og:description", content: "Hand-picked, verified coupons and deals from trusted brands worldwide." },
      { property: "og:url", content: "https://getyourcodes.com/about" },
    ],
    links: [{ rel: "canonical", href: "https://getyourcodes.com/about" }],
  }),
  component: AboutPage,
});

function Feature({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="mt-4 font-display text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="text-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" /> About Getyourcodes
        </span>
        <h1 className="mt-4 font-display text-4xl font-bold sm:text-5xl">Smarter savings, made simple.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          Getyourcodes helps shoppers discover verified coupons, promo codes, and the latest deals from trusted
          brands. Our goal is to make saving money simple, transparent, and reliable.
        </p>
      </section>

      <section className="mt-12 rounded-3xl border border-border bg-secondary/40 p-8 sm:p-10">
        <div className="flex flex-col items-start gap-4 sm:flex-row">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold">Owned by Pixoads</h2>
            <p className="mt-3 text-muted-foreground">
              Getyourcodes is a product of Pixoads, our parent company focused on building digital products that help
              consumers save money and make smarter online purchasing decisions.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <Feature icon={BadgeCheck} title="Verified Coupons">
          We carefully review and publish coupons from trusted brands.
        </Feature>
        <Feature icon={ShoppingBag} title="Trusted Brands">
          Browse deals from well-known online stores and services.
        </Feature>
        <Feature icon={Lock} title="Transparent Savings">
          No misleading discounts or hidden conditions — just clear savings.
        </Feature>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <Feature icon={ShieldCheck} title="Safe & transparent">
          No hidden steps, no spammy redirects — just clean codes and clear terms from brands you can trust.
        </Feature>
        <Feature icon={Tag} title="Curated, not cluttered">
          We surface the deals worth your time, across fashion, food, electronics, travel and more.
        </Feature>
        <Feature icon={HeartHandshake} title="Built for shoppers">
          Save favorites, get the freshest drops first, and shop with confidence — Getyourcodes is on your side.
        </Feature>
        <Feature icon={Users} title="Reviewed before publishing">
          Offers are checked before they go live, and we remove them as soon as we learn they no longer work.
        </Feature>
      </section>


      <section className="mt-14 rounded-3xl border border-border bg-secondary/40 p-8 sm:p-10">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold">Our story</h2>
            <p className="mt-3 text-muted-foreground">
              Getyourcodes started with a small team obsessed with finding the best deals on the internet — and frustrated
              by sites cluttered with expired codes. We built the experience we wanted: clean, fast, honest, and free.
              Today, shoppers from around the world rely on us to stretch their budgets a little further.
            </p>
            <p className="mt-3 text-muted-foreground">
              We work directly with brands and partners to bring you exclusive offers you won't easily find elsewhere.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-14 text-center">
        <h2 className="font-display text-2xl font-semibold">Have a question or partnership idea?</h2>
        <p className="mx-auto mt-2 max-w-xl text-muted-foreground">We'd love to hear from you.</p>
        <Link to="/contact" className="mt-6 inline-flex rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Get in touch
        </Link>
      </section>
    </div>
  );
}
