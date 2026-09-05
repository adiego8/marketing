"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPlanRuns } from "@/lib/api";
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

  useEffect(() => {
    listPlanRuns(clientId, 10)
      .then(setRuns)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load plan runs")
      )
      .finally(() => setLoading(false));
  }, [clientId]);

  const latest = runs[0] ?? null;
  const slots = latest?.proposed_slots.length ?? 0;
  const warnings = latest?.warnings.length ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-zinc-500 text-sm">Content plan overview</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/clients/${clientId}/campaigns`}>
            <Button variant="outline">Campaigns</Button>
          </Link>
          <Link href={`/clients/${clientId}/plan`}>
            <Button>Plan content</Button>
          </Link>
        </div>
      </div>

      {error && (
        <p className="mb-6 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-500">Latest plan</CardTitle>
          </CardHeader>
          <CardContent>
            {latest ? (
              <StatusBadge status={latest.status} />
            ) : (
              <p className="text-sm text-zinc-400">None yet</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-500">Slots proposed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{slots}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-500">Horizon</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {latest
                ? `${shortDate(latest.horizon.startDate)} – ${shortDate(
                    latest.horizon.endDate
                  )}`
                : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-500">Warnings</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-3xl font-bold ${
                warnings > 0 ? "text-amber-600" : ""
              }`}
            >
              {warnings}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent plan runs</CardTitle>
          <Link href={`/clients/${clientId}/plan`}>
            <Button variant="ghost" size="sm" className="text-xs text-zinc-500">
              Open planner →
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-zinc-500 text-sm">Loading...</p>
          ) : runs.length === 0 ? (
            <p className="text-zinc-500 text-sm">
              No plans yet. Set a weekly quota on the Strategy page, then
              generate a plan.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Horizon</TableHead>
                  <TableHead className="text-right">Slots</TableHead>
                  <TableHead className="text-right">Warnings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-zinc-500">
                      {new Date(run.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>
                      {shortDate(run.horizon.startDate)} –{" "}
                      {shortDate(run.horizon.endDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {run.proposed_slots.length}
                    </TableCell>
                    <TableCell className="text-right">
                      {run.warnings.length}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
