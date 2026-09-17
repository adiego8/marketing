"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  listSlots,
  updateSlot,
  getClient,
  getGoogleStatus,
  startGoogleConnect,
  syncCalendar,
  resetClientCalendar,
  downloadPlanPdf,
  writeSlotCopy,
  scheduleSlot,
  getStrategy,
} from "@/lib/api";
import { banner, btn, field, surface, toggle, text } from "@/lib/ui";
import { statusPill, statusLabel, PILL } from "@/lib/ui-status";
import { PieceCard, fromSlot } from "@/components/shared/piece-card";
import { StateLabel } from "@/components/shared/state-label";
import { readCopy, isCopyStale } from "@/lib/marketing/copy";
import { calendarOpenUrl } from "@/lib/marketing/calendar-links";
import { readGoogleResult } from "@/lib/google-result";
import { planMarkdown, planFilename } from "@/lib/marketing/export/plan-markdown";
import { contentTypeLabel } from "@/lib/marketing/content-types";
import { weekLabel } from "@/lib/marketing/planner/weeks";
import { overCap, type WeeklyCaps } from "@/lib/marketing/planner/schedule";
import type { Slot, SlotStatus } from "@/lib/types";

// Committed slots. The plan page shows a proposal; this shows what was accepted
// and is actually scheduled.

const HORIZONS = [2, 4, 12];

// The statuses a human sets from here. Quota-freeing ones last, so the
// destructive choice is never the one next to the cursor by default.
const STATUS_CHOICES: SlotStatus[] = [
  "planned",
  "confirmed",
  "drafted",
  "posted",
  "skipped",
  "cancelled",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parsed as UTC so the browser's own zone cannot shift the client's date. */
function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function SchedulePage() {
  const { clientId } = useParams() as { clientId: string };
  const [slots, setSlots] = useState<Slot[]>([]);
  const [clientName, setClientName] = useState("Client");
  const [timezone, setTimezone] = useState("UTC");
  const [weeks, setWeeks] = useState(4);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  // Separate from savingId: a copy write can take minutes (maxDuration 300),
  // and locking the status dropdown that long is worse than the race it would
  // prevent — the two writes touch disjoint fields.
  const [writingId, setWritingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [google, setGoogle] = useState<{
    configured: boolean;
    missing: string[];
    connected: boolean;
    email: string | null;
    needs_reconnect: boolean;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  // What the last sync adopted FROM Google, as opposed to pushed to it. Kept
  // separate from syncNote because these are changes the person made, and they
  // deserve to be read rather than counted.
  const [syncChanges, setSyncChanges] = useState<string[]>([]);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);
  // Set by a sync that 404'd on the calendar itself. The one failure with a
  // specific cure, so it gets a button rather than another line of prose.
  const [calendarMissing, setCalendarMissing] = useState(false);
  const [calendarUrl, setCalendarUrl] = useState<string | null>(null);
  // The weekly pace, so a week can say when it is over it. Absent is workable:
  // no quota means the operator chose not to pace this client.
  const [quota, setQuota] = useState<WeeklyCaps>({});

  // Accepted pieces with no day yet. Loaded separately because they match no
  // date range — the ranged call below cannot see them by construction.
  const [unscheduled, setUnscheduled] = useState<Slot[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [datingId, setDatingId] = useState<string | null>(null);
  const [quotaNote, setQuotaNote] = useState<string | null>(null);

  const start = isoDate(new Date());
  const end = isoDate(new Date(Date.now() + weeks * 7 * 86400_000));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, waiting] = await Promise.all([
        listSlots(clientId, { start, end }),
        listSlots(clientId, { dated: "unscheduled" }),
      ]);
      setSlots(data);
      setUnscheduled(waiting);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the schedule");
    } finally {
      setLoading(false);
    }
  }, [clientId, start, end]);

  /**
   * Give a piece a day.
   *
   * The quota warning rides back on the response and is shown, not enforced —
   * going over a weekly cap is the operator's call, and refusing it would only
   * strand the piece.
   */
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
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set that day");
    } finally {
      setDatingId(null);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getStrategy(clientId)
      .then((st) => setQuota(st?.content_quota?.weekly ?? {}))
      .catch(() => {});
  }, [clientId]);

  useEffect(() => {
    getClient(clientId)
      .then((c) => {
        setClientName(c.name);
        setTimezone(c.timezone || "UTC");
        // The link used to arrive only in the sync response, so the client's
        // own calendar was unreachable until you pushed to it. The id is on
        // the client the moment the calendar exists.
        if (c.google_calendar_id) setCalendarUrl(calendarOpenUrl(c.google_calendar_id));
      })
      .catch(() => {});
  }, [clientId]);

  useEffect(() => {
    getGoogleStatus().then(setGoogle).catch(() => setGoogle(null));

    // The OAuth callback redirects back here with its result. Read from
    // location rather than useSearchParams, which would need a Suspense
    // boundary to prerender.
    const search = new URLSearchParams(window.location.search);

    // Coming back from a piece's page. Without this a 12-week view silently
    // resets to 4, because `weeks` lives only in state and Next unmounts this
    // page on navigation.
    const w = Number(search.get("weeks"));
    if (HORIZONS.includes(w)) setWeeks(w);

    // readGoogleResult strips the code itself, so a refresh does not replay a
    // stale error. It returns null when there is nothing to report, and only
    // then does `weeks` need cleaning out of the URL on its own.
    const result = readGoogleResult();
    if (!result) {
      if (w) window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (result.connected) setSyncNote("Google connected");
    else setError(result.message);
  }, []);

  const handleConnect = async () => {
    try {
      const { url } = await startGoogleConnect(window.location.pathname);
      // A full navigation, not a fetch: this is Google's consent screen.
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the Google connection");
    }
  };

  const handleSync = async () => {
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
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Forget a calendar that is no longer there, so the next sync builds a new
   * one. Confirmed because it is not reversible from here: the old calendar
   * stays in Google, but this app will not find its way back to it.
   */
  const handleResetCalendar = async () => {
    if (
      !confirm(
        "Build a new calendar for this client?\n\n" +
          "The pieces here stop pointing at the old calendar's events, and the " +
          "next sync creates a fresh calendar and writes them again. Nothing is " +
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
      setSyncNote("Calendar reset — press Sync to Google to build a new one");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the calendar");
    }
  };

  /**
   * Write the copy for one row, without opening it.
   *
   * The one action worth keeping in the table: filling a week's copy otherwise
   * means opening seven pages. Everything else about a piece lives on its own
   * page now. No steer here — that belongs where you can see what you are
   * steering.
   *
   * Has its own busy id rather than sharing savingId: a copy write can take
   * minutes, and a row frozen that long by the status select's flag would read
   * as broken.
   */
  const handleWriteCopy = async (slot: Slot) => {
    setWritingId(slot.id);
    setError(null);
    try {
      const updated = await writeSlotCopy(clientId, slot.id);
      setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      if (updated.warnings?.length) {
        setSyncNote(updated.warnings.join(" · "));
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : "Could not write the copy";
      setError(
        `${slot.date ? dayLabel(slot.date) : "Unscheduled"} · ${contentTypeLabel(slot.type)}: ${why}`
      );
    } finally {
      // writingId, not savingId. Clearing the wrong one left the button stuck
      // on "Writing…" for the rest of the session after a single use.
      setWritingId(null);
    }
  };


  const handleStatus = async (slot: Slot, status: SlotStatus) => {
    if (status === slot.status) return;
    setSavingId(slot.id);
    setError(null);
    try {
      const updated = await updateSlot(clientId, slot.id, { status });
      setSlots((prev) => prev.map((s) => (s.id === slot.id ? updated : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the slot");
    } finally {
      setSavingId(null);
    }
  };

  const doc = () =>
    planMarkdown(slots, { clientName, timezone, start, end });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(doc());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  };

  const [pdfBusy, setPdfBusy] = useState(false);

  const handlePdf = async () => {
    setPdfBusy(true);
    setError(null);
    try {
      const { blob, filename } = await downloadPlanPdf(clientId, { start, end });
      save(blob, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the PDF");
    } finally {
      setPdfBusy(false);
    }
  };

  const save = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownload = () => {
    // Built in the browser from slots already fetched: a plain download link
    // cannot carry the Authorization header every endpoint requires.
    save(
      new Blob([doc()], { type: "text/markdown;charset=utf-8" }),
      planFilename(clientName, start, end)
    );
  };

  const live = slots.filter(
    (s) => s.status !== "cancelled" && s.status !== "skipped"
  );
  // Edited or regenerated after their event was written. syncSlots patches by
  // googleEventId, so re-syncing rewrites the event in place.
  const stale = slots.filter((s) => s.google_sync_status === "stale");

  const byWeek = slots.reduce<Record<string, Slot[]>>((acc, slot) => {
    (acc[slot.week_key || "Unscheduled"] ||= []).push(slot);
    return acc;
  }, {});

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className={text.h1}>Calendar</h1>
          <p className="text-sm text-slate-500 mt-1">
            {live.length} piece{live.length === 1 ? "" : "s"} scheduled ·{" "}
            {start} to {end} · times in {timezone}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1" role="group" aria-label="Horizon">
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
            onClick={handleCopy}
            disabled={slots.length === 0}
            className={btn.outline}
          >
            {copied ? "Copied!" : "Copy plan"}
          </button>
          <button
            onClick={handleDownload}
            disabled={slots.length === 0}
            className={btn.outline}
          >
            .md
          </button>
          <button
            onClick={handlePdf}
            disabled={slots.length === 0 || pdfBusy}
            className={btn.primarySm}
          >
            {pdfBusy ? "Building…" : "Download PDF"}
          </button>
        </div>
      </div>

      {google && slots.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          {!google.configured ? (
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
                Push this schedule to Google Calendar — one calendar per client.
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
                {stale.length > 0 && (
                  <span className="text-amber-700 font-medium">
                    {" "}
                    — {stale.length} changed since the last sync
                  </span>
                )}
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
                  onClick={handleSync}
                  disabled={syncing}
                  className={btn.primarySm}
                >
                  {syncing ? "Syncing…" : "Sync to Google"}
                </button>
              </span>
            </>
          )}
        </div>
      )}

      {syncWarnings.length > 0 && (
        <div className={`${banner.warn} mb-4`}>
          {syncWarnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          {/* The cure sits with the problem: a warning that names a fix the
              user then has to go and find is half a warning. */}
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
        <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50/60 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
            Adopted from Google
          </p>
          <ul className="mt-1.5 space-y-1">
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

      {error && <p className={`${banner.error} mb-4`}>{error}</p>}
      {quotaNote && <p className={`${banner.warn} mb-4`}>{quotaNote}</p>}

      {/* Accepted, waiting for a day. Above the calendar because it is the work
          in front of you — a piece with no date reaches nobody, and it is
          invisible to Google until it has one. */}
      {!loading && unscheduled.length > 0 && (
        <section className={`${surface.card} ${surface.pad} mb-8`}>
          <div className="flex items-center gap-2 mb-1">
            <h2 className={text.cardTitle}>Not scheduled yet</h2>
            <span className={`${PILL} bg-amber-50 text-amber-700`}>
              {unscheduled.length}
            </span>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Accepted content with no day. Pick one and it moves onto the
            calendar below; the time comes from the channel&rsquo;s usual
            posting window unless you change it afterwards.
          </p>

          <div className="space-y-2">
            {unscheduled.map((slot) => (
              <div
                key={slot.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">
                    {slot.campaign_title ?? "No campaign"} ·{" "}
                    {contentTypeLabel(slot.type)} · {slot.channel}
                  </p>
                  <Link
                    href={`/clients/${clientId}/schedule/${slot.id}`}
                    className="font-medium text-slate-800 hover:text-teal-700 transition-colors"
                  >
                    {slot.needs_theme || !slot.theme ? "Theme not set" : slot.theme}
                  </Link>
                </div>
                <div className="flex items-center gap-2 shrink-0">
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
              </div>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <p className={text.muted}>Loading…</p>
      ) : slots.length === 0 ? (
        <div className={surface.empty}>
          <p className="text-slate-700 text-lg">Nothing on the calendar yet.</p>
          <p className="text-slate-500 text-sm mt-1">
            {unscheduled.length > 0
              ? "Give the pieces above a day and they land here."
              : "Write a campaign's content and accept it, and the pieces land here waiting for a day."}
          </p>
          <Link
            href={`/clients/${clientId}/campaigns`}
            className={`${btn.primary} mt-6`}
          >
            Open campaigns
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(byWeek).map(([weekKey, weekSlots]) => (
            <section key={weekKey}>
              <div className="mb-3">
                <div className="flex items-baseline gap-2">
                  {/* The dates, not "2026-W39". The key is how a slot is
                      filed; it was never how a week is read. */}
                  <h2 className={text.cardTitle}>
                    {weekLabel(weekKey, timezone)}
                  </h2>
                  <span className={`${PILL} bg-slate-100 text-slate-500`}>
                    {weekSlots.length}
                  </span>
                </div>
                {/* A week is a unit here only because the quota is weekly, so
                    the heading says the one thing that makes it one — and only
                    when there is something to say. */}
                {overCap(
                  slots.map((s) => ({
                    id: s.id,
                    date: s.date,
                    weekKey: s.week_key,
                    type: s.type,
                    status: s.status,
                  })),
                  weekKey,
                  quota
                ).map((row) => (
                  <p key={row.type} className="text-xs text-amber-700 mt-1">
                    {row.text}
                  </p>
                ))}
              </div>

              <div className="space-y-3">
                {weekSlots.map((slot) => {
                  const dropped =
                    slot.status === "cancelled" || slot.status === "skipped";
                  const copy = readCopy(slot);
                  return (
                    <PieceCard
                      key={slot.id}
                      piece={fromSlot(slot)}
                      muted={dropped}
                      showCampaign
                      lead={
                        <>
                          {slot.date ? dayLabel(slot.date) : "—"}
                          {slot.time_local && (
                            <span className="text-slate-400 font-normal">
                              {" "}
                              {slot.time_local}
                            </span>
                          )}
                        </>
                      }
                      action={
                        <Link
                          href={`/clients/${clientId}/schedule/${slot.id}?weeks=${weeks}`}
                          className={btn.ghost}
                        >
                          Open
                        </Link>
                      }
                      footer={
                        <>
                          {/* The pill scans, the select changes. Both were
                              here before, crushed against seven other controls
                              in one table cell; on their own line they read as
                              the pair they are. */}
                          <span className={statusPill(slot.status)}>
                            {statusLabel(slot.status)}
                          </span>
                          <select
                            value={slot.status}
                            disabled={savingId === slot.id}
                            onChange={(e) =>
                              handleStatus(slot, e.target.value as SlotStatus)
                            }
                            aria-label={`Status for ${contentTypeLabel(slot.type)}${
                              slot.date ? ` on ${slot.date}` : ""
                            }`}
                            className={`${field.select} py-1 text-xs`}
                          >
                            {STATUS_CHOICES.map((s) => (
                              <option key={s} value={s}>
                                {statusLabel(s)}
                              </option>
                            ))}
                          </select>

                          {/* Released and ready is the state a publisher acts
                              on, so it is the one worth naming outright —
                              "copy ready" alone does not say it can leave. */}
                          {slot.status === "confirmed" &&
                            copy &&
                            !isCopyStale(slot) && (
                              <StateLabel tone="good">
                                released to publisher
                              </StateLabel>
                            )}
                          {slot.status === "confirmed" &&
                            (!copy || isCopyStale(slot)) && (
                              <StateLabel tone="warn">
                                released but not publishable
                              </StateLabel>
                            )}

                          {copy ? (
                            <StateLabel
                              tone={isCopyStale(slot) ? "warn" : "good"}
                            >
                              {isCopyStale(slot)
                                ? "copy is older than the brief"
                                : "copy ready"}
                            </StateLabel>
                          ) : (
                            !dropped &&
                            !slot.needs_theme &&
                            slot.theme && (
                              <button
                                onClick={() => handleWriteCopy(slot)}
                                disabled={writingId === slot.id}
                                className={btn.outlineSm}
                              >
                                {writingId === slot.id
                                  ? "Writing…"
                                  : "Write copy"}
                              </button>
                            )
                          )}

                          {slot.google_sync_status === "stale" && (
                            <StateLabel tone="warn">
                              changed since sync
                            </StateLabel>
                          )}
                          {slot.google_event_locked && (
                            <StateLabel tone="warn">google owns text</StateLabel>
                          )}
                          {slot.google_sync_status === "removed" &&
                            slot.status === "cancelled" && (
                              <StateLabel tone="muted">
                                removed in google
                              </StateLabel>
                            )}
                          {slot.google_sync_error && (
                            <StateLabel tone="bad" title={slot.google_sync_error}>
                              sync failed
                            </StateLabel>
                          )}
                        </>
                      }
                    />
                  );
                })}
              </div>
            </section>
          ))}

          <p className={`${banner.info}`}>
            Cancelling or skipping a slot gives its quota back, so the next plan
            you generate will propose something to replace it.
          </p>
        </div>
      )}
    </div>
  );
}
