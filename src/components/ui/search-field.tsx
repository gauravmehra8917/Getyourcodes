import { Search } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/** Shared search input styling used by the header, search page and admin tables. */
export const SearchField = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={ref}
        type="search"
        className={cn(
          "h-10 w-full rounded-full border border-input bg-surface pl-9 pr-4 text-sm text-foreground transition-[border-color] duration-150 placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
SearchField.displayName = "SearchField";
