import { Link } from "@tanstack/react-router";
import { Tag } from "lucide-react";
import type { Store } from "@/lib/db";

export function StoreCard({ store, count }: { store: Store; count?: number }) {
  return (
    <Link
      to="/$slug"
      params={{ slug: `${store.slug}-coupons` }}
      className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 text-center transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      {store.logo_url ? (
        <img src={store.logo_url} alt={store.name} className="h-16 w-16 rounded-xl border border-border bg-background object-contain p-2" />
      ) : (
        <div className="grid h-16 w-16 place-items-center rounded-xl bg-primary-soft text-primary">
          <Tag className="h-7 w-7" />
        </div>
      )}
      <div>
        <p className="font-semibold text-foreground">{store.name}</p>
        {typeof count === "number" && <p className="text-xs text-muted-foreground">{count} offers</p>}
      </div>
    </Link>
  );
}
