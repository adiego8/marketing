"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Drawer } from "@base-ui/react/drawer";
import { Menu } from "lucide-react";
import { AppSidebar, type SidebarClient } from "./app-sidebar";
import { cn } from "@/lib/utils";

/**
 * The application frame. Mirrors car-sales-os/components/layout/AppShell.tsx.
 *
 * Desktop gets a fixed rail the content is padded around; below `md` the rail
 * moves into a drawer behind a top bar. The app had no mobile treatment at all
 * before this — a 224px aside sat on screen at every width.
 *
 * The drawer is Base UI's, already a dependency. It supplies focus trapping,
 * scroll locking, Escape and swipe-to-dismiss; the motion is ours, in
 * globals.css under `.drawer-panel`, because Base UI popups are styled
 * entirely by the consumer.
 */

/**
 * Whether the rail is collapsed, read straight from localStorage.
 *
 * `useSyncExternalStore` rather than state-plus-effect: the server has no
 * localStorage, so the server snapshot is always "expanded" and React swaps in
 * the stored value after hydration without a mismatch — and without a setState
 * inside an effect, which is a lint error in this repo and a cascading render
 * either way. The `storage` event keeps a second tab in step for free.
 */
const COLLAPSED_KEY = "numerico-marketing:sidebar-collapsed";
const collapseListeners = new Set<() => void>();

function subscribeCollapsed(onChange: () => void) {
  collapseListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    collapseListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    // Private mode, or storage disabled — stay expanded.
    return false;
  }
}

function writeCollapsed(next: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  } catch {
    // Not worth surfacing; the rail simply will not remember next time.
  }
  collapseListeners.forEach((notify) => notify());
}

export function AppShell({
  children,
  clientId,
  client,
}: {
  children: ReactNode;
  /** Absent at the workspace level; the rail changes shape without it. */
  clientId?: string;
  client?: SidebarClient | null;
}) {
  const [open, setOpen] = useState(false);
  const isCollapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false
  );

  return (
    <div className="min-h-screen bg-stone-50">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-slate-200 transition-[width] duration-200 md:flex md:flex-col",
          isCollapsed ? "md:w-16" : "md:w-64"
        )}
      >
        <AppSidebar
          clientId={clientId}
          client={client}
          collapsed={isCollapsed}
          onToggleCollapse={() => writeCollapsed(!isCollapsed)}
        />
      </aside>

      <Drawer.Root open={open} onOpenChange={setOpen} swipeDirection="left">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-stone-50 px-4 md:hidden">
          <Drawer.Trigger
            className="-ml-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-stone-200"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Drawer.Trigger>
          <p className="truncate text-sm font-medium text-slate-900">
            {client?.name ?? "Numerico Marketing"}
          </p>
        </header>

        <Drawer.Portal>
          <Drawer.Backdrop className="drawer-scrim fixed inset-0 z-40 bg-slate-900/20 md:hidden" />
          <Drawer.Popup className="drawer-panel fixed inset-y-0 left-0 z-50 w-72 border-r border-slate-200 outline-none md:hidden">
            <Drawer.Title className="sr-only">Navigation</Drawer.Title>
            <AppSidebar
              clientId={clientId}
              client={client}
              onNavigate={() => setOpen(false)}
            />
          </Drawer.Popup>
        </Drawer.Portal>
      </Drawer.Root>

      <main
        className={cn(
          "transition-[padding] duration-200",
          isCollapsed ? "md:pl-16" : "md:pl-64"
        )}
      >
        <div className="px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
