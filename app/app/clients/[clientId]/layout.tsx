"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { NumericoLockup } from "@/components/brand/numerico-mark";
import { banner, btn, text } from "@/lib/ui";
import type { Client } from "@/lib/types";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const clientId = params.clientId as string;
  const { user, signOut } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClient(clientId)
      .then(setClient)
      .catch((e) => setError(e.message));
  }, [clientId]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="text-center space-y-4 max-w-sm">
          <NumericoLockup className="justify-center" />
          <p className={banner.error}>{error}</p>
          <button onClick={() => router.push("/")} className={btn.link}>
            ← Back to clients
          </button>
        </div>
      </div>
    );
  }

  const prefix = `/clients/${clientId}`;

  // Only routes whose endpoints are ported to this app. Onboarding, Calendar,
  // Runs and Assets still proxy to the FastAPI backend, so linking them would
  // hand you a 500. Their pages are left in place: Calendar returns with
  // Google sync, Onboarding when research is ported, and Runs/Assets are slated
  // for deletion along with the Python.
  const NAV_ITEMS = [
    { href: prefix, label: "Dashboard", icon: "◻" },
    { href: `${prefix}/strategy`, label: "Strategy", icon: "◎" },
    { href: `${prefix}/branding`, label: "Branding", icon: "◐" },
    { href: `${prefix}/campaigns`, label: "Campaigns", icon: "◈" },
    { href: `${prefix}/plan`, label: "Plan", icon: "▥" },
  ];

  return (
    <div className="flex min-h-screen bg-stone-50">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white min-h-screen p-4 flex flex-col">
        <Link href="/" className="mb-6 inline-flex" aria-label="Numerico Marketing">
          <NumericoLockup />
        </Link>

        <div className="mb-6">
          <p className={text.label}>Client</p>
          <div className="mt-1.5 flex items-center gap-2">
            {client?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={client.logo_url}
                alt=""
                className="w-7 h-7 rounded object-contain shrink-0"
              />
            )}
            <h1 className="text-base text-slate-900 truncate">
              {client?.name ?? "Loading…"}
            </h1>
          </div>
          <Link
            href="/"
            className="mt-1 inline-block text-xs text-slate-400 hover:text-teal-700 transition-colors"
          >
            ← All clients
          </Link>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === prefix
                ? pathname === prefix
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-teal-50 text-teal-700 font-semibold"
                    : "text-slate-600 hover:bg-stone-50 hover:text-slate-800"
                )}
              >
                <span
                  className={cn(
                    "text-base leading-none",
                    isActive ? "text-teal-600" : "text-slate-400"
                  )}
                  aria-hidden="true"
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {user && (
          <div className="border-t border-slate-200 pt-3 mt-3">
            <p className="text-xs text-slate-700 truncate">{user.email}</p>
            <button
              onClick={signOut}
              className="text-xs text-slate-400 hover:text-teal-700 transition-colors mt-1"
            >
              Sign out
            </button>
          </div>
        )}
      </aside>

      <main className="flex-1 p-6 sm:p-10 overflow-auto">{children}</main>
    </div>
  );
}
