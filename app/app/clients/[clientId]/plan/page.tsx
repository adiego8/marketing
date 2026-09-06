"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { previewPlan, listPlanRuns, commitPlan } from "@/lib/api";
import { banner, btn, surface, table, toggle, text } from "@/lib/ui";
import { channelPill, PILL } from "@/lib/ui-status";
import { contentTypeLabel } from "@/lib/marketing/content-types";
import type { PlanRun, ProposedSlot } from "@/lib/types";

const HORIZONS = [1, 2, 4];

function dayLabel(date: string) {
  // The date is already local to the client; parse as UTC so the browser's own
  // timezone cannot shift it a day either way.
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function PlanPage() {
  const { clientId } = useParams() as { clientId: string };
  const [run, setRun] = useState<PlanRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [weeks, setWeeks] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    listPlanRuns(clientId, 1)
      .then((runs) => {
        if (!cancelled) setRun(runs[0] ?? null);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load plan runs");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const handlePreview = async () => {
    setPlanning(true);
    setError(null);
    try {
      setRun(await previewPlan(clientId, weeks));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Planning failed");
    } finally {
      setPlanning(false);
    }
  };

  const handleCommit = async () => {
    if (!run) return;
    setCommitting(true);
    setError(null);
    try {
      setRun(await commitPlan(clientId, run.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  const byWeek = (run?.proposed_slots ?? []).reduce<Record<string, ProposedSlot[]>>(
    (acc, slot) => {
      (acc[slot.weekKey] ||= []).push(slot);
      return acc;
    },
    {}
  );

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className={text.eyebrow}>Schedule</p>
          <h1 className={`${text.h1} mt-1`}>Plan</h1>
          <p className="text-sm text-slate-500 mt-1">
            {run
              ? `${run.proposed_slots.length} slot${
                  run.proposed_slots.length === 1 ? "" : "s"
                } proposed for ${run.horizon.startDate} to ${run.horizon.endDate}`
              : "Propose a content schedule from the weekly quota"}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex gap-1" role="group" aria-label="Planning horizon">
            {HORIZONS.map((w) => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                aria-pressed={weeks === w}
                className={toggle(weeks === w)}
              >
                {w}w
              </button>
            ))}
          </div>
          <button
            onClick={handlePreview}
            disabled={planning}
            className={btn.primarySm}
          >
            {planning ? "Planning… (20-40s)" : "Generate preview"}
          </button>
        </div>
      </div>

      {error &&
        (/quota/i.test(error) ? (
          // The planner's one hard precondition. Reaching it means the run was
          // refused before anything was computed, so point at the fix rather
          // than leaving a raw API message on screen.
          <div className={`${banner.warn} mb-4 flex flex-wrap items-center justify-between gap-3`}>
            <span>
              No weekly content quota set. The planner needs to know how much of
              each content type to schedule.
            </span>
            <Link
              href={`/clients/${clientId}/strategy`}
              className={`${btn.primarySm} shrink-0`}
            >
              Set quota →
            </Link>
          </div>
        ) : (
          <p className={`${banner.error} mb-4`}>{error}</p>
        ))}

      {run?.status === "degraded" && (
        <p className={`${banner.warn} mb-4`}>
          The theme model was unavailable. Dates and channels are correct; themes
          are missing and marked below.
        </p>
      )}

      {loading ? (
        <p className={text.muted}>Loading…</p>
      ) : !run ? (
        <div className={surface.empty}>
          <p className="text-slate-700 text-lg">No plan yet.</p>
          <p className="text-slate-500 text-sm mt-1">
            Generate a preview to see what the next {weeks} week
            {weeks === 1 ? "" : "s"} would look like.
          </p>
          <button
            onClick={handlePreview}
            disabled={planning}
            className={`${btn.primary} mt-6`}
          >
            {planning ? "Planning…" : "Generate preview"}
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Coverage — the number a human actually judges the plan by. */}
          <section>
            <h2 className={`${text.cardTitle} mb-3`}>Coverage</h2>
            <div className={`${surface.table} overflow-x-auto`}>
              <table className="w-full">
                <thead>
                  <tr className="bg-stone-50">
                    <th className={`${table.head} w-32`}>Week</th>
                    <th className={`${table.head} w-24`}>Type</th>
                    <th className={`${table.head} w-20`}>Quota</th>
                    <th className={`${table.head} w-24`}>Scheduled</th>
                    <th className={`${table.head} w-24`}>Proposed</th>
                    <th className={table.head}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {run.observation.gaps.map((gap, i) => {
                    const proposed = run.proposed_slots.filter(
                      (s) => s.weekKey === gap.weekKey && s.type === gap.type
                    ).length;
                    return (
                      <tr key={i} className={table.row}>
                        <td className={`${table.cell} font-medium`}>
                          {gap.weekKey}
                          {gap.partialWeek && (
                            <span
                              className={`${PILL} ml-2 bg-slate-100 text-slate-500`}
                            >
                              partial
                            </span>
                          )}
                        </td>
                        <td className={table.cell}>
                          {contentTypeLabel(gap.type)}
                        </td>
                        <td className={table.cell}>{gap.quotaCount}</td>
                        <td className={table.cell}>{gap.existing}</td>
                        <td
                          className={`${table.cell} ${
                            proposed < gap.deficit
                              ? "text-amber-700 font-medium"
                              : ""
                          }`}
                        >
                          +{proposed}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {gap.surplus > 0 && `${gap.surplus} over quota. `}
                          {gap.notes.join(" ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Proposed slots, grouped by week. */}
          {Object.entries(byWeek).map(([weekKey, slots]) => (
            <section key={weekKey}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className={text.cardTitle}>{weekKey}</h2>
                <span className={`${PILL} bg-slate-100 text-slate-500`}>
                  {slots.length}
                </span>
              </div>
              <div className={`${surface.table} overflow-x-auto`}>
                <table className="w-full">
                  <thead>
                    <tr className="bg-stone-50">
                      <th className={`${table.head} w-36`}>Date</th>
                      <th className={`${table.head} w-20`}>Time</th>
                      <th className={`${table.head} w-28`}>Channel</th>
                      <th className={`${table.head} w-24`}>Type</th>
                      <th className={table.head}>Theme</th>
                      <th className={`${table.head} w-40`}>Campaign</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((slot) => (
                      <tr key={slot.slotId} className={table.row}>
                        <td className={`${table.cell} font-medium whitespace-nowrap`}>
                          {dayLabel(slot.date)}
                        </td>
                        <td className={table.cell}>{slot.timeLocal}</td>
                        <td className={table.cell}>
                          <span className={channelPill(slot.channel)}>
                            {slot.channel}
                          </span>
                        </td>
                        <td className={table.cell}>
                          {contentTypeLabel(slot.type)}
                        </td>
                        <td className={table.cell}>
                          {slot.needsTheme ? (
                            <span className={`${PILL} bg-red-100 text-red-600`}>
                              needs theme
                            </span>
                          ) : (
                            <>
                              <p>{slot.theme}</p>
                              {slot.rationale && (
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {slot.rationale}
                                </p>
                              )}
                            </>
                          )}
                        </td>
                        <td className={table.cellMuted}>
                          {slot.campaignTitle ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {/* Why the plan is thinner than the quota. The most useful panel here:
              it turns "I asked for 9 and got 6" into an understood constraint. */}
          {(run.deferred.length > 0 || run.warnings.length > 0) && (
            <section className={`${surface.card} ${surface.pad}`}>
              <h2 className={`${text.cardTitle} mb-3`}>Not planned, and why</h2>
              <div className="space-y-2">
                {run.deferred.map((d, i) => (
                  <p key={i} className="text-sm text-slate-600">
                    <span className="font-medium text-slate-800">
                      {contentTypeLabel(d.type)}
                    </span>{" "}
                    in {d.weekKey}: {d.reason}
                  </p>
                ))}
                {run.warnings.map((w, i) => (
                  <p key={`w${i}`} className="text-sm text-slate-500">
                    {w}
                  </p>
                ))}
              </div>
            </section>
          )}

          {run.committed_at ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-4">
              <p className="text-sm text-teal-800">
                Committed{" "}
                {new Date(run.committed_at).toLocaleString()} ·{" "}
                {run.created_slot_ids.length} slot
                {run.created_slot_ids.length === 1 ? "" : "s"} on the calendar.
              </p>
              <button
                onClick={handlePreview}
                disabled={planning}
                className={`${btn.outline} shrink-0`}
              >
                Plan the next stretch
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">
                Preview only. Nothing has been written to the calendar yet.
              </p>
              <button
                onClick={handleCommit}
                disabled={committing || run.proposed_slots.length === 0}
                className={`${btn.primarySm} shrink-0`}
              >
                {committing
                  ? "Committing…"
                  : `Accept ${run.proposed_slots.length} slot${
                      run.proposed_slots.length === 1 ? "" : "s"
                    }`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
