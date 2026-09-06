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
} from "@/lib/api";
import { banner, btn, field, surface, table, toggle, text } from "@/lib/ui";
import { channelPill, statusPill, statusLabel, PILL } from "@/lib/ui-status";
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
      })
      .catch(() => {});
  }, [clientId]);

  useEffect(() => {
    getGoogleStatus().then(setGoogle).catch(() => setGoogle(null));

    // The OAuth callback redirects back here with its result. Read from
    // location rather than useSearchParams, which would need a Suspense
    // boundary to prerender.
    const result = new URLSearchParams(window.location.search).get("google");
    if (!result) return;
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
    try {
      const r = await syncCalendar(clientId, { start, end });
      setCalendarUrl(r.open_url);
      setSyncNote(
        [
          `${r.synced} event${r.synced === 1 ? "" : "s"} written`,
          r.removed > 0 ? `${r.removed} removed` : null,
          r.failed > 0 ? `${r.failed} failed` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      );
      if (r.errors.length > 0) setError(r.errors.slice(0, 3).join(" · "));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
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
                            {dayLabel(slot.date)}
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
                            </div>
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
