"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { listSlots, updateSlot, getClient } from "@/lib/api";
import { banner, btn, field, surface, table, toggle, text } from "@/lib/ui";
import { channelPill, statusPill, statusLabel, PILL } from "@/lib/ui-status";
import { planMarkdown, planFilename } from "@/lib/marketing/export/plan-markdown";
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
  const [copied, setCopied] = useState(false);

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

  const handleDownload = () => {
    // Built in the browser from slots already fetched: a plain download link
    // cannot carry the Authorization header every endpoint requires.
    const blob = new Blob([doc()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = planFilename(clientName, start, end);
    a.click();
    URL.revokeObjectURL(url);
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
            className={btn.primarySm}
          >
            Download .md
          </button>
        </div>
      </div>

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
                            {slot.needs_theme || !slot.theme ? (
                              <span className={`${PILL} bg-red-100 text-red-600`}>
                                needs theme
                              </span>
                            ) : (
                              <>
                                <p>{slot.theme}</p>
                                {slot.brief && (
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
