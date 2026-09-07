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
  downloadPlanPdf,
  writeSlotCopy,
} from "@/lib/api";
import { banner, btn, field, surface, table, toggle, text } from "@/lib/ui";
import { channelPill, statusPill, statusLabel, PILL } from "@/lib/ui-status";
import { readCopy, isCopyStale } from "@/lib/marketing/copy";
import { calendarOpenUrl } from "@/lib/marketing/calendar-links";
import { planMarkdown, planFilename } from "@/lib/marketing/export/plan-markdown";
import { contentTypeLabel } from "@/lib/marketing/content-types";
import type { Slot, SlotStatus } from "@/lib/types";

// Committed slots. The plan page shows a proposal; this shows what was accepted
// and is actually scheduled.

const HORIZONS = [2, 4, 12];

// The callback can only pass a code in the URL, so the copy lives here.
const GOOGLE_ERRORS: Record<string, string> = {
  access_denied: "You declined the Google permissions, so nothing was connected.",
  "invalid-state": "That sign-in link expired. Press Connect Google again.",
  "no-code": "Google did not return an authorisation code. Try again.",
  "no-refresh-token":
    "Google withheld a refresh token. Remove this app under your Google account permissions, then connect again.",
  "exchange-failed": "Google rejected the authorisation. Check the OAuth client's redirect URI.",
  "not-configured": "Google OAuth is not configured on this server.",
};

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
  const [calendarUrl, setCalendarUrl] = useState<string | null>(null);

  const start = isoDate(new Date());
  const end = isoDate(new Date(Date.now() + weeks * 7 * 86400_000));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listSlots(clientId, { start, end });
      setSlots(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the schedule");
    } finally {
      setLoading(false);
    }
  }, [clientId, start, end]);

  useEffect(() => {
    load();
  }, [load]);

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

    const result = search.get("google");
    if (!result) {
      if (w) window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (result === "connected") setSyncNote("Google connected");
    else setError(GOOGLE_ERRORS[result] ?? `Google returned "${result}".`);
    window.history.replaceState({}, "", window.location.pathname);
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
    try {
      const r = await syncCalendar(clientId, { start, end });
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
   * Write the copy for one row, without opening it.
   *
   * The one action worth keeping in the table: filling a week's copy otherwise
   * means opening seven pages. Everything else about a piece lives on its own
   * page now. No steer here — that belongs where you can see what you are
   * steering.
   *
   * Shares savingId with the status select, because a row should be busy as a
   * whole rather than per control.
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
      setError(`${dayLabel(slot.date)} · ${contentTypeLabel(slot.type)}: ${why}`);
    } finally {
      setSavingId(null);
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
          <p className={text.eyebrow}>Committed</p>
          <h1 className={`${text.h1} mt-1`}>Schedule</h1>
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

      {loading ? (
        <p className={text.muted}>Loading…</p>
      ) : slots.length === 0 ? (
        <div className={surface.empty}>
          <p className="text-slate-700 text-lg">Nothing scheduled yet.</p>
          <p className="text-slate-500 text-sm mt-1">
            Generate a plan and accept it, and the slots land here.
          </p>
          <Link href={`/clients/${clientId}/plan`} className={`${btn.primary} mt-6`}>
            Open the planner
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(byWeek).map(([weekKey, weekSlots]) => (
            <section key={weekKey}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className={text.cardTitle}>{weekKey}</h2>
                <span className={`${PILL} bg-slate-100 text-slate-500`}>
                  {weekSlots.length}
                </span>
              </div>
              <div className={`${surface.table} overflow-x-auto`}>
                <table className="w-full">
                  <thead>
                    <tr className="bg-stone-50">
                      <th className={`${table.head} w-32`}>Date</th>
                      <th className={`${table.head} w-20`}>Time</th>
                      <th className={`${table.head} w-28`}>Channel</th>
                      <th className={`${table.head} w-24`}>Format</th>
                      <th className={table.head}>Theme</th>
                      <th className={`${table.head} w-36`}>Campaign</th>
                      <th className={`${table.head} w-40`}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekSlots.map((slot) => {
                      const dropped =
                        slot.status === "cancelled" || slot.status === "skipped";
                      return (
                        <tr
                          key={slot.id}
                          className={`${table.row} ${dropped ? "opacity-50" : ""}`}
                        >
                          <td className={`${table.cell} font-medium whitespace-nowrap`}>
                            <Link
                              href={`/clients/${clientId}/schedule/${slot.id}?weeks=${weeks}`}
                              className="hover:text-teal-700 transition-colors"
                            >
                              {dayLabel(slot.date)}
                            </Link>
                          </td>
                          <td className={table.cell}>{slot.time_local}</td>
                          <td className={table.cell}>
                            <span className={channelPill(slot.channel)}>
                              {slot.channel}
                            </span>
                          </td>
                          <td className={table.cell}>
                            {contentTypeLabel(slot.type)}
                          </td>
                          <td className={table.cell}>
                            {slot.needs_theme || !slot.theme ? (
                              <span className={`${PILL} bg-red-100 text-red-600`}>
                                needs theme
                              </span>
                            ) : (
                              <>
                                <p className="font-medium text-slate-800">
                                  {slot.theme}
                                </p>
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
                                {!slot.hook && slot.brief && (
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    {slot.brief}
                                  </p>
                                )}
                              </>
                            )}
                          </td>
                          <td className={table.cellMuted}>
                            {slot.campaign_title ?? "—"}
                          </td>
                          <td className={table.cell}>
                            <div className="flex items-center gap-2">
                              <span className={statusPill(slot.status)}>
                                {statusLabel(slot.status)}
                              </span>
                              <select
                                value={slot.status}
                                disabled={savingId === slot.id}
                                onChange={(e) =>
                                  handleStatus(slot, e.target.value as SlotStatus)
                                }
                                aria-label={`Status for ${slot.type} on ${slot.date}`}
                                className={`${field.select} py-1 text-xs`}
                              >
                                {STATUS_CHOICES.map((s) => (
                                  <option key={s} value={s}>
                                    {statusLabel(s)}
                                  </option>
                                ))}
                              </select>
                              <Link
                                href={`/clients/${clientId}/schedule/${slot.id}?weeks=${weeks}`}
                                className="text-xs font-semibold text-slate-400 hover:text-teal-700 transition-colors"
                              >
                                Open
                              </Link>
                            </div>
                            {/* Only where there is work to do, so the button
                                disappears as a week fills in. */}
                            {!dropped &&
                              !readCopy(slot) &&
                              !slot.needs_theme &&
                              slot.theme && (
                                <button
                                  onClick={() => handleWriteCopy(slot)}
                                  disabled={writingId === slot.id}
                                  className={`${btn.outlineSm} mt-1`}
                                >
                                  {writingId === slot.id ? "Writing…" : "Write copy"}
                                </button>
                              )}
                            {slot.google_sync_status === "stale" && (
                              <span className="text-[10px] uppercase tracking-wide text-amber-700">
                                changed since sync
                              </span>
                            )}
                            {slot.google_event_locked && (
                              <span className="text-[10px] uppercase tracking-wide text-amber-700">
                                google owns text
                              </span>
                            )}
                            {slot.google_sync_status === "removed" &&
                              slot.status === "cancelled" && (
                                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                  removed in google
                                </span>
                              )}
                            {slot.google_sync_error && (
                              <span
                                className="text-[10px] uppercase tracking-wide text-red-700"
                                title={slot.google_sync_error}
                              >
                                sync failed
                              </span>
                            )}
                            {readCopy(slot) && (
                              <span
                                className={`text-[10px] uppercase tracking-wide ${
                                  isCopyStale(slot) ? "text-amber-700" : "text-teal-700"
                                }`}
                              >
                                {isCopyStale(slot) ? "copy is older than the brief" : "copy ready"}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
