import { Link } from "@tanstack/react-router";

type Props = {
  page: number;
  total: number;
  perPage: number;
  /** Route path the pagination links back to, e.g. "/coupons". */
  to: string;
};

export function Pagination({ page, total, perPage, to }: Props) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === pages || Math.abs(n - page) <= 1,
  );

  const base =
    "inline-flex h-10 min-w-10 items-center justify-center rounded-full border border-border px-3 text-sm font-medium transition-colors";

  return (
    <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 && (
        <Link to={to} search={{ page: page - 1 }} className={`${base} text-muted-foreground hover:bg-hover hover:text-foreground`}>
          Previous
        </Link>
      )}
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-2">
          {i > 0 && n - nums[i - 1]! > 1 && <span className="text-muted-foreground">…</span>}
          <Link
            to={to}
            search={{ page: n }}
            aria-current={n === page ? "page" : undefined}
            className={
              n === page
                ? `${base} border-primary bg-primary text-primary-foreground`
                : `${base} text-muted-foreground hover:bg-hover hover:text-foreground`
            }
          >
            {n}
          </Link>
        </span>
      ))}
      {page < pages && (
        <Link to={to} search={{ page: page + 1 }} className={`${base} text-muted-foreground hover:bg-hover hover:text-foreground`}>
          Next
        </Link>
      )}
    </nav>
  );
}
