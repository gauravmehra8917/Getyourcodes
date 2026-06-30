import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, Sparkles, Users, ShieldCheck, Tag, HeartHandshake } from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Us — SaveHub" },
      { name: "description", content: "SaveHub helps shoppers save more with hand-picked, verified coupons and deals from trusted brands worldwide." },
      { property: "og:title", content: "About SaveHub" },
      { property: "og:description", content: "Hand-picked, verified coupons and deals from trusted brands worldwide." },
      { property: "og:url", content: "https://dealio-dash.lovable.app/about" },
    ],
    links: [{ rel: "canonical", href: "https://dealio-dash.lovable.app/about" }],
  }),
  component: AboutPage,
});

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-center">
      <p className="font-display text-3xl font-bold text-primary">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function Feature({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="text-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" /> About SaveHub
        </span>
        <h1 className="mt-4 font-display text-4xl font-bold sm:text-5xl">Smarter savings, every single day.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          SaveHub is a destination for savvy shoppers — a curated home for verified coupons, promo codes,
          and deals from the brands you love. Our mission is simple: help you never pay full price again.
        </p>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <Stat value="5,000+" label="Verified coupons" />
        <Stat value="1,200+" label="Trusted stores" />
        <Stat value="Daily" label="Hand-picked updates" />
      </section>

      <section className="mt-14 grid gap-4 sm:grid-cols-2">
        <Feature icon={BadgeCheck} title="Verified by humans">
          Every coupon is reviewed by our editorial team before it goes live, so what you see actually works at checkout.
        </Feature>
        <Feature icon={ShieldCheck} title="Safe & transparent">
          No hidden steps, no spammy redirects — just clean codes and clear terms from brands you can trust.
        </Feature>
        <Feature icon={Tag} title="Curated, not cluttered">
          We surface the deals worth your time, across fashion, food, electronics, travel and more.
        </Feature>
        <Feature icon={HeartHandshake} title="Built for shoppers">
          Save favorites, get the freshest drops first, and shop with confidence — SaveHub is on your side.
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
              SaveHub started with a small team obsessed with finding the best deals on the internet — and frustrated
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
