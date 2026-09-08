"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  previewPlan,
  listPlanRuns,
  commitPlan,
  listCampaigns,
  deletePlanRun,
} from "@/lib/api";
import type { CampaignListItem } from "@/lib/types";
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
  const [discarding, setDiscarding] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);

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

  useEffect(() => {
    listCampaigns(clientId).then(setCampaigns).catch(() => {});
  }, [clientId]);

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

  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const waiting = campaigns.filter((c) =>
    ["proposal", "in_review"].includes(c.status)
  );

  const handleDiscard = async () => {
    if (!run) return;
    const what = run.committed_at
      ? `Delete this plan and everything it created?\n\n` +
        `• ${run.created_slot_ids.length} scheduled slot${run.created_slot_ids.length === 1 ? "" : "s"}\n` +
        `• their Google Calendar events\n\n` +
        `The quota reopens, so the next plan will propose replacements.`
      : "Discard this preview? Nothing was written to the calendar.";
    if (!confirm(what)) return;

    setDiscarding(true);
    setError(null);
    try {
      await deletePlanRun(clientId, run.id);
      // Fall back to whatever the previous run was, so the page does not go
      // blank on a client that still has history.
      const rest = await listPlanRuns(clientId, 1);
      setRun(rest[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the plan");
    } finally {
      setDiscarding(false);
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
        (/changed after this plan/i.test(error) ? (
          // The stale guard. The plan on screen was computed from a strategy or
          // calendar that has since moved, so accepting it would schedule
          // against inputs that no longer exist. The fix is always the same
          // one click, so offer it rather than describing it.
          <div className={`${banner.warn} mb-4 flex flex-wrap items-center justify-between gap-3`}>
            <span>
              Your strategy or calendar changed after this plan was generated,
              so it no longer reflects what would actually be scheduled.
            </span>
            <button
              onClick={handlePreview}
              disabled={planning}
              className={`${btn.primarySm} shrink-0`}
            >
              {planning ? "Planning…" : "Generate a fresh plan"}
            </button>
          </div>
        ) : /campaign/i.test(error) ? (
          // The planner's one hard precondition — an active campaign, since a
          // campaign's content plan IS the demand. Reaching it means the run was
          // refused before anything was computed, so point at the fix rather
          // than leaving a raw API message on screen.
          <div className={`${banner.warn} mb-4 flex flex-wrap items-center justify-between gap-3`}>
            <span>
              No active campaign. The planner schedules what a campaign&rsquo;s
              content plan asks for, so there is nothing for it to do yet.
            </span>
            <Link
              href={`/clients/${clientId}/campaigns`}
              className={`${btn.primarySm} shrink-0`}
            >
              Accept a campaign →
            </Link>
          </div>
        ) : (
          <p className={`${banner.error} mb-4`}>{error}</p>
        ))}

      {/* Only active campaigns can supply a theme. A campaign sitting in
          proposal or review is invisible to the planner, which is the single
          most confusing thing about this screen. */}
      {campaigns.length > 0 && activeCampaigns.length === 0 && (
        <div className={`${banner.warn} mb-4 flex flex-wrap items-center justify-between gap-3`}>
          <span>
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}, but
            none are active — and an active campaign&rsquo;s content plan is the
            only thing the planner schedules, so it cannot run yet.
          </span>
          <Link
            href={`/clients/${clientId}/campaigns`}
            className={`${btn.outlineSm} shrink-0`}
          >
            Review campaigns
          </Link>
        </div>
      )}
      {waiting.length > 0 && activeCampaigns.length > 0 && (
        <p className={`${banner.info} mb-4`}>
          Planning from {activeCampaigns.length} active campaign
          {activeCampaigns.length === 1 ? "" : "s"}.{" "}
          {waiting.length} more {waiting.length === 1 ? "is" : "are"} awaiting
          review and will not be scheduled until accepted.
        </p>
      )}

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
          {/* A run that placed nothing used to drop the reader straight into a
              Coverage table full of deficits. The reason is in the warnings —
              lead with it. */}
          {run.proposed_slots.length === 0 && (
            <div className={`${surface.card} ${surface.pad}`}>
              <h2 className={`${text.cardTitle} mb-2`}>
                Nothing to add in this window
              </h2>
              <p className="text-sm text-slate-600 mb-3">
                The planner found no room between {run.horizon.startDate} and{" "}
                {run.horizon.endDate}. Every slot it could place is already
                there.
              </p>
              {run.warnings.length > 0 && (
                <ul className="space-y-1 mb-4">
                  {run.warnings.map((w, i) => (
                    <li key={i} className="text-sm text-slate-500">
                      • {w}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {weeks < 4 && (
                  <button
                    onClick={() => {
                      setWeeks(4);
                      setRun(null);
                    }}
                    className={btn.outline}
                  >
                    Look 4 weeks ahead instead
                  </button>
                )}
                <Link
                  href={`/clients/${clientId}/schedule`}
                  className={btn.outline}
                >
                  See what is already scheduled
                </Link>
              </div>
            </div>
          )}

          {/* Coverage — the number a human actually judges the plan by. */}
          <section>
            <h2 className={`${text.cardTitle} mb-3`}>Coverage</h2>
            <div className={`${surface.table} overflow-x-auto`}>
              <table className="w-full">
                <thead>
                  <tr className="bg-stone-50">
                    <th className={`${table.head} w-32`}>Week</th>
                    <th className={`${table.head} w-24`}>Type</th>
                    <th className={`${table.head} w-24`}>Cap / week</th>
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
                        <td className={table.cell}>
                          {gap.quotaCount > 0 ? gap.quotaCount : "—"}
                        </td>
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
                              <p className="font-medium text-slate-800">
                                {slot.theme}
                              </p>
                              {/* Runs predating the piece structure have none
                                  of these, so each is guarded. */}
                              {slot.hook && (
                                <p className="text-sm text-slate-700 mt-1">
                                  {slot.hook}
                                </p>
                              )}
                              {slot.body?.length > 0 && (
                                <ol className="text-xs text-slate-500 mt-1 list-decimal ml-4 space-y-0.5">
                                  {slot.body.map((beat, i) => (
                                    <li key={i}>{beat}</li>
                                  ))}
                                </ol>
                              )}
                              {slot.cta && (
                                <p className="text-xs text-teal-700 mt-1">
                                  → {slot.cta}
                                </p>
                              )}
                              {slot.rationale && (
                                <p className="text-xs text-slate-400 mt-1">
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
              <span className="flex gap-2 shrink-0">
                <button
                  onClick={handleDiscard}
                  disabled={discarding}
                  className={btn.danger}
                >
                  {discarding ? "Deleting…" : "Delete this plan"}
                </button>
                <button
                  onClick={handlePreview}
                  disabled={planning}
                  className={btn.outline}
                >
                  Plan the next stretch
                </button>
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">
                Preview only. Nothing has been written to the calendar yet.
              </p>
              <span className="flex gap-2 shrink-0">
                <button
                  onClick={handleDiscard}
                  disabled={discarding}
                  className={btn.outline}
                >
                  {discarding ? "Discarding…" : "Discard"}
                </button>
                <button
                  onClick={handleCommit}
                  disabled={committing || run.proposed_slots.length === 0}
                  className={btn.primarySm}
                >
                  {committing
                    ? "Committing…"
                    : `Accept ${run.proposed_slots.length} slot${
                        run.proposed_slots.length === 1 ? "" : "s"
                      }`}
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
