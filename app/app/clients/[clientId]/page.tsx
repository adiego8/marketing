"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { listPlanRuns, deletePlanRun } from "@/lib/api";
import { banner, btn, surface, table, text } from "@/lib/ui";
import { statusPill } from "@/lib/ui-status";
import type { PlanRun } from "@/lib/types";

// Summarises planning activity. This deliberately reads plan runs and not the
// old daily runs: /clients/{id}/runs was never ported off the Python backend,
// so calling it here fell through the rewrite to a dead localhost:8080 and
// answered 500 on every page load.

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function ClientDashboard() {
  const { clientId } = useParams() as { clientId: string };
  const [runs, setRuns] = useState<PlanRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listPlanRuns(clientId, 10)
      .then(setRuns)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load plan runs")
      )
      .finally(() => setLoading(false));
  }, [clientId]);

  const handleDelete = async (run: PlanRun) => {
    const what = run.committed_at
      ? `Delete this plan and everything it created?\n\n` +
        `• ${run.created_slot_ids.length} scheduled slot${run.created_slot_ids.length === 1 ? "" : "s"}\n` +
        `• their Google Calendar events\n\n` +
        `The quota reopens, so the next plan will propose replacements. Any ` +
        `other preview you have not accepted will go stale.`
      : "Discard this plan? It was never accepted, so nothing else is affected.";
    if (!confirm(what)) return;

    setDeleting(run.id);
    setError(null);
    try {
      const r = await deletePlanRun(clientId, run.id);
      setRuns((prev) => prev.filter((x) => x.id !== run.id));
      if (r.deletedSlots > 0) {
        setNotice(
          `Deleted the plan, ${r.deletedSlots} slot${r.deletedSlots === 1 ? "" : "s"}` +
            (r.removedEvents > 0 ? ` and ${r.removedEvents} calendar event${r.removedEvents === 1 ? "" : "s"}` : "") +
            "."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the plan");
    } finally {
      setDeleting(null);
    }
  };

  const latest = runs[0] ?? null;
  const slots = latest?.proposed_slots.length ?? 0;
  const warnings = latest?.warnings.length ?? 0;

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className={text.eyebrow}>Overview</p>
          <h1 className={`${text.h1} mt-1`}>Dashboard</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/clients/${clientId}/campaigns`}
            className={btn.outline}
          >
            Campaigns
          </Link>
          <Link href={`/clients/${clientId}/plan`} className={btn.primarySm}>
            Plan content
          </Link>
        </div>
      </div>

      {error && <p className={`${banner.error} mb-6`}>{error}</p>}
      {notice && <p className={`${banner.info} mb-6`}>{notice}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        <div className={surface.tile}>
          <p className={text.label}>Latest plan</p>
          <div className="mt-2">
            {latest ? (
              <span className={statusPill(latest.status)}>{latest.status}</span>
            ) : (
              <p className="text-sm text-slate-400">None yet</p>
            )}
          </div>
        </div>
        <div className={surface.tile}>
          <p className={text.label}>Slots proposed</p>
          <p className="text-2xl text-slate-900 mt-1">{slots}</p>
        </div>
        <div className={surface.tile}>
          <p className={text.label}>Campaigns</p>
          <p className="text-sm text-slate-800 mt-2">
            {latest?.demand?.length
              ? latest.demand.map((c) => c.title).join(", ")
              : "—"}
          </p>
        </div>
        <div className={surface.tile}>
          <p className={text.label}>Warnings</p>
          <p
            className={`text-2xl mt-1 ${
              warnings > 0 ? "text-amber-600" : "text-slate-900"
            }`}
          >
            {warnings}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className={text.cardTitle}>Recent plan runs</h2>
        <Link
          href={`/clients/${clientId}/plan`}
          className="text-xs font-semibold text-teal-700 hover:text-teal-600 transition-colors"
        >
          Open planner →
        </Link>
      </div>

      {loading ? (
        <p className={text.muted}>Loading…</p>
      ) : runs.length === 0 ? (
        <div className={surface.empty}>
          <p className="text-slate-700 text-lg">No plans yet.</p>
          <p className="text-slate-500 text-sm mt-1">
            Set a weekly quota on the Strategy page, then generate a plan.
          </p>
          <Link
            href={`/clients/${clientId}/strategy`}
            className={`${btn.primary} mt-6`}
          >
            Open strategy
          </Link>
        </div>
      ) : (
        <div className={`${surface.table} overflow-x-auto`}>
          <table className="w-full">
            <thead>
              <tr className="bg-stone-50">
                <th className={table.head}>Created</th>
                <th className={table.head}>Status</th>
                <th className={table.head}>Campaigns</th>
                <th className={`${table.head} text-right`}>Slots</th>
                <th className={`${table.head} text-right`}>Warnings</th>
                <th className={table.head}></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className={table.row}>
                  <td className={table.cellMuted}>
                    {new Date(run.created_at).toLocaleString()}
                  </td>
                  <td className={table.cell}>
                    <span className={statusPill(run.status)}>{run.status}</span>
                  </td>
                  <td className={table.cell}>
                    {/* Runs from before dating became a human step still carry
                        a horizon; newer ones carry the campaigns instead. */}
                    {run.demand?.length
                      ? run.demand.map((c) => c.title).join(", ")
                      : run.horizon
                        ? `${shortDate(run.horizon.startDate)} – ${shortDate(run.horizon.endDate)}`
                        : "—"}
                  </td>
                  <td className={`${table.cell} text-right`}>
                    {run.proposed_slots.length}
                  </td>
                  <td
                    className={`${table.cell} text-right ${
                      run.warnings.length > 0 ? "text-amber-700" : ""
                    }`}
                  >
                    {run.warnings.length}
                  </td>
                  <td className={`${table.cell} text-right`}>
                    <button
                      onClick={() => handleDelete(run)}
                      disabled={deleting === run.id}
                      className="text-xs text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
                    >
                      {deleting === run.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
