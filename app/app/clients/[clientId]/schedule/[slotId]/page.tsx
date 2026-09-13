"use client";

// One scheduled piece, on its own page.
//
// This used to be an expanded <td colSpan={7}> inside the schedule table: the
// brief editor, the regenerate controls, the Google lock and the whole copy
// section, all inside a table row. The table answers "what is going out and
// when"; this answers "what is this piece, and is it any good". They had grown
// into two different jobs sharing one surface.
//
// Nested under /schedule on purpose — the sidebar's active check is
// pathname.startsWith(item.href), so Schedule stays highlighted with no change
// to the nav.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  listSlots,
  updateSlot,
  regenerateSlot,
  writeSlotCopy,
  getClient,
  scheduleSlot,
} from "@/lib/api";
import { windowFor } from "@/lib/marketing/posting-windows";
import { contentTypeLabel } from "@/lib/marketing/content-types";
import { readCopy, isCopyStale, copyWarnings } from "@/lib/marketing/copy";
import { backLink, btn, field, pager, surface, text, banner } from "@/lib/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { channelPill, statusPill, statusLabel, PILL } from "@/lib/ui-status";
import type { Slot, SlotStatus } from "@/lib/types";

const STATUS_CHOICES: SlotStatus[] = [
  "planned",
  "confirmed",
  "drafted",
  "posted",
  "skipped",
  "cancelled",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Fixed tables rather than toLocaleDateString: en-GB renders "Sept". */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const MAX_BEATS = 8;

export default function SlotDetailPage() {
  const params = useParams() as { clientId: string; slotId: string };
  const { clientId, slotId } = params;
  const router = useRouter();

  // The whole ordered list, not just this slot. The arrows need the neighbours
  // anyway, and listSlots reads every slot for the client server-side
  // regardless — so one call is cheaper than a fetch-one plus a fetch-list.
  const [all, setAll] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [draft, setDraft] = useState<Slot | null>(null);
  const [timezone, setTimezone] = useState("UTC");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [steer, setSteer] = useState("");
  const [copySteer, setCopySteer] = useState("");

  const load = useCallback(async () => {
    // Next re-renders the SAME component instance when moving between
    // siblings, so useParams changes and state does not. Everything per-slot
    // is cleared here rather than left to carry over into the next piece.
    setSteer("");
    setCopySteer("");
    setError(null);
    setNote(null);
    setSaved(false);
    try {
      const slots = await listSlots(clientId);
      setAll(slots);
      const found = slots.find((s) => s.id === slotId) ?? null;
      setSlot(found);
      setDraft(found ? { ...found, body: [...found.body] } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this piece");
    } finally {
      setLoading(false);
    }
  }, [clientId, slotId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getClient(clientId)
      .then((c) => setTimezone(c.timezone || "UTC"))
      .catch(() => {});
  }, [clientId]);

  /**
   * The saved slot replaced, and the draft re-seeded from it.
   *
   * `warnings` is stripped because writeSlotCopy returns `Slot & {warnings}`
   * and storing that would leave a phantom key on the slot for the rest of the
   * session.
   */
  const replaceSlot = (updated: Slot & { warnings?: string[] }) => {
    const next = { ...updated } as Slot & { warnings?: string[] };
    delete next.warnings;
    setSlot(next);
    setDraft({ ...next, body: [...next.body] });
    setAll((prev) => prev.map((s) => (s.id === next.id ? next : s)));
  };

  /**
   * The day and time, edited separately from the brief.
   *
   * Not part of `draft`: updateSlot deliberately refuses date, time_local and
   * week_key (slots.ts), because changing when a piece goes out has to
   * recompute its week key and its UTC instant and mark the Google event
   * stale. PATCH .../schedule is the one path that does all three, and it
   * moves an already-dated piece as readily as it dates a new one.
   */
  const [when, setWhen] = useState<{ date: string; time: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const [quotaNote, setQuotaNote] = useState<string | null>(null);

  const patchDraft = (patch: Partial<Slot>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setSaved(false);
  };

  // Only the brief fields count: the copy and the Google flags are changed by
  // their own buttons, which save as they go.
  //
  // The body is compared trimmed and filtered, exactly as handleSave sends it —
  // otherwise pressing "+ Beat" and leaving it blank would read as an unsaved
  // change forever, even though saving would discard it.
  const cleanBody = (body: string[]) =>
    body.map((b) => b.trim()).filter(Boolean).join(" | ");
  const dirty =
    !!slot &&
    !!draft &&
    (draft.theme !== slot.theme ||
      draft.hook !== slot.hook ||
      draft.cta !== slot.cta ||
      draft.brief !== slot.brief ||
      cleanBody(draft.body) !== cleanBody(slot.body));

  /**
   * Leaving with unsaved brief edits.
   *
   * confirm() rather than a route guard or an autosave — it is what this
   * codebase already uses for "are you sure" (app/page.tsx, the client page,
   * the plan page), and inventing a new pattern for one screen is worse than
   * a plain browser prompt.
   */
  const leave = (href: string) => {
    if (dirty && !confirm("You have unsaved changes to the brief. Leave anyway?")) {
      return;
    }
    router.push(href);
  };

  // The arrows walk the same window the schedule was showing, not the client's
  // whole history. Without this, "previous" from the first visible row lands in
  // last quarter, and the counter reads "3 of 47" for a table showing 10.
  //
  // window.location.search rather than useSearchParams: that is the house idiom
  // here, and the schedule page's OAuth-callback effect explains why —
  // useSearchParams needs a Suspense boundary to prerender.
  const [weeks, setWeeks] = useState<number | null>(null);
  // Which campaign sent us here, if any. A piece is reachable from the Calendar
  // and from its own campaign's Schedule stage; "back" has to mean the one you
  // actually came from, or the trail dumps you somewhere you have never been.
  const [from, setFrom] = useState<string | null>(null);
  // Which stage of that campaign sent us, so "back" lands where you left rather
  // than on whichever stage happens to be the default.
  const [backStage, setBackStage] = useState("schedule");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const w = Number(params.get("weeks"));
    setWeeks(Number.isFinite(w) && w > 0 ? w : null);
    setFrom(params.get("from"));
    const stage = params.get("stage");
    if (stage) setBackStage(stage);
  }, []);

  const scope = (() => {
    if (weeks === null) return all; // a deep link has no window to honour
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const lo = iso(new Date());
    const hi = iso(new Date(Date.now() + weeks * 7 * 86400_000));
    // An unscheduled piece is in no window; it is reachable by deep link and
    // from the Schedule page's own unscheduled list, not by these arrows.
    const within = all.filter((s) => s.date !== null && s.date >= lo && s.date <= hi);
    // Never strand the piece being viewed: an older slot reached by a direct
    // link falls outside the window, and the arrows should still work.
    return within.some((s) => s.id === slotId) ? within : all;
  })();

  const index = scope.findIndex((s) => s.id === slotId);
  const prev = index > 0 ? scope[index - 1] : null;
  const next = index >= 0 && index < scope.length - 1 ? scope[index + 1] : null;
  // Carried on every link out of this page, so walking prev/next never loses
  // the window you were looking at or the campaign you came from.
  const suffix = (() => {
    const p = new URLSearchParams();
    if (weeks) p.set("weeks", String(weeks));
    if (from) p.set("from", from);
    if (from && backStage !== "schedule") p.set("stage", backStage);
    const q = p.toString();
    return q ? `?${q}` : "";
  })();
  const backHref = from
    ? `/clients/${clientId}/campaigns/${from}?stage=${backStage}`
    : `/clients/${clientId}/schedule${suffix}`;
  const backLabel = from
    ? slot?.campaign_title || "Back to the campaign"
    : "Back to the calendar";
  const siblingHref = (id: string) =>
    `/clients/${clientId}/schedule/${id}${suffix}`;

  const handleSave = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      replaceSlot(
        await updateSlot(clientId, draft.id, {
          theme: draft.theme,
          brief: draft.brief,
          rationale: draft.rationale,
          hook: draft.hook,
          body: draft.body.map((b) => b.trim()).filter(Boolean),
          cta: draft.cta,
        })
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this piece");
    } finally {
      setBusy(false);
    }
  };

  // Re-seeded from the slot rather than held independently, so a move made
  // elsewhere (a Google sync adopting a drag, say) shows up here.
  useEffect(() => {
    if (!slot) return;
    setWhen({
      date: slot.date ?? "",
      time: slot.time_local ?? windowFor(slot.channel).times[0] ?? "09:00",
    });
  }, [slot]);

  const handleMove = async () => {
    if (!slot || !when?.date) return;
    setMoving(true);
    setError(null);
    setQuotaNote(null);
    try {
      const updated = await scheduleSlot(clientId, slot.id, {
        date: when.date,
        timeLocal: when.time || undefined,
      });
      setQuotaNote(updated.quota_warning ?? null);
      replaceSlot(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move this piece");
    } finally {
      setMoving(false);
    }
  };

  const handleStatus = async (status: SlotStatus) => {
    if (!slot || status === slot.status) return;
    setBusy(true);
    setError(null);
    try {
      replaceSlot(await updateSlot(clientId, slot.id, { status }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the status");
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async (mode: "angle" | "rewrite") => {
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      replaceSlot(
        await regenerateSlot(clientId, slot.id, { mode, steer: steer || undefined })
      );
      setSteer("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not regenerate this piece");
    } finally {
      setBusy(false);
    }
  };

  const handleWriteCopy = async () => {
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await writeSlotCopy(clientId, slot.id, {
        steer: copySteer || undefined,
      });
      replaceSlot(updated);
      setCopySteer("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not write the copy");
    } finally {
      setBusy(false);
    }
  };

  /** Take the event's text back after a hand edit in Google locked it. */
  const handleUnlock = async () => {
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      replaceSlot(await updateSlot(clientId, slot.id, { google_event_locked: false }));
      setNote("Taken back — sync from the schedule to push the app's text over it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not take the event back");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className={text.muted}>Loading…</p>;
  if (!slot || !draft) {
    return (
      <div className="max-w-4xl">
        <Link href={backHref} className={`${backLink} mb-3`}>
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          {backLabel}
        </Link>
        <p className={banner.error}>This piece is no longer on the calendar.</p>
      </div>
    );
  }

  const copy = readCopy(slot);
  const stale = isCopyStale(slot);
  const warnings = copy ? copyWarnings(copy, slot) : [];
  const dropped = slot.status === "cancelled" || slot.status === "skipped";

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between gap-4 mb-3">
        <button onClick={() => leave(backHref)} className={backLink}>
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          {backLabel}
        </button>
        {/* The theme of the piece you are moving to rides on the tooltip, so
            stepping through is aimed rather than blind. */}
        <nav aria-label="Pieces in this view" className={pager.frame}>
          <button
            onClick={() => prev && leave(siblingHref(prev.id))}
            disabled={!prev}
            className={pager.step}
            aria-label={prev ? `Previous piece: ${prev.theme || prev.type}` : "Previous piece"}
            title={prev?.theme || undefined}
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <span className={pager.count}>
            {index + 1} / {scope.length}
          </span>
          <button
            onClick={() => next && leave(siblingHref(next.id))}
            disabled={!next}
            className={pager.step}
            aria-label={next ? `Next piece: ${next.theme || next.type}` : "Next piece"}
            title={next?.theme || undefined}
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </nav>
      </div>

      <div className="mb-8">
        <p className={text.eyebrow}>
          {slot.date
            ? `${dayLabel(slot.date)} · ${slot.time_local} · times in ${timezone}`
            : "No day yet"}
        </p>
        <h1 className={`${text.h1} mt-1`}>
          {slot.needs_theme || !slot.theme ? "Theme not set" : slot.theme}
        </h1>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className={channelPill(slot.channel)}>{slot.channel}</span>
          <span className={`${PILL} bg-stone-100 text-slate-600`}>
            {contentTypeLabel(slot.type)}
          </span>
          <span className={statusPill(slot.status)}>{statusLabel(slot.status)}</span>
          {slot.campaign_title && (
            <span className="text-sm text-slate-500">{slot.campaign_title}</span>
          )}
          <select
            value={slot.status}
            disabled={busy}
            onChange={(e) => handleStatus(e.target.value as SlotStatus)}
            aria-label="Status"
            className={`${field.select} py-1 text-xs ml-auto`}
          >
            {STATUS_CHOICES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        {dropped && (
          <p className={`${banner.info} mt-3`}>
            This piece is {slot.status}, so its quota is free again and the next
            plan you generate may propose something to replace it.
          </p>
        )}
      </div>

      {error && <p className={`${banner.error} mb-4`}>{error}</p>}
      {note && <p className={`${banner.info} mb-4`}>{note}</p>}

      <div className="grid gap-4">
        {/* ------------------------------------------------------- when -- */}
        <section className={`${surface.card} ${surface.pad}`}>
          <h2 className={`${text.cardTitle} mb-1`}>When it goes out</h2>
          <p className="text-sm text-slate-500 mb-3">
            {slot.date
              ? "Moving it re-files the piece in its new week and marks the Google event out of date, so the next push moves it."
              : "Pick a day and this piece joins the calendar. The time comes from the channel's usual posting window."}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={when?.date ?? ""}
              onChange={(e) =>
                setWhen((w) => ({ date: e.target.value, time: w?.time ?? "09:00" }))
              }
              className={field.select}
              aria-label="Date"
            />
            <input
              type="time"
              value={when?.time ?? ""}
              onChange={(e) =>
                setWhen((w) => ({ date: w?.date ?? "", time: e.target.value }))
              }
              className={field.select}
              aria-label="Time"
            />
            <span className={text.micro}>{timezone}</span>
            <button
              onClick={handleMove}
              disabled={
                moving ||
                !when?.date ||
                // Nothing to do when neither field moved.
                (when.date === slot.date && when.time === slot.time_local)
              }
              className={`${btn.primarySm} ml-auto`}
            >
              {moving ? "Moving…" : slot.date ? "Move" : "Schedule"}
            </button>
          </div>

          {/* Advice, not a refusal: going over a weekly cap is the operator's
              call, and the piece has already moved by the time this shows. */}
          {quotaNote && <p className={`${banner.warn} mt-3`}>{quotaNote}</p>}
        </section>

        {/* -------------------------------------------------------- brief -- */}
        <section className={`${surface.card} ${surface.pad}`}>
          <h2 className={`${text.cardTitle} mb-3`}>The brief</h2>

          <div className="space-y-3">
            <div>
              <label className={field.micro}>Theme</label>
              <input
                className={field.inputSm}
                value={draft.theme}
                onChange={(e) => patchDraft({ theme: e.target.value })}
              />
            </div>
            <div>
              <label className={field.micro}>Hook</label>
              <textarea
                className={`${field.textarea} h-16`}
                value={draft.hook}
                onChange={(e) => patchDraft({ hook: e.target.value })}
                placeholder="The first line, the first three seconds, slide 1."
              />
            </div>
            <div>
              <label className={field.micro}>Body — one entry per beat, in order</label>
              <div className="space-y-2">
                {draft.body.map((beat, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-xs text-slate-400 pt-2 w-4 shrink-0">
                      {i + 1}
                    </span>
                    <textarea
                      className={`${field.textarea} h-14`}
                      value={beat}
                      onChange={(e) => {
                        const body = [...draft.body];
                        body[i] = e.target.value;
                        patchDraft({ body });
                      }}
                    />
                    <button
                      onClick={() =>
                        patchDraft({ body: draft.body.filter((_, j) => j !== i) })
                      }
                      aria-label={`Remove beat ${i + 1}`}
                      className="text-slate-400 hover:text-red-600 transition-colors pt-2"
                    >
                      &#215;
                    </button>
                  </div>
                ))}
                {draft.body.length < MAX_BEATS && (
                  <button
                    onClick={() => patchDraft({ body: [...draft.body, ""] })}
                    className={btn.outlineSm}
                  >
                    + Beat
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className={field.micro}>CTA</label>
              <input
                className={field.inputSm}
                value={draft.cta}
                onChange={(e) => patchDraft({ cta: e.target.value })}
                placeholder="The ask, written as it would be said."
              />
            </div>
            <div>
              <label className={field.micro}>In one line</label>
              <input
                className={field.inputSm}
                value={draft.brief}
                onChange={(e) => patchDraft({ brief: e.target.value })}
              />
            </div>

            <div className="flex flex-wrap gap-2 items-center pt-1">
              <button
                onClick={handleSave}
                disabled={busy || !dirty}
                className={btn.primarySm}
              >
                {busy ? "Saving…" : "Save"}
              </button>
              {saved && (
                <span className="text-xs font-semibold text-green-700">Saved</span>
              )}
              {dirty && !saved && (
                <span className="text-xs text-amber-700">Unsaved changes</span>
              )}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- copy -- */}
        <section className={`${surface.card} ${surface.pad}`}>
          <h2 className={`${text.cardTitle} mb-3`}>
            {copy ? "The copy" : "The copy — not written yet"}
          </h2>

          {stale && (
            <p className="text-sm text-amber-700 mb-3">
              The brief changed after this was written, so the two no longer match.
            </p>
          )}
          {dirty && (
            <p className="text-sm text-amber-700 mb-3">
              Save the brief first — the copy is written from the stored version,
              and writing now would overwrite what you have typed.
            </p>
          )}

          {copy ? (
            <div className={`${surface.inset} space-y-3 mb-3`}>
              {copy.headline && (
                <p className="text-sm font-semibold text-slate-800">{copy.headline}</p>
              )}
              {copy.blocks.map((block, i) => (
                <div key={i}>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">
                    {block.label}
                  </p>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">
                    {block.text}
                  </p>
                  {block.onScreen && (
                    <p className="text-xs text-slate-500">on screen: {block.onScreen}</p>
                  )}
                  {block.note && (
                    <p className="text-xs text-slate-400 italic">{block.note}</p>
                  )}
                </div>
              ))}
              {copy.caption && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">
                    Caption
                  </p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">
                    {copy.caption}
                  </p>
                </div>
              )}
              {copy.hashtags.length > 0 && (
                <p className="text-xs text-teal-700">{copy.hashtags.join(" ")}</p>
              )}
            </div>
          ) : (
            <p className={`${text.muted} mb-3`}>
              The brief above says what this piece argues. Writing the copy turns it
              into the words you actually post.
            </p>
          )}

          {warnings.length > 0 && (
            <div className={`${banner.warn} mb-3`}>
              {warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}
          {slot.google_event_locked && copy && (
            <p className="text-sm text-amber-700 mb-3">
              This event&rsquo;s text is Google&rsquo;s, so the copy above will not
              appear on the calendar until you take it back.
            </p>
          )}

          <div className="space-y-2">
            <input
              className={field.inputSm}
              value={copySteer}
              onChange={(e) => setCopySteer(e.target.value)}
              placeholder="Optional: how to write it — e.g. shorter slides, no questions"
            />
            <button
              onClick={handleWriteCopy}
              disabled={busy || dirty}
              className={btn.primarySm}
            >
              {busy ? "Writing…" : copy ? "Write it again" : "Write the copy"}
            </button>
          </div>
        </section>

        {/* -------------------------------------------------------- agent -- */}
        <section className={`${surface.card} ${surface.pad}`}>
          <h2 className={`${text.cardTitle} mb-3`}>Ask the agent for a new brief</h2>
          <p className={`${text.muted} mb-3`}>
            Rewrite keeps the theme and redoes the execution. New angle replaces the
            theme too. The date, time and channel never move.
          </p>
          {dirty && (
            <p className="text-sm text-amber-700 mb-3">
              Save the brief first — the agent reads the stored version, and its
              answer would overwrite what you have typed.
            </p>
          )}
          <div className="space-y-2">
            <input
              className={field.inputSm}
              value={steer}
              onChange={(e) => setSteer(e.target.value)}
              placeholder="Optional: what to change — e.g. make the hook blunter"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleRegenerate("rewrite")}
                disabled={busy || dirty}
                className={btn.outlineSm}
              >
                {busy ? "Working…" : "Rewrite"}
              </button>
              <button
                onClick={() => handleRegenerate("angle")}
                disabled={busy || dirty}
                className={btn.outlineSm}
              >
                New angle
              </button>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- google -- */}
        <section className={`${surface.card} ${surface.pad}`}>
          <h2 className={`${text.cardTitle} mb-3`}>Google Calendar</h2>

          {slot.google_sync_status === "synced" && (
            <p className="text-sm text-slate-600">
              On the calendar and up to date.
            </p>
          )}
          {slot.google_sync_status === "stale" && (
            <p className="text-sm text-amber-700">
              Changed since the last sync. Sync from the schedule to push it.
            </p>
          )}
          {slot.google_sync_status === "removed" && (
            <p className="text-sm text-slate-500">
              Not on the calendar — its event was removed.
            </p>
          )}
          {slot.google_sync_status === "pending" && (
            <p className="text-sm text-slate-500">
              Not on the calendar yet. Sync from the schedule to put it there.
            </p>
          )}
          {slot.google_sync_error && (
            <p className={`${banner.error} mt-2`}>{slot.google_sync_error}</p>
          )}

          {slot.google_event_locked && (
            <div className="mt-3">
              <p className="text-sm text-amber-700">
                This event&rsquo;s title and notes were edited in Google, so syncing
                no longer rewrites them. Only its date and time still follow the plan.
              </p>
              <button
                onClick={handleUnlock}
                disabled={busy}
                className={`${btn.outlineSm} mt-2`}
              >
                {busy ? "Working…" : "Take it back"}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
