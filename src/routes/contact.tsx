import { createFileRoute } from "@tanstack/react-router";
import { MapPin, Mail, Building2, Handshake } from "lucide-react";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Us — SaveHub" },
      { name: "description", content: "Get in touch with the SaveHub team. Reach our Singapore office for partnerships and support." },
      { property: "og:title", content: "Contact SaveHub" },
      { property: "og:description", content: "Reach our Singapore office for partnerships and support." },
      { property: "og:url", content: "https://getyourcodes.com/contact" },
    ],
    links: [{ rel: "canonical", href: "https://getyourcodes.com/contact" }],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="text-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
          <Handshake className="h-3.5 w-3.5" /> Contact Us
        </span>
        <h1 className="mt-4 font-display text-4xl font-bold sm:text-5xl">Let's talk.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          Whether you're a brand looking to partner with us, a shopper with feedback, or a media inquiry — we'd love to hear from you.
        </p>
      </section>

      <section className="mt-12 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-7">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <h2 className="font-display text-lg font-semibold">Singapore Office</h2>
          </div>
          <div className="mt-5 flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <p className="text-sm leading-relaxed">
              68 Circular Road, #02-01<br />
              Singapore 049422
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-7">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <h2 className="font-display text-lg font-semibold">Email Us</h2>
          </div>
          <div className="mt-5 flex items-start gap-3">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <a href="mailto:partner@pixorads.com" className="text-sm font-medium text-primary hover:underline">
              partner@pixorads.com
            </a>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">For partnerships, press, and general inquiries.</p>
        </div>
      </section>

      <section className="mt-10 rounded-3xl border border-border bg-secondary/40 p-8 text-center sm:p-10">
        <h2 className="font-display text-xl font-semibold">Partner with SaveHub</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Want to feature your brand's offers to a community of deal-hungry shoppers? Drop us a line and our team will get back to you within 2 business days.
        </p>
        <a href="mailto:partner@pixorads.com" className="mt-6 inline-flex rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Email partner@pixorads.com
        </a>
      </section>
    </div>
  );
}
