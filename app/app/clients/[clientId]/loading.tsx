import { Skeleton } from "@/components/ui/skeleton";
import { CardSkeleton } from "@/components/ui/skeleton";

/**
 * Shown while a client route's module loads, before its own fetch even starts.
 *
 * This renders inside `layout.tsx`, which is where `AppShell` lives, so the
 * rail stays exactly where it is and only the content area is a placeholder.
 *
 * There is deliberately no equivalent at the app root: `/` and `/settings`
 * mount `AppShell` inside the page component rather than a layout, so a sibling
 * `loading.tsx` would blank the rail on every visit. Those two routes are
 * covered by the rail's own pending spinner instead.
 */
export default function ClientRouteLoading() {
  return (
    <div className="max-w-5xl">
      {/* The same shape PageHeader draws: title, description, rule. */}
      <div className="mb-6 space-y-2 border-b border-slate-200 pb-5">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
