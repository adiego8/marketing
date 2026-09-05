"use client";

import { useRef } from "react";

// A segmented control in Numerico's idiom, hand-rolled the way the website
// hand-rolls its Listbox: plain elements, explicit ARIA, no primitive library.
//
// Automatic activation — arrow keys move focus and select in one step, which is
// the right pattern when switching panels is instant and cheap, as it is here.

export type Tab = { value: string; label: string };

export function Tabs({
  tabs,
  value,
  onChange,
  label,
  className = "",
}: {
  tabs: Tab[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const move = (delta: number) => {
    const index = tabs.findIndex((t) => t.value === value);
    if (index === -1) return;
    const next = (index + delta + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    ref.current
      ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
      [next]?.focus();
  };

  const jump = (index: number) => {
    onChange(tabs[index].value);
    ref.current
      ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
      [index]?.focus();
  };

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      className={`inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 ${className}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          move(-1);
        } else if (e.key === "Home") {
          e.preventDefault();
          jump(0);
        } else if (e.key === "End") {
          e.preventDefault();
          jump(tabs.length - 1);
        }
      }}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            id={`tab-${tab.value}`}
            aria-selected={active}
            aria-controls={`panel-${tab.value}`}
            // Roving tabindex: only the selected tab is in the tab order, so
            // Tab moves past the whole group rather than through every option.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
              active
                ? "bg-teal-50 text-teal-700"
                : "text-slate-500 hover:bg-stone-50 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  value,
  active,
  children,
}: {
  value: string;
  active: boolean;
  children: React.ReactNode;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`panel-${value}`}
      aria-labelledby={`tab-${value}`}
      tabIndex={0}
      className="outline-none"
    >
      {children}
    </div>
  );
}
