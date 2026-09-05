"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { listRuns, triggerRun } from "@/lib/api";
import type { RunListItem } from "@/lib/types";

export default function ClientDashboard() {
  const { clientId } = useParams() as { clientId: string };
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  const fetchRuns = async () => {
    try {
      const data = await listRuns(clientId, { limit: 10 });
      setRuns(data);
    } catch (e) {
      console.error("Failed to fetch runs:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, [clientId]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await triggerRun(clientId, "daily");
      setTimeout(fetchRuns, 1000);
    } catch (e) {
      console.error("Failed to trigger run:", e);
    } finally {
      setTriggering(false);
    }
  };

  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const running = runs.filter((r) => r.status === "running").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-zinc-500 text-sm">Marketing Agent Overview</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleTrigger} disabled={triggering}>
            {triggering ? "Triggering..." : "Trigger Daily Run"}
          </Button>
          <Link href={`/clients/${clientId}/onboarding`}>
            <Button variant="outline">New Research</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-500">Total Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{runs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-500">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-500">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-red-600">{failed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-500">Running</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-blue-600">{running}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Runs</CardTitle>
          <Link href={`/clients/${clientId}/runs`}>
            <Button variant="ghost" size="sm" className="text-xs text-zinc-500">
              View All →
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-zinc-500 text-sm">Loading...</p>
          ) : runs.length === 0 ? (
            <p className="text-zinc-500 text-sm">
              No runs yet. Trigger your first daily run!
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-zinc-500">
                  <th className="pb-2 font-medium">Run ID</th>
                  <th className="pb-2 font-medium">Task</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b last:border-0">
                    <td className="py-3 font-mono text-xs">
                      {run.id.slice(0, 8)}...
                    </td>
                    <td className="py-3">{run.task_type}</td>
                    <td className="py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="py-3 text-zinc-500">
                      {new Date(run.created_at).toLocaleString()}
                    </td>
                    <td className="py-3">
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
