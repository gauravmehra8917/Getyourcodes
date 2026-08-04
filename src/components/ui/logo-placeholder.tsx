import { Tag as TagIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Consistent brand/merchant logo slot. Renders a fixed-size box so images
 * never cause layout shift, and falls back to a neutral icon tile.
 */
export function LogoPlaceholder({
  src,
  alt,
  size = 56,
  className,
}: {
  src?: string | null;
  alt: string;
  size?: number;
  className?: string;
}) {
  const box = cn(
    "grid shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface",
    className,
  );
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={{ width: size, height: size }}
        className={cn(box, "object-contain p-2")}
      />
    );
  }
  return (
    <span className={box} style={{ width: size, height: size }} aria-hidden="true">
      <TagIcon className="h-1/3 w-1/3 text-muted-foreground" />
    </span>
  );
}
