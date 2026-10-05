"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { NumericoLockup } from "@/components/brand/numerico-mark";
import { Button } from "@/components/ui/button";
import { backLink, banner, text } from "@/lib/ui";

/**
 * The app's error boundary.
 *
 * Without this, an unhandled render error fell through to Next's own screen: a
 * stack trace in dev, and in production the unstyled "Application error: a
 * client-side exception has occurred" with no way back but the URL bar.
 *
 * No rail. `AppShell` is mounted by the pages and by the client layout, not by
 * the root layout, so there is none to keep — and the client layout's own error
 * branch already drops it on purpose for the same reason: navigation into a
 * thing that failed to load is worse than no navigation.
 *
 * This cannot catch an error thrown by the root layout itself, which is where
 * AuthProvider and ConfirmProvider live. Only `global-error.tsx` can, and the
 * app does not have one.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The only place the detail survives. Next replaces server-side error
    // messages with a generic string in production and leaves just the digest,
    // so whatever is here is worth keeping in the console.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <NumericoLockup className="justify-center" />
        <p className={banner.error}>Something went wrong on this screen.</p>

        {/* Shown rather than swallowed: this is an internal tool, and whoever
            is looking at the screen is the person who needs the string. */}
        {(error.message || error.digest) && (
          <div className="rounded-lg border border-slate-200 bg-stone-50 px-3 py-2 text-left">
            {error.message && (
              <p className={`${text.mono} break-words`}>{error.message}</p>
            )}
            {error.digest && (
              <p className={`${text.micro} mt-1`}>digest {error.digest}</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-center gap-3 pt-1">
          <Button variant="primary" size="md" onClick={reset}>
            Try again
          </Button>
        </div>

        <Link href="/" className={backLink}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back to clients
        </Link>
      </div>
    </div>
  );
}
