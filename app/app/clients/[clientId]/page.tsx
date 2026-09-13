"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  listPlanRuns,
  deletePlanRun,
  listCampaigns,
  listSlots,
  listResearchRuns,
  getStrategy,
} from "@/lib/api";
import { banner, btn, surface, text } from "@/lib/ui";
import { statusPill } from "@/lib/ui-status";
import type {
  PlanRun,
  CampaignListItem,
  Slot,
  ResearchRun,
  Strategy,
} from "@/lib/types";

/**
 * The client's home.
 *
 * This replaced a Dashboard whose entire body was a table of past plan runs
 * with delete buttons — an answer to "what happened" on the one screen where
 * the only question is "what now". It duplicated Campaigns and the planner, and
 * it was the default landing page.
 *
 * Three bands, in the order the questions get asked:
 *   1. what is waiting on you
 *   2. where this client stands in the pipeline
 *   3. what happened lately — the old table, demoted to a log
 */

interface Blocker {
  key: string;
  text: string;
  action: string;
  href: string;
}

export default function ClientOverview() {
  const { clientId } = useParams() as { clientId: string };

  const [runs, setRuns] = useState<PlanRun[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [research, setResearch] = useState<ResearchRun[]>([]);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      listPlanRuns(clientId, 10).catch(() => [] as PlanRun[]),
      listCampaigns(clientId).catch(() => [] as CampaignListItem[]),
      listSlots(clientId).catch(() => [] as Slot[]),
      listResearchRuns(clientId).catch(() => [] as ResearchRun[]),
      getStrategy(clientId).catch(() => null),
    ])
      .then(([r, c, s, rr, st]) => {
        setRuns(r);
        setCampaigns(c);
        setSlots(s);
        setResearch(rr);
        setStrategy(st);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load this client")
      )
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  const handleDelete = async (run: PlanRun) => {
    const what = run.committed_at
      ? `Delete this plan and everything it created?\n\n` +
        `• ${run.created_slot_ids.length} scheduled piece${run.created_slot_ids.length === 1 ? "" : "s"}\n` +
        `• their Google Calendar events\n\n` +
        `Whatever they covered goes back to being owed, so the next run writes ` +
        `it again. Any preview you have not accepted will go stale.`
      : "Discard this plan? It was never accepted, so nothing else is affected.";
    if (!confirm(what)) return;

    setDeleting(run.id);
    setError(null);
    try {
      const r = await deletePlanRun(clientId, run.id);
      setRuns((prev) => prev.filter((x) => x.id !== run.id));
      if (r.deletedSlots > 0) {
        setNotice(
          `Deleted the plan, ${r.deletedSlots} piece${r.deletedSlots === 1 ? "" : "s"}` +
            (r.removedEvents > 0
              ? ` and ${r.removedEvents} calendar event${r.removedEvents === 1 ? "" : "s"}`
              : "") +
            "."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the plan");
    } finally {
      setDeleting(null);
    }
  };

  /* ------------------------------------------------------------ derived -- */

  const prefix = `/clients/${clientId}`;
  const latest = runs[0] ?? null;
  const active = campaigns.filter((c) => c.status === "active");
  const waiting = campaigns.filter((c) =>
    ["proposal", "in_review"].includes(c.status)
  );
  const undated = slots.filter((s) => !s.date);
  const dated = slots.filter((s) => s.date);
  // Acceptance is a timestamp, not a status: a run stays "complete" and gains
  // an accepted_at when someone turns it into the strategy.
  const acceptedResearch = research.filter((r) => r.accepted_at);

  // Only what someone can act on right now. An empty list is the good state and
  // says so, rather than being padded out with tiles that always render.
  const blockers: Blocker[] = [];
  if (!strategy) {
    blockers.push({
      key: "strategy",
      text: "No strategy yet — everything the agent writes reads from it",
      action: "Set the strategy",
      href: `${prefix}/strategy`,
    });
  }
  if (waiting.length > 0) {
    blockers.push({
      key: "campaigns",
      text: `${waiting.length} campaign${waiting.length === 1 ? "" : "s"} waiting on your review`,
      action: waiting.length === 1 ? "Review it" : "Review them",
      href: `${prefix}/campaigns`,
    });
  }
  if (strategy && active.length === 0 && waiting.length === 0) {
    blockers.push({
      key: "no-campaign",
      text: "No active campaign, so there is nothing for the agent to write",
      action: "Start a campaign",
      href: `${prefix}/campaigns`,
    });
  }
  if (undated.length > 0) {
    blockers.push({
      key: "undated",
      text: `${undated.length} accepted piece${undated.length === 1 ? "" : "s"} with no day`,
      action: "Give them days",
      href: `${prefix}/schedule`,
    });
  }
  if (latest?.status === "degraded") {
    blockers.push({
      key: "degraded",
      text: "The last run could not reach the theme model, so themes are missing",
      action: "Look at it",
      href: `${prefix}/campaigns`,
    });
  }

  const PIPELINE = [
    {
      label: "Research",
      state: acceptedResearch.length > 0 ? "done" : research.length > 0 ? "part" : "todo",
      detail:
        acceptedResearch.length > 0
          ? `${acceptedResearch.length} accepted`
          : research.length > 0
            ? `${research.length} run, none accepted`
            : "none yet",
      href: `${prefix}/research`,
    },
    {
      label: "Strategy",
      state: strategy ? "done" : "todo",
      detail: strategy ? "set" : "not set",
      href: `${prefix}/strategy`,
    },
    {
      label: "Campaigns",
      state: active.length > 0 ? "done" : campaigns.length > 0 ? "part" : "todo",
      detail: active.length > 0 ? `${active.length} active` : `${campaigns.length} total`,
      href: `${prefix}/campaigns`,
    },
    {
      label: "Content",
      state: slots.length > 0 ? "done" : latest ? "part" : "todo",
      detail: slots.length > 0 ? `${slots.length} accepted` : latest ? "written, not accepted" : "none yet",
      href: `${prefix}/campaigns`,
    },
    {
      label: "Calendar",
      state: dated.length > 0 ? "done" : "todo",
      detail: dated.length > 0 ? `${dated.length} dated` : "nothing dated",
      href: `${prefix}/schedule`,
    },
  ];

  const dotColor = (state: string) =>
    state === "done"
      ? "bg-teal-600"
      : state === "part"
        ? "bg-amber-400"
        : "bg-slate-200";

  return (
    <div className="max-w-5xl">
      <h1 className={`${text.h1} mb-8`}>Overview</h1>

      {error && <p className={`${banner.error} mb-6`}>{error}</p>}
      {notice && <p className={`${banner.info} mb-6`}>{notice}</p>}

      {/* ---------------------------------------------------- 1. blockers -- */}
      <section className="mb-10">
        <h2 className={`${text.cardTitle} mb-3`}>What needs you</h2>
        {loading ? (
          <p className={text.muted}>Loading…</p>
        ) : blockers.length === 0 ? (
          <div className={`${surface.card} px-5 py-4`}>
            <p className="text-sm text-slate-600">
              Nothing waiting. {dated.length > 0
                ? `${dated.length} piece${dated.length === 1 ? " is" : "s are"} scheduled.`
                : "Write some content when you are ready."}
            </p>
          </div>
        ) : (
          <div className={surface.list}>
            {blockers.map((b) => (
              <div
                key={b.key}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <p className="text-sm text-slate-700">{b.text}</p>
                <Link href={b.href} className={`${btn.outlineSm} shrink-0`}>
                  {b.action}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- 2. pipeline -- */}
      <section className="mb-10">
        <h2 className={`${text.cardTitle} mb-3`}>Where this client stands</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden">
          {PIPELINE.map((step) => (
            <Link
              key={step.label}
              href={step.href}
              className="bg-white px-4 py-3.5 hover:bg-stone-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor(step.state)}`}
                  aria-hidden="true"
                />
                <span className="text-sm font-semibold text-slate-800">
                  {step.label}
                </span>
              </span>
              <span className="block text-xs text-slate-500 mt-1 pl-3.5">
                {step.detail}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- 3. the log -- */}
      <section>
        <h2 className={`${text.cardTitle} mb-3`}>Recent plans</h2>

        {loading ? null : runs.length === 0 ? (
          <div className={surface.empty}>
            <p className="text-slate-700 text-lg">No plans yet.</p>
            <p className="text-slate-500 text-sm mt-1">
              A campaign&rsquo;s content plan is what the agent writes from. Accept
              one, then write its content.
            </p>
            <Link href={`${prefix}/campaigns`} className={`${btn.primary} mt-6`}>
              Open campaigns
            </Link>
          </div>
        ) : (
          <div className={surface.list}>
            {runs.map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3"
              >
                <span className="text-sm text-slate-500 w-40 shrink-0 tabular-nums">
                  {new Date(run.created_at).toLocaleString()}
                </span>
                <span className={statusPill(run.status)}>{run.status}</span>
                <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">
                  {run.demand?.length
                    ? run.demand.map((c) => c.title).join(", ")
                    : "—"}
                </span>
                <span className="text-sm text-slate-500 tabular-nums">
                  {run.proposed_slots.length} piece
                  {run.proposed_slots.length === 1 ? "" : "s"}
                </span>
                {run.warnings.length > 0 && (
                  <span className="text-xs text-amber-700">
                    {run.warnings.length} warning
                    {run.warnings.length === 1 ? "" : "s"}
                  </span>
                )}
                <button
                  onClick={() => handleDelete(run)}
                  disabled={deleting === run.id}
                  className="text-xs text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
                >
                  {deleting === run.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
