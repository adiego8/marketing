"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { listRuns, triggerRun } from "@/lib/api";
import type { RunListItem } from "@/lib/types";

const PAGE_SIZE = 20;

function formatDuration(start: string, end?: string): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export default function RunsPage() {
  const { clientId } = useParams() as { clientId: string };
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchRuns = async (reset = false) => {
    const newOffset = reset ? 0 : offset;
    try {
      const data = await listRuns(clientId, {
        status: statusFilter || undefined,
        task_type: taskFilter || undefined,
        limit: PAGE_SIZE,
        offset: newOffset,
      });
      if (reset) {
        setRuns(data);
        setOffset(PAGE_SIZE);
      } else {
        setRuns((prev) => [...prev, ...data]);
        setOffset(newOffset + PAGE_SIZE);
      }
      setHasMore(data.length === PAGE_SIZE);
    } catch (e) {
      console.error("Failed to fetch runs:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchRuns(true);
  }, [clientId, statusFilter, taskFilter]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await triggerRun(clientId, "daily");
      setTimeout(() => fetchRuns(true), 1000);
    } catch (e) {
      console.error("Failed to trigger run:", e);
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Runs</h1>
          <p className="text-zinc-500 text-sm">All pipeline executions</p>
        </div>
        <Button onClick={handleTrigger} disabled={triggering}>
          {triggering ? "Triggering..." : "Trigger Daily Run"}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All Statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All Task Types</option>
          <option value="daily">Daily</option>
          <option value="campaign">Campaign</option>
        </select>
      </div>

      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <p className="text-zinc-500 text-sm py-4">Loading...</p>
          ) : runs.length === 0 ? (
            <p className="text-zinc-500 text-sm py-4">
              No runs found. Trigger your first daily run!
            </p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-zinc-500">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Task Type</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Duration</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b last:border-0 hover:bg-zinc-50">
                      <td className="py-3 text-zinc-600">
                        {new Date(run.created_at).toLocaleString()}
                      </td>
                      <td className="py-3">{run.task_type}</td>
                      <td className="py-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="py-3 text-zinc-500">
                        {formatDuration(run.created_at, run.completed_at)}
                      </td>
                      <td className="py-3 text-right">
                        <Link href={`/clients/${clientId}/runs/${run.id}`}>
                          <Button variant="ghost" size="sm">
                            View
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMore && (
                <div className="pt-4 text-center">
                  <Button variant="outline" size="sm" onClick={() => fetchRuns(false)}>
                    Load More
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
