import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { NumericoLockup } from "@/components/brand/numerico-mark";
import { backLink, text } from "@/lib/ui";

/**
 * Unmatched URLs — a stale bookmark, a mistyped path, a client that has been
 * deleted since someone last saved the link.
 *
 * A server component, so it can carry its own metadata; a client component
 * cannot export any. That is also why the way back is a plain `backLink` rather
 * than `buttonVariants()`: components/ui/button.tsx is `"use client"`, and
 * calling one of its exports during a server render is a client-reference call,
 * not a function call. The client layout's error branch uses the same link, so
 * the two failure screens match anyway.
 *
 * Renders inside AuthProvider, which gates on being signed in — so a signed-out
 * visitor to a bad URL is redirected to /login and never sees this. That is the
 * right order: who you are is a more useful answer than where you are.
 */
export const metadata: Metadata = {
  title: "Page not found — Numerico Marketing",
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm space-y-4 text-center">
        <NumericoLockup className="justify-center" />
        <div>
          <h1 className="text-2xl text-slate-900">Page not found</h1>
          <p className={`${text.muted} mt-1`}>
            That link does not go anywhere. It may have been a client or a
            campaign that has since been deleted.
          </p>
        </div>
        <Link href="/" className={backLink}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back to clients
        </Link>
      </div>
    </div>
  );
}
