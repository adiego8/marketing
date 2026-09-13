"use client";

import { cn } from "@/lib/utils";

/**
 * The campaign pipeline, as navigation.
 *
 * This replaces the three plain tabs on the campaign page, and the numbering is
 * not decoration: the stages are a real sequence with real preconditions. You
 * cannot write a piece the campaign has not asked for, and you cannot give a
 * day to a piece that was never written. A tab strip says "three unrelated
 * views"; this says "here is the job, and here is how far along it is".
 *
 * Each stage carries its own state line, so the campaign's position is legible
 * without opening anything — which is the whole complaint about the old
 * layout, where the answer to "where is this campaign up to" lived across
 * three separate top-level tabs.
 */

export interface Stage {
  value: string;
  label: string;
  /** One short line of live state: "8 written · 3 dropped". Never a hint. */
  detail: string;
  /** Reachable yet? A stage with nothing upstream is shown, but inert. */
  ready: boolean;
}

export function StageRail({
  stages,
  value,
  onChange,
}: {
  stages: Stage[];
  value: string;
  onChange: (next: string) => void;
}) {
  const activeIndex = stages.findIndex((s) => s.value === value);

  return (
    <nav aria-label="Campaign stages" className="mb-6">
      {/* auto-fit rather than a fixed column count: the rail takes however many
          stages the pipeline has, and folds to one column on a phone, without
          the count being hardcoded in two places. */}
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-px bg-slate-200 rounded-xl overflow-hidden border border-slate-200">
        {stages.map((stage, i) => {
          const isActive = stage.value === value;
          const isPast = i < activeIndex;

          return (
            <li key={stage.value} className="bg-white">
              <button
                type="button"
                onClick={() => onChange(stage.value)}
                disabled={!stage.ready}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "w-full text-left px-4 py-3 transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600",
                  isActive ? "bg-teal-50" : "hover:bg-stone-50",
                  !stage.ready && "opacity-50 cursor-not-allowed hover:bg-white"
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold shrink-0 tabular-nums",
                      isActive
                        ? "bg-teal-600 text-white"
                        : isPast
                          ? "bg-teal-100 text-teal-700"
                          : "bg-slate-100 text-slate-500"
                    )}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-semibold truncate",
                      isActive ? "text-teal-800" : "text-slate-700"
                    )}
                  >
                    {stage.label}
                  </span>
                </span>
                <span
                  className={cn(
                    "block text-xs mt-1 pl-7 truncate",
                    isActive ? "text-teal-700" : "text-slate-500"
                  )}
                >
                  {stage.detail}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
