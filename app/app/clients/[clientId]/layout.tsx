"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getClient, listCampaigns, listSlots } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { NumericoLockup } from "@/components/brand/numerico-mark";
import { backLink, banner, nav, text } from "@/lib/ui";
import { ChevronLeft } from "lucide-react";
import type { Client } from "@/lib/types";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const clientId = params.clientId as string;
  const { user, signOut } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Badge counts. Null means "not known yet" and renders nothing — the nav must
  // paint immediately, so these fill in afterwards rather than being awaited.
  const [activeCampaigns, setActiveCampaigns] = useState<number | null>(null);
  const [scheduled, setScheduled] = useState<number | null>(null);

  useEffect(() => {
    getClient(clientId)
      .then(setClient)
      .catch((e) => setError(e.message));
  }, [clientId]);

  useEffect(() => {
    listCampaigns(clientId, "active")
      .then((c) => setActiveCampaigns(c.length))
      .catch(() => {});
    listSlots(clientId, { dated: "scheduled" })
      .then((s) => setScheduled(s.length))
      .catch(() => {});
  }, [clientId]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="text-center space-y-4 max-w-sm">
          <NumericoLockup className="justify-center" />
          <p className={banner.error}>{error}</p>
          <button onClick={() => router.push("/")} className={backLink}>
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            Back to clients
          </button>
        </div>
      </div>
    );
  }

  const prefix = `/clients/${clientId}`;

  /**
   * Two groups, not seven peers.
   *
   * The work is a pipeline — campaign, then its content, then the calendar —
   * and Research / Strategy / Branding are the setup it reads from, touched
   * once and revisited rarely. Presenting all seven at equal weight is what
   * made the app feel scattered, and gave no clue which screen feeds which.
   *
   * There is no Plan entry. A plan is not a place: it is something a campaign
   * does, and it lives inside the campaign now. The route still answers, for
   * the client-wide run that stage ② links to.
   */
  const GROUPS: {
    label: string | null;
    items: { href: string; label: string; icon: string; count?: number | null }[];
  }[] = [
    {
      label: null,
      items: [
        { href: prefix, label: "Overview", icon: "◆" },
        {
          href: `${prefix}/campaigns`,
          label: "Campaigns",
          icon: "◈",
          count: activeCampaigns,
        },
        {
          href: `${prefix}/schedule`,
          label: "Calendar",
          icon: "▦",
          count: scheduled,
        },
      ],
    },
    {
      label: "Set up",
      items: [
        { href: `${prefix}/research`, label: "Research", icon: "◍" },
        { href: `${prefix}/strategy`, label: "Strategy", icon: "◎" },
        { href: `${prefix}/branding`, label: "Branding", icon: "◐" },
        { href: `${prefix}/learned`, label: "Learned", icon: "◑" },
      ],
    },
  ];

  return (
    <div className="flex min-h-screen bg-stone-50">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white min-h-screen p-4 flex flex-col">
        <Link href="/" className="mb-6 inline-flex" aria-label="Numerico Marketing">
          <NumericoLockup />
        </Link>

        <div className="mb-4">
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
            className="mt-1 inline-flex items-center gap-0.5 text-xs text-slate-400 hover:text-teal-700 transition-colors"
          >
            <ChevronLeft className="w-3 h-3" aria-hidden="true" />
            All clients
          </Link>
        </div>

        <nav className="flex flex-col flex-1">
          {GROUPS.map((group, g) => (
            <div key={group.label ?? g}>
              {group.label && <p className={nav.group}>{group.label}</p>}
              <div className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const isActive =
                    item.href === prefix
                      ? pathname === prefix
                      : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={isActive ? nav.itemActive : nav.item}
                    >
                      <span
                        className={isActive ? nav.iconActive : nav.icon}
                        aria-hidden="true"
                      >
                        {item.icon}
                      </span>
                      <span className="flex-1">{item.label}</span>
                      {/* Absent until loaded, and absent at zero: a badge
                          reading "0" is noise, and the empty state on the page
                          itself says it better. */}
                      {!!item.count && (
                        <span
                          className={cn(
                            "text-xs tabular-nums",
                            isActive ? "text-teal-600" : "text-slate-400"
                          )}
                        >
                          {item.count}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
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
