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
  dropPlanSlots,
  restorePlanSlots,
  replaceDroppedSlots,
} from "@/lib/api";
import type { CampaignListItem } from "@/lib/types";
import { banner, btn, field, surface, table, text } from "@/lib/ui";
import { channelPill, PILL } from "@/lib/ui-status";
import { contentTypeLabel } from "@/lib/marketing/content-types";
import type { PlanRun, ProposedSlot } from "@/lib/types";

export default function PlanPage() {
  const { clientId } = useParams() as { clientId: string };
  const [run, setRun] = useState<PlanRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  // The slot currently being dropped or restored, so only its own button goes
  // busy rather than the whole table.
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  // Reason boxes are edited locally and saved on blur; the stored reason is the
  // fallback, so a reload shows what was saved rather than an empty box.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string[]>([]);

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
      setRun(await previewPlan(clientId));
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

  // All three edit endpoints answer with the whole run, so the page swaps its
  // state rather than patching it — the same habit as handleCommit.
  const applyEdit = (next: PlanRun & { drop_warnings?: string[] }) => {
    setRun(next);
    setNotes(next.drop_warnings ?? []);
  };

  const handleDrop = async (slotId: string) => {
    if (!run) return;
    setBusySlot(slotId);
    setError(null);
    try {
      applyEdit(await dropPlanSlots(clientId, run.id, [{ slotId }]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not drop that idea");
    } finally {
      setBusySlot(null);
    }
  };

  const handleRestore = async (slotId: string) => {
    if (!run) return;
    setBusySlot(slotId);
    setError(null);
    try {
      applyEdit(await restorePlanSlots(clientId, run.id, [slotId]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore that idea");
    } finally {
      setBusySlot(null);
    }
  };

  /** Save on blur, and only when the text actually changed. */
  const handleReason = async (slotId: string, saved: string) => {
    if (!run) return;
    const reason = (reasons[slotId] ?? saved).trim();
    if (reason === saved.trim()) return;
    try {
      applyEdit(await dropPlanSlots(clientId, run.id, [{ slotId, reason }]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that reason");
    }
  };

  const handleReplace = async () => {
    if (!run) return;
    setReplacing(true);
    setError(null);
    try {
      applyEdit(await replaceDroppedSlots(clientId, run.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate replacements");
    } finally {
      setReplacing(false);
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

  // Only the drops still waiting for a replacement are actionable; the rest
  // are history, kept because every dropped theme stays on the avoid-list.
  const openDropped = (run?.dropped_slots ?? []).filter((d) => d.replacedAt === null);

  const byCampaign = (run?.proposed_slots ?? []).reduce<Record<string, ProposedSlot[]>>(
    (acc, slot) => {
      (acc[slot.campaignTitle || "Unattributed"] ||= []).push(slot);
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
              ? `${run.proposed_slots.length} piece${
                  run.proposed_slots.length === 1 ? "" : "s"
                } written for your active campaigns`
              : "Write the content your active campaigns still owe"}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={handlePreview}
            disabled={planning}
            className={btn.primarySm}
          >
            {planning ? "Writing… (30-90s)" : "Generate preview"}
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
          The theme model was unavailable. Each piece is still attached to the
          campaign that asked for it, but the themes are missing and marked
          below.
        </p>
      )}

      {loading ? (
        <p className={text.muted}>Loading…</p>
      ) : !run ? (
        <div className={surface.empty}>
          <p className="text-slate-700 text-lg">No plan yet.</p>
          <p className="text-slate-500 text-sm mt-1">
            Generate a preview to write everything your active campaigns still
            owe. Nothing is scheduled — you pick the days afterwards.
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
          {run.proposed_slots.length === 0 && openDropped.length === 0 && (
            <div className={`${surface.card} ${surface.pad}`}>
              <h2 className={`${text.cardTitle} mb-2`}>Nothing left to write</h2>
              <p className="text-sm text-slate-600 mb-3">
                Every active campaign&rsquo;s content plan has been delivered.
                Accept a new campaign, or raise an existing one&rsquo;s content
                plan, to give the planner something to write.
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
                <Link
                  href={`/clients/${clientId}/campaigns`}
                  className={btn.outline}
                >
                  Review campaigns
                </Link>
                <Link
                  href={`/clients/${clientId}/schedule`}
                  className={btn.outline}
                >
                  See what is already written
                </Link>
              </div>
            </div>
          )}

          {/* What each campaign asked for, and how much of it this run wrote. */}
          <section>
            <h2 className={`${text.cardTitle} mb-3`}>Against the content plan</h2>
            <div className={`${surface.table} overflow-x-auto`}>
              <table className="w-full">
                <thead>
                  <tr className="bg-stone-50">
                    <th className={`${table.head} w-56`}>Campaign</th>
                    <th className={`${table.head} w-24`}>Type</th>
                    <th className={`${table.head} w-24`}>Asked for</th>
                    <th className={`${table.head} w-24`}>Delivered</th>
                    <th className={`${table.head} w-24`}>Written</th>
                    <th className={table.head}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {run.observation.demand.map((row, i) => {
                    const written = run.proposed_slots.filter(
                      (s) => s.campaignId === row.campaignId && s.type === row.type
                    ).length;
                    return (
                      <tr key={i} className={table.row}>
                        <td className={`${table.cell} font-medium`}>
                          {row.campaignTitle}
                        </td>
                        <td className={table.cell}>
                          {contentTypeLabel(row.type)}
                        </td>
                        <td className={table.cell}>{row.planned}</td>
                        <td className={table.cell}>{row.delivered}</td>
                        <td
                          className={`${table.cell} ${
                            written < row.outstanding
                              ? "text-amber-700 font-medium"
                              : ""
                          }`}
                        >
                          +{written}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {row.notes.join(" ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Written pieces, grouped by the campaign that asked for them —
              which is the only grouping there is until someone picks days. */}
          {Object.entries(byCampaign).map(([campaignTitle, slots]) => (
            <section key={campaignTitle}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className={text.cardTitle}>{campaignTitle}</h2>
                <span className={`${PILL} bg-slate-100 text-slate-500`}>
                  {slots.length}
                </span>
              </div>
              <div className={`${surface.table} overflow-x-auto`}>
                <table className="w-full">
                  <thead>
                    <tr className="bg-stone-50">
                      <th className={`${table.head} w-28`}>Channel</th>
                      <th className={`${table.head} w-24`}>Type</th>
                      <th className={table.head}>Theme</th>
                      <th className={`${table.head} w-20`}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((slot) => (
                      <tr key={slot.slotId} className={table.row}>
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
                        <td className="px-4 py-3 text-right">
                          {/* Nothing is committed yet, so this is not a
                              destructive action and asks for no confirmation.
                              Restore is one click away below. */}
                          <button
                            onClick={() => handleDrop(slot.slotId)}
                            disabled={busySlot === slot.slotId || !!run.committed_at}
                            className={btn.ghost}
                          >
                            {busySlot === slot.slotId ? "…" : "Drop"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {/* Dropped ideas. The reason box is the point of the whole panel: it
              is what the replacement is steered by, and without it a second
              attempt is just a reroll. */}
          {run.dropped_slots.length > 0 && (
            <section className={`${surface.card} ${surface.pad}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <h2 className={text.cardTitle}>
                  Dropped
                  <span className={`${PILL} ml-2 bg-slate-100 text-slate-500`}>
                    {openDropped.length}
                  </span>
                </h2>
                {openDropped.length > 0 && !run.committed_at && (
                  <button
                    onClick={handleReplace}
                    disabled={replacing}
                    className={btn.primarySm}
                  >
                    {replacing
                      ? "Rethinking… (15-30s)"
                      : `Regenerate ${openDropped.length} idea${
                          openDropped.length === 1 ? "" : "s"
                        }`}
                  </button>
                )}
              </div>
              <p className="text-sm text-slate-500 mb-4">
                Kept out of the plan. Say what was wrong and regenerate to get a
                different idea for the same slot — one model call for all of
                them — or just accept the rest and leave the gaps for the next
                run.
              </p>

              <div className="space-y-3">
                {run.dropped_slots.map((entry) => {
                  const replaced = entry.replacedAt !== null;
                  return (
                    <div
                      key={`${entry.slotId}-${entry.droppedAt}`}
                      className={`rounded-lg border p-3 ${
                        replaced
                          ? "border-slate-100 bg-stone-50/60"
                          : "border-slate-200"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-400">
                            {entry.campaignTitle} · {contentTypeLabel(entry.type)}{" "}
                            · {entry.channel}
                          </p>
                          <p
                            className={`font-medium ${
                              replaced
                                ? "text-slate-400 line-through"
                                : "text-slate-700"
                            }`}
                          >
                            {entry.theme || "(no theme)"}
                          </p>
                        </div>
                        {replaced ? (
                          <span className={`${PILL} bg-teal-50 text-teal-700 shrink-0`}>
                            replaced
                          </span>
                        ) : (
                          !run.committed_at && (
                            <button
                              onClick={() => handleRestore(entry.slotId)}
                              disabled={busySlot === entry.slotId}
                              className={`${btn.outlineSm} shrink-0`}
                            >
                              {busySlot === entry.slotId ? "…" : "Restore"}
                            </button>
                          )
                        )}
                      </div>

                      {!replaced && !run.committed_at && (
                        <input
                          value={reasons[entry.slotId] ?? entry.reason}
                          onChange={(e) =>
                            setReasons((r) => ({
                              ...r,
                              [entry.slotId]: e.target.value,
                            }))
                          }
                          onBlur={() => handleReason(entry.slotId, entry.reason)}
                          maxLength={300}
                          placeholder="Optional: what was wrong? — e.g. too salesy, we said this in March"
                          className={`${field.inputSm} mt-2`}
                        />
                      )}
                      {replaced && entry.reason && (
                        <p className="text-xs text-slate-400 mt-1">
                          Rejected: {entry.reason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {notes.length > 0 && (
            <div className={banner.warn}>
              {notes.map((n, i) => (
                <p key={i} className="text-sm">
                  {n}
                </p>
              ))}
            </div>
          )}

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
                    </span>
                    : {d.reason}
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
