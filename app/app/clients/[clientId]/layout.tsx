"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <p className="text-red-500">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-zinc-500 hover:text-zinc-800 underline"
          >
            Back to Clients
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
    <div className="flex min-h-screen">
      <aside className="w-56 border-r bg-zinc-50 min-h-screen p-4 flex flex-col">
        {/* Client header */}
        <div className="mb-2">
          <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
            ← Back to Clients
          </Link>
        </div>
        <div className="mb-6">
          {client?.logo_url && (
            <img src={client.logo_url} alt="" className="w-8 h-8 rounded mb-2 object-contain" />
          )}
          <h1 className="text-lg font-bold truncate">{client?.name || "Loading..."}</h1>
          <p className="text-xs text-zinc-500">Marketing Agent</p>
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
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100"
                )}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        {user && (
          <div className="border-t pt-3 mt-3">
            <p className="text-xs text-zinc-700 truncate">{user.email}</p>
            <button
              onClick={signOut}
              className="text-xs text-zinc-400 hover:text-zinc-600 mt-1"
            >
              Sign out
            </button>
          </div>
        )}
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
