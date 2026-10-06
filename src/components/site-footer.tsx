import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer
      id="site-footer"
      data-site-footer
      className="mt-24 border-t border-border bg-secondary/40"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="space-y-2">
          <p>
            © {new Date().getFullYear()} Getyourcodes. Coupons & deals. Owned by{" "}
            <Link to="/about" className="hover:text-foreground">
              Pixorads
            </Link>
            .
          </p>
          <p className="text-xs">
            Getyourcodes may earn a commission when you use certain merchant links.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <Link to="/search" search={{ q: "" }} className="hover:text-foreground">
            Search
          </Link>
          <Link to="/about" className="hover:text-foreground">
            About
          </Link>
          <Link to="/contact" className="hover:text-foreground">
            Contact
          </Link>
          <Link to="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link to="/affiliate-disclosure" className="hover:text-foreground">
            Affiliate Disclosure
          </Link>
        </nav>
      </div>
    </footer>
  );
}
