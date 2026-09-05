"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { previewPlan, listPlanRuns } from "@/lib/api";
import type { PlanRun, ProposedSlot } from "@/lib/types";

const HORIZONS = [1, 2, 4];

const CHANNEL_COLORS: Record<string, string> = {
  linkedin: "bg-blue-100 text-blue-800",
  instagram: "bg-pink-100 text-pink-800",
  twitter: "bg-sky-100 text-sky-800",
  email: "bg-amber-100 text-amber-800",
};

function dayLabel(date: string) {
  // The date is already local to the client; parse as UTC so the browser's own
  // timezone cannot shift it a day either way.
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function PlanPage() {
  const { clientId } = useParams() as { clientId: string };
  const [run, setRun] = useState<PlanRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [weeks, setWeeks] = useState(2);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPlanRuns(clientId, 1)
      .then((runs) => setRun(runs[0] ?? null))
      .catch((e) => console.error("Failed to load plan runs:", e))
      .finally(() => setLoading(false));
  }, [clientId]);

  const handlePreview = async () => {
    setPlanning(true);
    setError(null);
    try {
      setRun(await previewPlan(clientId, weeks));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Planning failed");
    } finally {
      setPlanning(false);
    }
  };

  const byWeek = (run?.proposed_slots ?? []).reduce<Record<string, ProposedSlot[]>>(
    (acc, slot) => {
      (acc[slot.weekKey] ||= []).push(slot);
      return acc;
    },
    {}
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Plan</h1>
          <p className="text-zinc-500 text-sm">
            {run
              ? `${run.proposed_slots.length} slot${run.proposed_slots.length === 1 ? "" : "s"} proposed for ${run.horizon.startDate} to ${run.horizon.endDate}`
              : "Propose a content schedule from the weekly quota"}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex gap-1">
            {HORIZONS.map((w) => (
              <Button
                key={w}
                variant={weeks === w ? "default" : "outline"}
                size="sm"
                onClick={() => setWeeks(w)}
              >
                {w}w
              </Button>
            ))}
          </div>
          <Button onClick={handlePreview} disabled={planning}>
            {planning ? "Planning… (20-40s)" : "Generate preview"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 p-3 rounded mb-4">{error}</p>
      )}

      {run?.status === "degraded" && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded mb-4">
          The theme model was unavailable. Dates and channels are correct; themes
          are missing and marked below.
        </p>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : !run ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-zinc-500 text-sm mb-4">
              No plan yet. Generate a preview to see what the next {weeks} week
              {weeks === 1 ? "" : "s"} would look like.
            </p>
            <Button onClick={handlePreview} disabled={planning}>
              Generate preview
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Coverage — the number a human actually judges the plan by. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Coverage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Week</TableHead>
                      <TableHead className="w-24">Type</TableHead>
                      <TableHead className="w-20">Quota</TableHead>
                      <TableHead className="w-24">Scheduled</TableHead>
                      <TableHead className="w-24">Proposed</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {run.observation.gaps.map((gap, i) => {
                      const proposed = run.proposed_slots.filter(
                        (s) => s.weekKey === gap.weekKey && s.type === gap.type
                      ).length;
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-medium">
                            {gap.weekKey}
                            {gap.partialWeek && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                partial
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="capitalize">
                            {gap.type.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell>{gap.quotaCount}</TableCell>
                          <TableCell>{gap.existing}</TableCell>
                          <TableCell
                            className={proposed < gap.deficit ? "text-amber-700" : ""}
                          >
                            +{proposed}
                          </TableCell>
                          <TableCell className="text-xs text-zinc-500">
                            {gap.surplus > 0 && `${gap.surplus} over quota. `}
                            {gap.notes.join(" ")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Proposed slots, grouped by week. */}
          {Object.entries(byWeek).map(([weekKey, slots]) => (
            <div key={weekKey}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold">{weekKey}</h3>
                <Badge variant="outline" className="text-xs">
                  {slots.length}
                </Badge>
              </div>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-36">Date</TableHead>
                      <TableHead className="w-20">Time</TableHead>
                      <TableHead className="w-28">Channel</TableHead>
                      <TableHead className="w-24">Type</TableHead>
                      <TableHead>Theme</TableHead>
                      <TableHead className="w-40">Campaign</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slots.map((slot) => (
                      <TableRow key={slot.slotId}>
                        <TableCell className="font-medium">
                          {dayLabel(slot.date)}
                        </TableCell>
                        <TableCell>{slot.timeLocal}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={CHANNEL_COLORS[slot.channel] || ""}
                          >
                            {slot.channel}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize">
                          {slot.type.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell>
                          {slot.needsTheme ? (
                            <Badge variant="outline" className="bg-red-50 text-red-700">
                              needs theme
                            </Badge>
                          ) : (
                            <>
                              <p>{slot.theme}</p>
                              {slot.rationale && (
                                <p className="text-xs text-zinc-500 mt-0.5">
                                  {slot.rationale}
                                </p>
                              )}
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-zinc-500">
                          {slot.campaignTitle ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}

          {/* Why the plan is thinner than the quota. The most useful panel here:
              it turns "I asked for 9 and got 6" into an understood constraint. */}
          {(run.deferred.length > 0 || run.warnings.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Not planned, and why</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {run.deferred.map((d, i) => (
                  <p key={i} className="text-sm text-zinc-600">
                    <span className="capitalize font-medium">{d.type}</span> in{" "}
                    {d.weekKey}: {d.reason}
                  </p>
                ))}
                {run.warnings.map((w, i) => (
                  <p key={`w${i}`} className="text-sm text-zinc-500">
                    {w}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between border rounded-lg p-4 bg-zinc-50">
            <p className="text-sm text-zinc-600">
              Preview only. Nothing has been written to the calendar.
            </p>
            <Button variant="outline" disabled>
              Commit (Phase 3)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
