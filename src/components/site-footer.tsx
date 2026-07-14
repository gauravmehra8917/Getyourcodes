import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer id="site-footer" data-site-footer className="mt-24 border-t border-border bg-secondary/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} Getyourcodes — Verified coupons & deals.</p>
        <div className="flex flex-wrap gap-6">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <Link to="/search" search={{ q: "" }} className="hover:text-foreground">Search</Link>
          <Link to="/about" className="hover:text-foreground">About</Link>
          <Link to="/contact" className="hover:text-foreground">Contact</Link>
          <Link to="/admin" className="hover:text-foreground">Admin</Link>
        </div>
      </div>
    </footer>
  );
}
