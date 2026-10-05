"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  Loader2,
  Lightbulb,
  LogOut,
  Megaphone,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Target,
  Telescope,
  Users,
} from "lucide-react";
import { NumericoLockup, NumericoMark } from "@/components/brand/numerico-mark";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/**
 * The rail. Mirrors car-sales-os/components/layout/AppSidebar.tsx.
 *
 * Two levels, one component. At the workspace the list is Clients / Settings;
 * inside a client it is that client's own navigation, with Clients / Settings
 * pinned at the bottom as the way back out. There is deliberately no back
 * chevron: stepping out of a client is a destination, not an undo.
 *
 * Nothing here is `font-semibold`. Inter is loaded at 400/500 only
 * (app/layout.tsx), so a 600 would be synthesised into a faux bold — which is
 * why the selected row used to look a size larger than its neighbours. Active
 * and inactive rows differ by colour and fill alone.
 */

export interface SidebarClient {
  name: string;
  logoUrl?: string | null;
  /** Null until loaded. A badge never renders a guess, and never renders "0". */
  activeCampaigns: number | null;
  scheduled: number | null;
}

interface NavEntry {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  count?: number | null;
}

interface NavGroup {
  label: string | null;
  items: NavEntry[];
}

export function AppSidebar({
  clientId,
  client,
  collapsed = false,
  onToggleCollapse,
  onNavigate,
}: {
  /** Absent at the workspace level. */
  clientId?: string;
  client?: SidebarClient | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  /**
   * Two groups, not seven peers — unchanged from the layout this replaced.
   *
   * The work is a pipeline (campaign, then its content, then the calendar) and
   * Research / Strategy / Branding / Learned are the setup it reads from,
   * touched once and revisited rarely. There is no Plan entry: a plan is not a
   * place, it is something a campaign does, and it lives inside the campaign.
   */
  const groups: NavGroup[] = clientId
    ? [
        {
          label: null,
          items: [
            {
              href: `/clients/${clientId}`,
              label: "Overview",
              icon: LayoutDashboard,
            },
            {
              href: `/clients/${clientId}/campaigns`,
              label: "Campaigns",
              icon: Megaphone,
              count: client?.activeCampaigns ?? null,
            },
            {
              href: `/clients/${clientId}/schedule`,
              label: "Calendar",
              icon: CalendarDays,
              count: client?.scheduled ?? null,
            },
          ],
        },
        {
          label: "Set up",
          items: [
            {
              href: `/clients/${clientId}/research`,
              label: "Research",
              icon: Telescope,
            },
            {
              href: `/clients/${clientId}/strategy`,
              label: "Strategy",
              icon: Target,
            },
            {
              href: `/clients/${clientId}/branding`,
              label: "Branding",
              icon: Palette,
            },
            {
              href: `/clients/${clientId}/learned`,
              label: "Learned",
              icon: Lightbulb,
            },
          ],
        },
      ]
    : [{ label: null, items: WORKSPACE_ITEMS }];

  const overviewHref = clientId ? `/clients/${clientId}` : null;

  function isActive(href: string) {
    // Overview shares its prefix with every sibling route, so it matches
    // exactly; everything else matches by prefix so detail pages keep their
    // parent highlighted.
    return href === overviewHref
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-slate-800">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center",
          collapsed ? "justify-center px-2" : "justify-between px-4"
        )}
      >
        <Link
          href="/"
          onClick={onNavigate}
          aria-label="Numerico Marketing"
          className="inline-flex min-w-0"
        >
          {collapsed ? (
            <NumericoMark className="h-7 w-7" />
          ) : (
            <NumericoLockup />
          )}
        </Link>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-sidebar-accent hover:text-slate-700 md:inline-flex"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {clientId && (
        <div
          className={cn(
            "shrink-0 border-t border-slate-200 py-3",
            collapsed ? "px-2" : "px-4"
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2",
              collapsed && "justify-center"
            )}
            title={collapsed ? (client?.name ?? undefined) : undefined}
          >
            <ClientAvatar client={client} />
            {!collapsed && (
              <p className="min-w-0 flex-1 truncate text-sm text-slate-900">
                {client?.name ?? "Loading…"}
              </p>
            )}
          </div>
        </div>
      )}

      <nav
        className={cn(
          "min-h-0 flex-1 overflow-y-auto border-t border-slate-200 py-3",
          collapsed ? "px-2" : "px-3"
        )}
      >
        {groups.map((group, index) => (
          <div key={group.label ?? index} className={index > 0 ? "mt-5" : ""}>
            {group.label && !collapsed && (
              <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-slate-600">
                {group.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavRow
                    entry={item}
                    active={isActive(item.href)}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Inside a client, the workspace is reachable as a destination rather
          than as a back link. At the workspace level these are already the
          main list, so repeating them here would be a duplicate. */}
      {clientId && (
        <div
          className={cn(
            "shrink-0 border-t border-slate-200 py-3",
            collapsed ? "px-2" : "px-3"
          )}
        >
          <ul className="flex flex-col gap-0.5">
            {WORKSPACE_ITEMS.map((item) => (
              <li key={item.href}>
                <NavRow
                  entry={item}
                  active={isActive(item.href)}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {user && (
        <div
          className={cn(
            "shrink-0 border-t border-slate-200 py-3",
            collapsed ? "px-2" : "px-3"
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2.5 px-1",
              collapsed && "justify-center px-0"
            )}
            title={collapsed ? user.email : undefined}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-medium uppercase text-teal-700">
              {initials(user.email)}
            </span>
            {!collapsed && (
              <p className="min-w-0 flex-1 truncate text-sm text-slate-700">
                {user.email}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={signOut}
            title={collapsed ? "Sign out" : undefined}
            className={cn(
              "mt-1 flex w-full items-center rounded-lg py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-sidebar-accent hover:text-slate-900",
              collapsed ? "justify-center px-2" : "gap-3 px-3"
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className={collapsed ? "sr-only" : ""}>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

const WORKSPACE_ITEMS: NavEntry[] = [
  { href: "/", label: "Clients", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavRow({
  entry,
  active,
  collapsed,
  onNavigate,
}: {
  entry: NavEntry;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = entry.icon;
  return (
    <Link
      href={entry.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? entry.label : undefined}
      className={cn(
        "flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
        collapsed ? "justify-center px-2" : "gap-3 px-3",
        active
          ? "bg-sidebar-accent text-slate-900"
          : "text-slate-600 hover:bg-sidebar-accent/60 hover:text-slate-900"
      )}
    >
      <NavRowIcon icon={Icon} />
      <span className={cn("flex-1 truncate", collapsed && "sr-only")}>
        {entry.label}
      </span>
      {/* Absent until loaded, and absent at zero: a badge reading "0" is
          noise, and the page's own empty state says it better. */}
      {!collapsed && !!entry.count && (
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            active ? "text-slate-700" : "text-slate-600"
          )}
        >
          {entry.count}
        </span>
      )}
    </Link>
  );
}

/**
 * The row's icon, or a spinner while its navigation is in flight.
 *
 * `useLinkStatus()` only reports anything from inside a `<Link>`, which is why
 * this is its own component rather than a few lines in NavRow. It closes the
 * dead-click window: every page here fetches in an effect, so before this a
 * click produced no feedback at all until the next page's data landed. Ported
 * from car-sales-os's AppSidebar, which solves it the same way.
 */
function NavRowIcon({ icon: Icon }: { icon: NavEntry["icon"] }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
  ) : (
    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
  );
}

function ClientAvatar({ client }: { client?: SidebarClient | null }) {
  if (client?.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={client.logoUrl}
        alt=""
        className="h-7 w-7 shrink-0 rounded object-contain"
      />
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white text-xs font-medium uppercase text-slate-500 ring-1 ring-slate-200">
      {client?.name?.trim()?.[0] ?? "·"}
    </span>
  );
}

/** First two letters of the local part — "alejandro@x.co" reads as "AL". */
function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2) || "?";
}
