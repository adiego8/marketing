"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  listLessons,
  createLesson,
  updateLesson,
  deleteLesson,
  listSignals,
} from "@/lib/api";
import { banner, btn, field, surface, text } from "@/lib/ui";
import { PILL } from "@/lib/ui-status";
import { contentTypeLabel } from "@/lib/marketing/content-types";
import { MAX_LESSON_CHARS } from "@/lib/marketing/lessons";
import { LESSON_SCOPES, type Lesson, type LessonScope, type Signal } from "@/lib/types";

/**
 * What the agent has been taught about this client.
 *
 * The page exists as much for trust as for control. An agent that silently
 * adjusts is a black box; one that says what it has learned, shows the
 * rejections behind each rule and lets you argue with it reads as a colleague.
 *
 * Two halves: the rules the agent writes against, and the evidence — every
 * piece rejected, rewritten or steered. The evidence is read-only here. It is
 * what a later phase will distil into proposed rules; on its own it already
 * answers "what do I keep saying no to".
 */

const SCOPE_LABELS: Record<LessonScope, string> = {
  campaign_ideas: "campaign ideas",
  plan_themes: "what gets written",
  copy: "the copy",
};

const KIND_LABELS: Record<string, string> = {
  edited: "rewritten by hand",
  dropped: "dropped",
  steered: "sent back",
  restored: "put back",
  retired: "skipped or cancelled",
};

export default function LearnedPage() {
  const { clientId } = useParams() as { clientId: string };

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [draftScope, setDraftScope] = useState<LessonScope>("plan_themes");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      listLessons(clientId),
      listSignals(clientId).catch(() => [] as Signal[]),
    ])
      .then(([l, s]) => {
        setLessons(l);
        setSignals(s);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load what the agent knows")
      )
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  const handleAdd = async () => {
    if (!draft.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const created = await createLesson(clientId, {
        text: draft.trim(),
        scope: draftScope,
      });
      setLessons((prev) => [created, ...prev]);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that lesson");
    } finally {
      setAdding(false);
    }
  };

  const setStatus = async (lesson: Lesson, status: "active" | "retired") => {
    setBusyId(lesson.id);
    setError(null);
    try {
      const updated = await updateLesson(clientId, lesson.id, { status });
      setLessons((prev) => prev.map((l) => (l.id === lesson.id ? updated : l)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that lesson");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (lesson: Lesson) => {
    if (!confirm("Delete this lesson? Retiring keeps it visible instead.")) return;
    setBusyId(lesson.id);
    try {
      await deleteLesson(clientId, lesson.id);
      setLessons((prev) => prev.filter((l) => l.id !== lesson.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that lesson");
    } finally {
      setBusyId(null);
    }
  };

  const active = lessons.filter((l) => l.status === "active");
  const retired = lessons.filter((l) => l.status === "retired");

  // Grouped for reading, not counted for scoring: this is a summary of what you
  // keep saying no to, and the phrasing is yours.
  const byKind = signals.reduce<Record<string, number>>((acc, s) => {
    acc[s.kind] = (acc[s.kind] ?? 0) + 1;
    return acc;
  }, {});
  const reasons = signals
    .filter((s) => s.reason.trim())
    .reduce<Record<string, number>>((acc, s) => {
      const key = s.reason.trim().toLowerCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  const topReasons = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const oldest = signals.at(-1)?.created_at;

  const LessonRow = ({ lesson }: { lesson: Lesson }) => (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <p
          className={
            lesson.status === "retired"
              ? "text-sm text-slate-400 line-through"
              : "text-sm text-slate-800"
          }
        >
          {lesson.text}
        </p>
        <p className="text-xs text-slate-400 mt-1">
          {SCOPE_LABELS[lesson.scope as LessonScope] ?? lesson.scope}
          {" · "}
          {lesson.source === "written" ? "written by you" : "from your rejections"}
          {lesson.evidence_count > 0 && ` · ${lesson.evidence_count} pieces`}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        {lesson.status === "active" ? (
          <button
            onClick={() => setStatus(lesson, "retired")}
            disabled={busyId === lesson.id}
            className={btn.outlineSm}
          >
            {busyId === lesson.id ? "…" : "Retire"}
          </button>
        ) : (
          <>
            <button
              onClick={() => setStatus(lesson, "active")}
              disabled={busyId === lesson.id}
              className={btn.outlineSm}
            >
              Bring back
            </button>
            <button onClick={() => handleDelete(lesson)} className={btn.ghost}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl">
      <h1 className={text.h1}>What the agent has learned</h1>
      <p className="text-sm text-slate-500 mt-1 mb-8">
        Rules it writes against for this client. Every generation gets them —
        campaign ideas, what gets written, and the copy.
      </p>

      {error && <p className={`${banner.error} mb-6`}>{error}</p>}

      {/* ------------------------------------------------------ teach it -- */}
      <section className={`${surface.card} ${surface.pad} mb-8`}>
        <h2 className={`${text.cardTitle} mb-1`}>Teach it something</h2>
        <p className="text-sm text-slate-500 mb-3">
          One rule, said plainly — &ldquo;open with the cost of the status quo,
          not the product&rdquo;. Short beats thorough: the agent follows a rule
          and skims a paragraph.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            maxLength={MAX_LESSON_CHARS}
            placeholder="Never open with the product name."
            className={`${field.inputSm} flex-1 min-w-[16rem]`}
          />
          <select
            value={draftScope}
            onChange={(e) => setDraftScope(e.target.value as LessonScope)}
            className={field.select}
            aria-label="What this rule applies to"
          >
            {LESSON_SCOPES.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={adding || !draft.trim()}
            className={btn.primarySm}
          >
            {adding ? "Saving…" : "Teach it"}
          </button>
        </div>
      </section>

      {/* -------------------------------------------------------- active -- */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <h2 className={text.cardTitle}>In force</h2>
          {active.length > 0 && (
            <span className={`${PILL} bg-teal-50 text-teal-700`}>{active.length}</span>
          )}
        </div>
        {loading ? (
          <p className={text.muted}>Loading…</p>
        ) : active.length === 0 ? (
          <div className={surface.empty}>
            <p className="text-slate-700 text-lg">Nothing taught yet.</p>
            <p className="text-slate-500 text-sm mt-1">
              The agent is working from the strategy alone. Add a rule above, or
              let your rejections below suggest one.
            </p>
          </div>
        ) : (
          <div className={surface.list}>
            {active.map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ evidence -- */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-1">
          <h2 className={text.cardTitle}>What you have turned down</h2>
          {signals.length > 0 && (
            <span className={`${PILL} bg-slate-100 text-slate-500`}>{signals.length}</span>
          )}
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Recorded as you work — dropping an idea, rewriting a hook, sending a
          piece back. Nothing here changes what the agent writes until you turn
          it into a rule.
        </p>

        {signals.length === 0 ? (
          <div className={`${surface.card} px-5 py-4`}>
            <p className="text-sm text-slate-600">
              Nothing recorded yet. Drop an idea or rewrite a piece and it shows
              up here.
            </p>
          </div>
        ) : (
          <div className={`${surface.card} ${surface.pad}`}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
              {Object.entries(byKind).map(([kind, n]) => (
                <span key={kind} className="text-sm text-slate-700">
                  <span className="font-semibold tabular-nums">{n}</span>{" "}
                  <span className="text-slate-500">{KIND_LABELS[kind] ?? kind}</span>
                </span>
              ))}
            </div>
            {oldest && (
              <p className={`${text.micro} mb-3`}>
                since {new Date(oldest).toLocaleDateString()}
              </p>
            )}

            {topReasons.length > 0 && (
              <>
                <p className={`${field.micro} mt-4`}>Reasons you gave</p>
                <div className="flex flex-wrap gap-2">
                  {topReasons.map(([reason, n]) => (
                    <span
                      key={reason}
                      className="rounded-lg bg-stone-50 border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
                    >
                      {reason}
                      {n > 1 && <span className="text-slate-400"> ×{n}</span>}
                    </span>
                  ))}
                </div>
              </>
            )}

            <p className={`${field.micro} mt-5`}>Most recent</p>
            <div className="space-y-2">
              {signals.slice(0, 6).map((s) => (
                <div key={s.id} className="text-sm">
                  <span className="text-slate-500">
                    {KIND_LABELS[s.kind] ?? s.kind}
                  </span>
                  {s.type && (
                    <span className="text-slate-400">
                      {" · "}
                      {contentTypeLabel(s.type)}
                    </span>
                  )}
                  {s.before?.theme && (
                    <span className="text-slate-700">
                      {" — "}
                      {s.before.theme}
                    </span>
                  )}
                  {s.reason && (
                    <span className="text-slate-500">
                      {" — "}
                      &ldquo;{s.reason}&rdquo;
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- retired -- */}
      {retired.length > 0 && (
        <section>
          <h2 className={`${text.cardTitle} mb-1`}>No longer in force</h2>
          <p className="text-sm text-slate-500 mb-3">
            Kept so you can see what the agent used to believe.
          </p>
          <div className={surface.list}>
            {retired.map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
