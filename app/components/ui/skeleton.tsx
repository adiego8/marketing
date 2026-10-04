import { surface } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * Loading placeholders that hold the shape of what is arriving.
 *
 * Mirrors car-sales-os/components/ui/Skeleton.tsx — `Skeleton`, `CardSkeleton`,
 * `ListSkeleton` — plus a `TableSkeleton`, because this app has a real `<table>`
 * on the clients list that theirs does not.
 *
 * The composed shapes are built from the same `surface.*` tokens as the things
 * they stand in for, so a list skeleton and the list itself cannot drift apart:
 * both get their border, radius and dividers from one definition.
 *
 * Blocks are slate-200 rather than the `--muted` token, which is slate-100 and
 * vanishes against the white card surfaces these sit on.
 *
 * `animate-pulse` is already neutralised by globals.css's
 * `prefers-reduced-motion` block. The blocks stay visible and simply stop
 * breathing, which is the right answer and needs no code here.
 */

/** One block. `className` sets its size; nothing else is styled. */
export function Skeleton({ className }: { className?: string }) {
  // Decorative. A list skeleton renders a dozen of these, and a screen reader
  // announcing "loading" a dozen times is worse than saying nothing at all —
  // the group below announces once, on everyone's behalf.
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded bg-slate-200", className)}
    />
  );
}

/**
 * The single announcement for a group of blocks. Every composed skeleton wraps
 * itself in this, so assistive tech hears "Loading…" exactly once per region.
 */
function SkeletonGroup({
  children,
  className,
  label = "Loading…",
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Lines of prose. The last one is short, the way a wrapped paragraph ends. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <SkeletonGroup className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === lines - 1 ? "w-2/5" : "w-full")}
        />
      ))}
    </SkeletonGroup>
  );
}

/** Rows inside `surface.list` — bordered, divided, white. */
export function ListSkeleton({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <SkeletonGroup className={cn(surface.list, className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 px-5 py-3.5"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** Header plus rows inside `surface.table`, matching `table.head` / `table.cell`. */
export function TableSkeleton({
  columns = 4,
  rows = 5,
  className,
}: {
  columns?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <SkeletonGroup className={cn(surface.table, className)}>
      <div className="flex gap-4 bg-stone-50 px-4 py-2.5">
        {Array.from({ length: columns }).map((_, c) => (
          <Skeleton key={c} className="h-3 w-20 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-t border-slate-100 px-4 py-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              // The first column is the name, and a name is wider than what
              // follows it. Uniform bars read as a spreadsheet, not a list.
              className={cn("h-4 flex-1", c === 0 ? "w-32" : "w-20 opacity-70")}
            />
          ))}
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** A `surface.card` body — a title, a line of meta, and some prose. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <SkeletonGroup className={cn(surface.card, surface.pad, className)}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3 w-1/4" />
        </div>
        <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </SkeletonGroup>
  );
}
