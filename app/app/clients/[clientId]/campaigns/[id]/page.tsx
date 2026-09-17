"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StageRail, type Stage } from "@/components/shared/stage-rail";
import { PieceCard, fromProposed, fromSlot } from "@/components/shared/piece-card";
import { backLink, banner, btn, field, surface, table, text } from "@/lib/ui";
import { ChevronLeft } from "lucide-react";
import { PILL, statusColor, statusLabel } from "@/lib/ui-status";
import {
  getCampaign,
  improveCampaign,
  reviewCampaign,
  acceptCampaign,
  rejectCampaign,
  completeCampaign,
  deleteCampaign,
  updateCampaign,
  getStrategy,
  listPlanRuns,
  listSlots,
  previewPlan,
  commitPlan,
  dropPlanSlots,
  restorePlanSlots,
  replaceDroppedSlots,
  writeProposedSlotCopy,
  scheduleSlot,
  getClient,
  getGoogleStatus,
  startGoogleConnect,
  syncCalendar,
  resetClientCalendar,
} from "@/lib/api";
import { calendarOpenUrl } from "@/lib/marketing/calendar-links";
import { readGoogleResult } from "@/lib/google-result";
import { CopyView } from "@/components/shared/copy-view";
import { StateLabel } from "@/components/shared/state-label";
import { readCopy, isCopyStale } from "@/lib/marketing/copy";
import type {
  Campaign,
  QuotaEntry,
  PlanRun,
  Slot,
  DroppedSlot,
} from "@/lib/types";
import { CONTENT_TYPES, contentTypeLabel } from "@/lib/marketing/content-types";

/**
 * The campaign workspace.
 *
 * This page used to be three tabs — Strategy, Content plan, Review & improve —
 * with a "Plan content" button that navigated AWAY to a client-wide planner. So
 * a campaign had no page showing what had been written for it, and answering
 * "where is this campaign up to" meant clicking all three tabs and then leaving.
 *
 * It is now the whole job, as the sequence it actually is:
 *
 *   ① Brief     what it is for, what it owes, and accepting it
 *   ② Content   the pieces written for it — drop, regenerate, accept
 *   ③ Schedule  its accepted pieces, and giving them days
 *   ④ Calendar  pushing those days to Google, and what came back
 *
 * Everything here is scoped to this campaign, including generation: a plan run
 * belongs to one campaign, so what stage ② shows is exactly what accepting it
 * will write. It was not always so — the planner used to run client-wide while
 * this page filtered the display, which meant accepting here committed content
 * for campaigns you never saw.
 */

export default function CampaignWorkspace() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [accountQuota, setAccountQuota] = useState<Record<string, QuotaEntry>>({});
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState("brief");

  // ?stage=schedule is how a piece's "back" link returns you to the stage you
  // left from. Read once on mount, the house idiom for search params here.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("stage");
    if (wanted && ["brief", "content", "schedule", "calendar"].includes(wanted)) {
      setStage(wanted);
    }
  }, []);

  // ① Brief
  const [feedback, setFeedback] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [improving, setImproving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);

  // ② Content
  const [run, setRun] = useState<PlanRun | null>(null);
  const [planning, setPlanning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  /**
   * The one piece whose copy is open. A single id rather than a set: reading
   * two pieces' words side by side is not the job here, and one open card keeps
   * the list scannable.
   */
  const [openPiece, setOpenPiece] = useState<string | null>(null);
  const [copySteer, setCopySteer] = useState("");
  const [writingCopy, setWritingCopy] = useState<string | null>(null);

  // ③ Schedule
  const [slots, setSlots] = useState<Slot[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [datingId, setDatingId] = useState<string | null>(null);
  const [quotaNote, setQuotaNote] = useState<string | null>(null);

  // ④ Calendar
  const [google, setGoogle] = useState<{
    configured: boolean;
    missing: string[];
    connected: boolean;
    email: string | null;
    needs_reconnect: boolean;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  // What the last sync adopted FROM Google rather than pushed to it. These are
  // changes a person made in their own calendar, so they are read, not counted.
  const [syncChanges, setSyncChanges] = useState<string[]>([]);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);
  // Set by a sync that 404'd on the calendar itself — the one failure with a
  // specific cure, so it gets a button rather than another line of prose.
  const [calendarMissing, setCalendarMissing] = useState(false);
  const [calendarUrl, setCalendarUrl] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGoogleStatus().then(setGoogle).catch(() => setGoogle(null));
    // handleConnect sends this page's own path as returnTo, so the callback
    // lands back here — and until now nothing read the result, which meant a
    // failed connection from this page reported nothing at all.
    const result = readGoogleResult();
    if (result) {
      if (result.connected) setSyncNote("Google connected");
      else setError(result.message);
    }
    getClient(clientId)
      .then((c) => {
        // The id is on the client the moment the calendar exists, so the link
        // works before the first push rather than only after one.
        if (c.google_calendar_id) setCalendarUrl(calendarOpenUrl(c.google_calendar_id));
      })
      .catch(() => {});
  }, [clientId]);

  useEffect(() => {
    Promise.all([
      getCampaign(clientId, campaignId),
      getStrategy(clientId).catch(() => null),
    ])
      .then(([camp, strategy]) => {
        setCampaign(camp);
        if (strategy?.content_quota?.weekly) {
          setAccountQuota(strategy.content_quota.weekly);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"))
      .finally(() => setLoading(false));
  }, [clientId, campaignId]);

  const loadRun = useCallback(() => {
    // Scoped, or "the latest run" would be the latest run for the CLIENT — and
    // this page would show another campaign's work, filter it to nothing, and
    // report that nothing was written for this one.
    listPlanRuns(clientId, 1, campaignId)
      .then((runs) => setRun(runs[0] ?? null))
      .catch(() => {});
  }, [clientId, campaignId]);

  const loadSlots = useCallback(() => {
    listSlots(clientId)
      .then((all) => setSlots(all.filter((s) => s.campaign_id === campaignId)))
      .catch(() => {});
  }, [clientId, campaignId]);

  useEffect(() => {
    loadRun();
    loadSlots();
  }, [loadRun, loadSlots]);

  /* ------------------------------------------------------------- ① brief -- */

  const updateBreakdown = (newBreakdown: Array<Record<string, unknown>>) => {
    if (!campaign) return;
    setCampaign({
      ...campaign,
      content_plan: {
        ...campaign.content_plan,
        breakdown: newBreakdown,
        total_pieces: newBreakdown.reduce(
          (sum, item) => sum + (Number(item.count) || 0),
          0
        ),
      },
    });
    setPlanSaved(false);
  };

  const saveContentPlan = async () => {
    if (!campaign) return;
    setPlanSaving(true);
    try {
      setCampaign(
        await updateCampaign(clientId, campaignId, {
          content_plan: campaign.content_plan,
        })
      );
      setPlanSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the content plan");
    } finally {
      setPlanSaving(false);
    }
  };

  const runCampaignAction = async (fn: () => Promise<Campaign>) => {
    setActionLoading(true);
    setError(null);
    try {
      setCampaign(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work");
    } finally {
      setActionLoading(false);
    }
  };

  const handleImprove = async () => {
    if (!feedback.trim()) return;
    setImproving(true);
    setError(null);
    try {
      setCampaign(await improveCampaign(clientId, campaignId, feedback));
      setFeedback("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not improve the campaign");
    } finally {
      setImproving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this campaign? Its content plan goes with it.")) return;
    try {
      await deleteCampaign(clientId, campaignId);
      router.push(`/clients/${clientId}/campaigns`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the campaign");
    }
  };

  /* ----------------------------------------------------------- ② content -- */

  const applyEdit = (next: PlanRun) => setRun(next);

  const handlePreview = async () => {
    setPlanning(true);
    setError(null);
    try {
      setRun(await previewPlan(clientId, campaignId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Writing failed");
    } finally {
      setPlanning(false);
    }
  };

  const handleCommit = async () => {
    if (!run) return;
    setCommitting(true);
    setError(null);
    try {
      applyEdit(await commitPlan(clientId, run.id));
      loadSlots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept the plan");
    } finally {
      setCommitting(false);
    }
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

  /** Saved on blur, and only when the text actually changed. */
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
      setError(e instanceof Error ? e.message : "Could not write replacements");
    } finally {
      setReplacing(false);
    }
  };

  /**
   * Write one proposed piece's copy, before the plan is accepted.
   *
   * One model call, and slow — the route allows 300s — so the busy state is per
   * piece and the button says what it is waiting for. The whole run comes back,
   * matching every other preview edit, so state is replaced rather than patched.
   */
  const handleWriteProposedCopy = async (slotId: string) => {
    if (!run) return;
    setWritingCopy(slotId);
    setError(null);
    try {
      applyEdit(
        await writeProposedSlotCopy(clientId, run.id, slotId, copySteer.trim() || undefined)
      );
      setCopySteer("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not write the copy");
    } finally {
      setWritingCopy(null);
    }
  };

  /* ---------------------------------------------------------- ③ schedule -- */

  const handleSchedule = async (slot: Slot) => {
    const date = dates[slot.id];
    if (!date) return;
    setDatingId(slot.id);
    setError(null);
    try {
      const updated = await scheduleSlot(clientId, slot.id, { date });
      setQuotaNote(updated.quota_warning ?? null);
      setDates((d) => {
        const next = { ...d };
        delete next[slot.id];
        return next;
      });
      loadSlots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set that day");
    } finally {
      setDatingId(null);
    }
  };

  /* ---------------------------------------------------------- ④ calendar -- */

  const handleConnect = async () => {
    try {
      const { url } = await startGoogleConnect(window.location.pathname);
      // A full navigation, not a fetch: this is Google's own consent screen.
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the Google connection");
    }
  };

  /**
   * Push this campaign's days to Google.
   *
   * Sync is addressed by date range, not by campaign, so the range is this
   * campaign's own span — first dated piece to last. Anything else scheduled
   * inside that window goes up with it, which the panel says out loud.
   */
  const handleSync = async (start: string, end: string) => {
    setSyncing(true);
    setError(null);
    setSyncNote(null);
    setSyncChanges([]);
    setSyncWarnings([]);
    setCalendarMissing(false);
    try {
      const r = await syncCalendar(clientId, { start, end });
      setCalendarMissing(r.calendarMissing);
      setCalendarUrl(r.open_url);
      setSyncNote(
        [
          `${r.synced} event${r.synced === 1 ? "" : "s"} written`,
          r.removed > 0 ? `${r.removed} removed` : null,
          r.adopted > 0 ? `${r.adopted} moved` : null,
          r.cancelled > 0 ? `${r.cancelled} cancelled` : null,
          r.locked > 0 ? `${r.locked} handed to Google` : null,
          r.failed > 0 ? `${r.failed} failed` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      );
      setSyncChanges(r.changes);
      setSyncWarnings(r.warnings);
      if (r.errors.length > 0) setError(r.errors.slice(0, 3).join(" · "));
      loadSlots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  /** Forget a calendar that is no longer there. See the schedule page. */
  const handleResetCalendar = async () => {
    if (
      !confirm(
        "Build a new calendar for this client?\n\n" +
          "The pieces here stop pointing at the old calendar's events, and the " +
          "next push creates a fresh calendar and writes them again. Nothing is " +
          "deleted from Google — the old calendar stays exactly as it is."
      )
    ) {
      return;
    }
    setError(null);
    try {
      await resetClientCalendar(clientId);
      setCalendarMissing(false);
      setSyncWarnings([]);
      setCalendarUrl(null);
      setSyncNote("Calendar reset — press Push to Google to build a new one");
      loadSlots();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the calendar");
    }
  };

  /* ------------------------------------------------------------ derived -- */

  if (loading) return <p className={text.muted}>Loading…</p>;
  if (!campaign) return <p className={banner.error}>Campaign not found.</p>;

  const strategy = campaign.strategy || {};
  const contentPlan = campaign.content_plan || {};
  const breakdown = (contentPlan.breakdown || []) as Array<Record<string, unknown>>;
  const isActionable = ["proposal", "in_review"].includes(campaign.status);

  const owed = breakdown.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

  /**
   * The run as it stands — NOT filtered.
   *
   * A run is fetched by campaign and generated for one, so there is nothing to
   * filter out. Deliberately left unfiltered rather than kept "for safety":
   * hiding part of a run while the accept button commits all of it is the
   * exact defect this replaced. If a run ever holds something unexpected, it
   * should be visible before you accept it.
   */
  const mine = run?.proposed_slots ?? [];
  const myDropped = run?.dropped_slots ?? [];
  const openDropped = myDropped.filter((d: DroppedSlot) => d.replacedAt === null);

  const dated = slots
    .filter((s) => s.date)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const undated = slots.filter((s) => !s.date);

  // A piece is on Google once it has an event id. "pending" and "error" both
  // mean it is not there yet; "stale" means it is, but out of date.
  const onGoogle = dated.filter((s) => s.google_event_id);

  // How much of this campaign has words, not just a brief — the one number that
  // says whether the content is ready to be judged or only ready to be read.
  const withCopy = mine.filter((s) => readCopy(s)).length;
  const span =
    dated.length > 0
      ? { start: dated[0].date as string, end: dated[dated.length - 1].date as string }
      : null;

  const STAGES: Stage[] = [
    {
      value: "brief",
      label: "Brief",
      detail: owed > 0 ? `${owed} pieces owed a week` : "No content plan yet",
      ready: true,
    },
    {
      value: "content",
      label: "Content",
      detail:
        mine.length === 0 && myDropped.length === 0
          ? "Nothing written yet"
          : [
              `${mine.length} written`,
              withCopy > 0 ? `${withCopy} with copy` : null,
              openDropped.length > 0 ? `${openDropped.length} dropped` : null,
            ]
              .filter(Boolean)
              .join(" · "),
      ready: campaign.status === "active",
    },
    {
      value: "schedule",
      label: "Schedule",
      detail:
        slots.length === 0
          ? "Nothing accepted yet"
          : undated.length > 0
            ? `${dated.length} of ${slots.length} dated · ${undated.length} need a day`
            : `${dated.length} scheduled`,
      // Always reachable. An empty stage that explains itself and offers a way
      // forward beats a dead button you cannot interrogate.
      ready: true,
    },
    {
      value: "calendar",
      label: "On the calendar",
      detail:
        dated.length === 0
          ? "Nothing dated yet"
          : google && !google.connected
            ? "Google not connected"
            : `${onGoogle.length} of ${dated.length} on Google`,
      ready: true,
    },
  ];

  return (
    <div className="max-w-4xl">
      <Link href={`/clients/${clientId}/campaigns`} className={`${backLink} mb-3`}>
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        Campaigns
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h1 className={text.h1}>{campaign.title}</h1>
            <span className={`${PILL} ${statusColor(campaign.status)}`}>
              {statusLabel(campaign.status)}
            </span>
          </div>
          {campaign.description && (
            <p className="text-slate-600">{campaign.description}</p>
          )}
          <p className="text-xs text-slate-400 mt-1">
            Created {new Date(campaign.created_at).toLocaleDateString()}
            {campaign.start_date && ` · Runs ${campaign.start_date}`}
            {campaign.end_date && ` to ${campaign.end_date}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {campaign.status === "active" && (
            <button
              onClick={() => runCampaignAction(() => completeCampaign(clientId, campaignId))}
              disabled={actionLoading}
              className={btn.outline}
            >
              Mark complete
            </button>
          )}
          <button onClick={handleDelete} className={btn.danger}>
            Delete
          </button>
        </div>
      </div>

      <StageRail stages={STAGES} value={stage} onChange={setStage} />

      {error && <p className={`${banner.error} mb-4`}>{error}</p>}

      {/* ============================================================ ① -- */}
      {stage === "brief" && (
        <div className="grid gap-4">
          <section className={`${surface.card} ${surface.pad}`}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className={text.cardTitle}>What it owes, each week</h2>
              <button
                onClick={saveContentPlan}
                disabled={planSaving || planSaved}
                className={btn.outlineSm}
              >
                {planSaving ? "Saving…" : planSaved ? "Saved" : "Save changes"}
              </button>
            </div>

            {breakdown.length > 0 ? (
              <div className={`${surface.table} overflow-x-auto`}>
                <table className="w-full">
                  <thead>
                    <tr className="bg-stone-50">
                      <th className={table.head}>Type</th>
                      <th className={table.head}>Per week</th>
                      <th className={table.head}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.map((item, i) => (
                      <tr key={i} className={table.row}>
                        <td className={`${table.cell} font-medium`}>
                          {contentTypeLabel(String(item.type))}
                        </td>
                        <td className={table.cell}>
                          <input
                            type="number"
                            min={0}
                            value={Number(item.count) || 0}
                            onChange={(e) => {
                              const updated = [...breakdown];
                              updated[i] = {
                                ...updated[i],
                                count: parseInt(e.target.value) || 0,
                              };
                              updateBreakdown(updated);
                            }}
                            className={`${field.inputSm} w-20`}
                          />
                        </td>
                        <td className={`${table.cell} text-right`}>
                          <button
                            className={btn.ghost}
                            onClick={() =>
                              updateBreakdown(breakdown.filter((_, j) => j !== i))
                            }
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={text.muted}>
                Nothing yet. Add a content type below and this campaign starts
                asking for work.
              </p>
            )}

            {(() => {
              const used = breakdown.map((item) => String(item.type));
              const available = CONTENT_TYPES.filter((t) => !used.includes(t.key));
              if (available.length === 0) return null;
              return (
                <div className="flex flex-wrap gap-2 mt-4">
                  <span className="text-sm text-slate-500 self-center">Add:</span>
                  {available.map((spec) => (
                    <button
                      key={spec.key}
                      className={btn.outlineSm}
                      title={spec.description}
                      onClick={() =>
                        updateBreakdown([...breakdown, { type: spec.key, count: 1 }])
                      }
                    >
                      + {spec.label}
                    </button>
                  ))}
                </div>
              );
            })()}
          </section>

          {Object.keys(accountQuota).length > 0 && (
            <section className={`${surface.card} ${surface.pad}`}>
              <h2 className={`${text.cardTitle} mb-1`}>
                The account&rsquo;s weekly pace
              </h2>
              <p className="text-sm text-slate-500 mb-3">
                Set on the Strategy page. It paces scheduling, not writing — going
                over warns, it never refuses.
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(accountQuota).map(([quotaType, entry]) => (
                  <div
                    key={quotaType}
                    className="rounded-lg bg-stone-50 border border-slate-200 px-3 py-1.5 text-sm"
                  >
                    <span className="font-semibold text-slate-800">
                      {entry.count}
                    </span>{" "}
                    <span className="text-slate-500">
                      {quotaType}
                      {entry.count !== 1 ? "s" : ""}/week
                    </span>
                    {entry.channels.length > 0 && (
                      <span className="text-slate-400 text-xs">
                        {" "}
                        · {entry.channels.join(", ")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {Object.keys(strategy).length > 0 && (
            <section className={`${surface.card} ${surface.pad}`}>
              <h2 className={`${text.cardTitle} mb-4`}>What it is for</h2>
              <div className="grid gap-4">
                {Object.entries(strategy).map(([key, value]) => (
                  <div key={key}>
                    <p className={`${field.micro} capitalize`}>
                      {key.replace(/_/g, " ")}
                    </p>
                    {Array.isArray(value) ? (
                      <div className="flex flex-wrap gap-2">
                        {value.map((v, i) => (
                          <span key={i} className={`${PILL} bg-slate-100 text-slate-600`}>
                            {String(v)}
                          </span>
                        ))}
                      </div>
                    ) : typeof value === "object" ? (
                      <pre className={`${surface.inset} text-xs whitespace-pre-wrap font-mono`}>
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-sm text-slate-700">{String(value)}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {Array.isArray(contentPlan.timeline) && contentPlan.timeline.length > 0 && (
            <section className={`${surface.card} ${surface.pad}`}>
              <h2 className={`${text.cardTitle} mb-3`}>Timeline</h2>
              <div className="space-y-2">
                {(contentPlan.timeline as Array<Record<string, unknown>>).map(
                  (item, i) => (
                    <div key={i} className="text-sm text-slate-700">
                      <span className="font-semibold">Week {String(item.week)}:</span>{" "}
                      {String(item.focus)}
                    </div>
                  )
                )}
              </div>
            </section>
          )}

          {campaign.feedback_history.length > 0 && (
            <section className={`${surface.card} ${surface.pad}`}>
              <h2 className={`${text.cardTitle} mb-3`}>Feedback history</h2>
              <div className="space-y-3">
                {campaign.feedback_history.map((entry, i) => (
                  <div key={i} className="border-l-2 border-slate-200 pl-3 text-sm">
                    <p className="text-slate-600">{entry.feedback}</p>
                    {entry.changes && (
                      <p className="text-xs text-teal-700 mt-1">
                        Changed: {entry.changes}
                      </p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      {entry.improved_at
                        ? `Improved ${new Date(entry.improved_at).toLocaleString()}`
                        : entry.submitted_at
                          ? `Submitted ${new Date(entry.submitted_at).toLocaleString()}`
                          : ""}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {campaign.status === "rejected" && campaign.rejection_reason && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-red-700 mb-2">
                Why it was rejected
              </h2>
              <p className="text-sm text-red-600">{campaign.rejection_reason}</p>
            </section>
          )}

          {isActionable && (
            <>
              <section className={`${surface.card} ${surface.pad}`}>
                <h2 className={`${text.cardTitle} mb-3`}>Send it back for changes</h2>
                <div className="space-y-3">
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What should be different? Be specific…"
                    className={`${field.textarea} h-24`}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() =>
                        runCampaignAction(async () => {
                          const c = await reviewCampaign(clientId, campaignId, feedback);
                          setFeedback("");
                          return c;
                        })
                      }
                      disabled={!feedback.trim() || actionLoading}
                      className={btn.outline}
                    >
                      Save feedback
                    </button>
                    <button
                      onClick={handleImprove}
                      disabled={!feedback.trim() || improving}
                      className={btn.primarySm}
                    >
                      {improving ? "Rewriting…" : "Rewrite with the agent"}
                    </button>
                  </div>
                </div>
              </section>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() =>
                    runCampaignAction(() => acceptCampaign(clientId, campaignId))
                  }
                  disabled={actionLoading}
                  className={`${btn.primary} flex-1`}
                >
                  Accept campaign
                </button>
                <div className="flex-1 space-y-2">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Why are you rejecting it?"
                    className={`${field.textarea} h-16`}
                  />
                  <button
                    onClick={() =>
                      runCampaignAction(() =>
                        rejectCampaign(clientId, campaignId, rejectReason)
                      )
                    }
                    disabled={!rejectReason.trim() || actionLoading}
                    className={`${btn.danger} w-full`}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ============================================================ ② -- */}
      {stage === "content" && (
        <div className="space-y-6">
          {campaign.status !== "active" ? (
            <div className={surface.empty}>
              <p className="text-slate-700 text-lg">
                Accept the campaign to write its content.
              </p>
              <p className="text-slate-500 text-sm mt-1">
                The agent only writes what an accepted campaign asks for.
              </p>
              <button onClick={() => setStage("brief")} className={`${btn.primary} mt-6`}>
                Back to the brief
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-500">
                  {mine.length > 0
                    ? `${mine.length} piece${mine.length === 1 ? "" : "s"} written for this campaign. Nothing is scheduled — you pick the days afterwards.`
                    : "Write everything this campaign still owes."}
                </p>
                <button
                  onClick={handlePreview}
                  disabled={planning}
                  className={btn.primarySm}
                >
                  {planning ? "Writing… (30-90s)" : "Write content"}
                </button>
              </div>


              {run?.status === "degraded" && (
                <p className={banner.warn}>
                  The theme model was unavailable. Each piece is still attached to
                  the campaign that asked for it, but the themes are missing.
                </p>
              )}

              {mine.length === 0 && myDropped.length === 0 ? (
                <div className={surface.empty}>
                  <p className="text-slate-700 text-lg">Nothing written yet.</p>
                  <p className="text-slate-500 text-sm mt-1">
                    {run
                      ? "The last run wrote nothing for this campaign — everything it asks for may already be delivered."
                      : "Write the content this campaign owes, then keep what you like."}
                  </p>
                  <button
                    onClick={handlePreview}
                    disabled={planning}
                    className={`${btn.primary} mt-6`}
                  >
                    {planning ? "Writing…" : "Write content"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {mine.map((slot) => {
                      // readCopy and isCopyStale take the fields they read, so
                      // a proposal works here exactly as a committed slot does.
                      const copy = readCopy(slot);
                      const stale = isCopyStale(slot);
                      const open = openPiece === slot.slotId;
                      const writing = writingCopy === slot.slotId;
                      // The same guard writeCopy enforces server-side: there is
                      // nothing to write copy from without a theme.
                      const canWrite = !slot.needsTheme && !!slot.theme && !run?.committed_at;

                      return (
                        <PieceCard
                          key={slot.slotId}
                          piece={fromProposed(slot)}
                          action={
                            <button
                              onClick={() => handleDrop(slot.slotId)}
                              disabled={busySlot === slot.slotId || !!run?.committed_at}
                              className={btn.ghost}
                            >
                              {busySlot === slot.slotId ? "…" : "Drop"}
                            </button>
                          }
                          footer={
                            <>
                              {copy ? (
                                <StateLabel tone={stale ? "warn" : "good"}>
                                  {stale ? "copy is older than the brief" : "copy ready"}
                                </StateLabel>
                              ) : (
                                <StateLabel tone="muted">no copy yet</StateLabel>
                              )}
                              {canWrite && (
                                <button
                                  onClick={() =>
                                    setOpenPiece(open ? null : slot.slotId)
                                  }
                                  className={btn.link}
                                >
                                  {open ? "Hide" : copy ? "Read the copy" : "Write the copy"}
                                </button>
                              )}
                            </>
                          }
                        >
                          {open && canWrite && (
                            <>
                              {copy && <CopyView copy={copy} />}
                              {stale && (
                                <p className={banner.warn}>
                                  The brief changed after this was written, so the
                                  two no longer match. Write it again to catch up.
                                </p>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  className={`${field.inputSm} flex-1 min-w-[16rem]`}
                                  value={copySteer}
                                  onChange={(e) => setCopySteer(e.target.value)}
                                  placeholder="Optional: how to write it — e.g. shorter slides, no questions"
                                />
                                <button
                                  onClick={() => handleWriteProposedCopy(slot.slotId)}
                                  disabled={writing}
                                  className={btn.primarySm}
                                >
                                  {writing
                                    ? "Writing… (up to 5 min)"
                                    : copy
                                      ? "Write it again"
                                      : "Write the copy"}
                                </button>
                              </div>
                            </>
                          )}
                        </PieceCard>
                      );
                    })}
                  </div>

                  {myDropped.length > 0 && (
                    <section className={`${surface.card} ${surface.pad}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                        <h2 className={text.cardTitle}>
                          Dropped
                          <span className={`${PILL} ml-2 bg-slate-100 text-slate-500`}>
                            {openDropped.length}
                          </span>
                        </h2>
                        {openDropped.length > 0 && !run?.committed_at && (
                          <button
                            onClick={handleReplace}
                            disabled={replacing}
                            className={btn.primarySm}
                          >
                            {replacing
                              ? "Rethinking… (15-30s)"
                              : `Rewrite ${openDropped.length} idea${
                                  openDropped.length === 1 ? "" : "s"
                                }`}
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 mb-4">
                        Say what was wrong and rewrite to get a different idea for
                        the same slot — one model call for all of them. Or leave
                        them: the campaign still owes the piece, so the next run
                        writes it again.
                      </p>

                      <div className="space-y-3">
                        {myDropped.map((entry) => {
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
                                    {contentTypeLabel(entry.type)} · {entry.channel}
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
                                    rewritten
                                  </span>
                                ) : (
                                  !run?.committed_at && (
                                    <button
                                      onClick={() => handleRestore(entry.slotId)}
                                      disabled={busySlot === entry.slotId}
                                      className={`${btn.outlineSm} shrink-0`}
                                    >
                                      {busySlot === entry.slotId ? "…" : "Put back"}
                                    </button>
                                  )
                                )}
                              </div>

                              {!replaced && !run?.committed_at && (
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
                                  placeholder="What was wrong? — e.g. too salesy, we said this in March"
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

                  {run &&
                    (run.committed_at ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-4">
                        <p className="text-sm text-teal-800">
                          Accepted {new Date(run.committed_at).toLocaleString()}.
                          The pieces are waiting for days.
                        </p>
                        <button
                          onClick={() => setStage("schedule")}
                          className={`${btn.primarySm} shrink-0`}
                        >
                          Give them days
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-sm text-slate-500">
                          Nothing is on the calendar yet.
                        </p>
                        <button
                          onClick={handleCommit}
                          disabled={committing || run.proposed_slots.length === 0}
                          className={`${btn.primarySm} shrink-0`}
                        >
                          {committing
                            ? "Accepting…"
                            : `Accept ${run.proposed_slots.length} piece${
                                run.proposed_slots.length === 1 ? "" : "s"
                              }`}
                        </button>
                      </div>
                    ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ============================================================ ③ -- */}
      {stage === "schedule" && (
        <div className="space-y-6">
          {quotaNote && <p className={banner.warn}>{quotaNote}</p>}

          {slots.length === 0 ? (
            <div className={surface.empty}>
              <p className="text-slate-700 text-lg">Nothing accepted yet.</p>
              <p className="text-slate-500 text-sm mt-1">
                Write this campaign&rsquo;s content and accept it, and the pieces
                land here waiting for days.
              </p>
              <button onClick={() => setStage("content")} className={`${btn.primary} mt-6`}>
                Go to content
              </button>
            </div>
          ) : undated.length === 0 ? (
            /* This stage is the dating workbench and nothing else. Once every
               piece has a day there is no work left in it, and the pieces
               themselves live one stage on. */
            <div className={surface.empty}>
              <p className="text-slate-700 text-lg">
                Every piece has a day.
              </p>
              <p className="text-slate-500 text-sm mt-1">
                All {dated.length} of them are dated. Push them to Google from
                the next stage.
              </p>
              <button onClick={() => setStage("calendar")} className={`${btn.primary} mt-6`}>
                On the calendar
              </button>
            </div>
          ) : (
            <section>
              <div className="flex items-center gap-2 mb-1">
                <h2 className={text.cardTitle}>Needs a day</h2>
                <span className={`${PILL} bg-amber-50 text-amber-700`}>
                  {undated.length}
                </span>
              </div>
              <p className="text-sm text-slate-500 mb-3">
                The time comes from the channel&rsquo;s usual posting window.
                Change it afterwards on the piece.
              </p>
              <div className="space-y-3">
                {undated.map((slot) => (
                  <PieceCard
                    key={slot.id}
                    piece={fromSlot(slot)}
                    action={
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={dates[slot.id] ?? ""}
                          onChange={(e) =>
                            setDates((d) => ({ ...d, [slot.id]: e.target.value }))
                          }
                          className={field.select}
                          aria-label={`Date for ${slot.theme || slot.type}`}
                        />
                        <button
                          onClick={() => handleSchedule(slot)}
                          disabled={!dates[slot.id] || datingId === slot.id}
                          className={btn.primarySm}
                        >
                          {datingId === slot.id ? "Setting…" : "Schedule"}
                        </button>
                      </div>
                    }
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ============================================================ ④ -- */}
      {stage === "calendar" && (
        <div className="space-y-6">
          {dated.length === 0 ? (
            <div className={surface.empty}>
              <p className="text-slate-700 text-lg">Nothing has a day yet.</p>
              <p className="text-slate-500 text-sm mt-1">
                A piece reaches Google only once it has a date. Give these pieces
                days and they can be pushed from here.
              </p>
              <button
                onClick={() => setStage("schedule")}
                className={`${btn.primary} mt-6`}
              >
                Give them days
              </button>
            </div>
          ) : (
            <>
              {/* The connection, and the one action it allows. Four states,
                  because "not set up on the server" and "not connected by you"
                  need different fixes. */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                {!google ? (
                  <span className={text.muted}>Checking Google…</span>
                ) : !google.configured ? (
                  <span className="text-sm text-slate-500">
                    Google Calendar is not set up on this server.{" "}
                    <span className="font-mono text-xs">
                      {google.missing.join(", ")}
                    </span>{" "}
                    missing from .env.local.
                  </span>
                ) : !google.connected ? (
                  <>
                    <span className="text-sm text-slate-500">
                      Connect Google and this campaign&rsquo;s days become events
                      — one calendar per client.
                    </span>
                    <button onClick={handleConnect} className={`${btn.outline} shrink-0`}>
                      Connect Google
                    </button>
                  </>
                ) : google.needs_reconnect ? (
                  <>
                    <span className="text-sm text-amber-700">
                      Connected as {google.email}, but without calendar access.
                      Reconnect to grant it.
                    </span>
                    <button onClick={handleConnect} className={`${btn.outline} shrink-0`}>
                      Reconnect
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-slate-500">
                      Google Calendar · {google.email}
                      {syncNote && (
                        <span className="text-teal-700 font-medium"> — {syncNote}</span>
                      )}
                    </span>
                    <span className="flex gap-2 shrink-0">
                      {calendarUrl && (
                        <a
                          href={calendarUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={btn.outline}
                        >
                          Open in Google ↗
                        </a>
                      )}
                      <button
                        onClick={() => span && handleSync(span.start, span.end)}
                        disabled={syncing || !span}
                        className={btn.primarySm}
                      >
                        {syncing ? "Pushing…" : "Push to Google"}
                      </button>
                    </span>
                  </>
                )}
              </div>

              {/* Sync is addressed by date range, not by campaign. Say so. */}
              {span && google?.connected && !google.needs_reconnect && (
                <p className={text.micro}>
                  Pushes everything scheduled between {span.start} and {span.end},
                  including other campaigns&rsquo; pieces in that window.
                </p>
              )}

              {syncWarnings.length > 0 && (
                <div className={banner.warn}>
                  {syncWarnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                  {/* The cure sits with the problem. */}
                  {calendarMissing && (
                    <button
                      onClick={handleResetCalendar}
                      className={`${btn.outline} mt-3`}
                    >
                      Reset calendar
                    </button>
                  )}
                </div>
              )}

              {syncChanges.length > 0 && (
                <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-4 py-3">
                  <p className={`${text.cardTitle} text-teal-800 mb-1.5`}>
                    Changed in Google, adopted here
                  </p>
                  <ul className="space-y-1">
                    {syncChanges.slice(0, 5).map((c) => (
                      <li key={c} className="text-sm text-teal-900">
                        {c}
                      </li>
                    ))}
                  </ul>
                  {syncChanges.length > 5 && (
                    <p className="mt-1.5 text-xs text-teal-700">
                      +{syncChanges.length - 5} more
                    </p>
                  )}
                </div>
              )}

              {/* A checklist, not cards: at this stage the question is "is it
                  there", and eight rows of state answer that faster than eight
                  cards of copy you have already read twice. */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className={text.cardTitle}>This campaign on the calendar</h2>
                  <span className={`${PILL} bg-slate-100 text-slate-500`}>
                    {onGoogle.length} of {dated.length}
                  </span>
                </div>
                <div className={surface.list}>
                  {dated.map((slot) => {
                    const state = syncState(slot);
                    return (
                      <div
                        key={slot.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                      >
                        <span className="text-sm text-slate-700 tabular-nums w-24 shrink-0">
                          {slot.date}
                        </span>
                        <span className="text-sm text-slate-500 w-14 shrink-0 tabular-nums">
                          {slot.time_local ?? "—"}
                        </span>
                        {/* The theme carries the link rather than a separate
                            Open column: this is the only way into a dated
                            piece from inside the campaign now that stage ③ is
                            purely the dating workbench. */}
                        <Link
                          href={`/clients/${clientId}/schedule/${slot.id}?from=${campaignId}&stage=calendar`}
                          className="text-sm text-slate-800 flex-1 min-w-0 truncate hover:text-teal-700 transition-colors"
                        >
                          {slot.theme || contentTypeLabel(slot.type)}
                        </Link>
                        <span className={`${PILL} ${state.pill} shrink-0`}>
                          {state.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Where one piece stands with Google.
 *
 * Deliberately not statusPill: this is a different axis from a slot's own
 * status, and colouring them from the same map would make "planned" and
 * "not pushed" look like the same kind of fact.
 */
function syncState(slot: Slot): { label: string; pill: string } {
  if (slot.google_sync_error) return { label: "failed", pill: "bg-red-100 text-red-600" };
  switch (slot.google_sync_status) {
    case "synced":
      return { label: "on Google", pill: "bg-teal-100 text-teal-700" };
    case "locked":
      return { label: "Google owns the text", pill: "bg-amber-100 text-amber-700" };
    case "stale":
      return { label: "changed since push", pill: "bg-amber-100 text-amber-700" };
    case "removed":
      return { label: "removed in Google", pill: "bg-slate-100 text-slate-500" };
    default:
      return { label: "not pushed yet", pill: "bg-slate-100 text-slate-500" };
  }
}
