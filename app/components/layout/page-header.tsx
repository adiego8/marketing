import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { backLink } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * The top of a page: title, one line of orientation, and the page's actions.
 *
 * Mirrors car-sales-os/components/layout/PageHeader.tsx — same props, same
 * proportions — so the two products' pages open the same way.
 *
 * The title carries no weight class. globals.css gives every `h1` Plus Jakarta
 * Sans through an element selector, and that face only ships 700/800, so the
 * weight comes from the font rather than a utility. Adding `font-semibold`
 * would ask for a 600 that does not exist and get a synthesised one.
 *
 * Size is fixed at 24px rather than `text-2xl sm:text-3xl`: a page title that
 * grows on desktop is the widest part of the "oversized and sparse" problem,
 * and CarLeadPro's is a flat 24px.
 */
interface PageHeaderBase {
  /**
   * A ReactNode rather than a string: a detail page's orientation is often two
   * elements — a sentence and a line of metadata — not one sentence. A bare
   * string still gets the muted paragraph treatment.
   */
  description?: ReactNode;
  actions?: ReactNode;
  /** Up one level. Renders above the title, so the title stays the anchor. */
  back?: { href: string; label: string };
  /** Sits on the title's baseline — a status pill, typically. */
  badge?: ReactNode;
  className?: string;
}

/**
 * A detail page does not know its own title until its fetch lands. Rather than
 * blanking the whole page — which is what the early `return <p>Loading…</p>`
 * used to do — it renders the header with a placeholder where the title goes,
 * so the frame is there from the first paint and nothing jumps afterwards.
 *
 * Expressed as a union so the two states are exclusive: either you have a
 * title, or you say you are still waiting for one. A missing `title` cannot
 * silently render as a permanent skeleton.
 */
export type PageHeaderProps = PageHeaderBase &
  ({ title: string; titleSkeleton?: false } | { title?: never; titleSkeleton: true });

export function PageHeader({
  title,
  titleSkeleton,
  description,
  actions,
  back,
  badge,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-6 border-b border-slate-200 pb-5", className)}>
      {back && (
        <Link href={back.href} className={cn(backLink, "mb-3")}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            {titleSkeleton ? (
              // Sized to the h1 it stands in for, so the rule below it does
              // not move when the real title arrives.
              <Skeleton className="h-8 w-64" />
            ) : (
              <h1 className="text-2xl text-slate-900">{title}</h1>
            )}
            {badge}
          </div>
          {typeof description === "string" ? (
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          ) : (
            description
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
