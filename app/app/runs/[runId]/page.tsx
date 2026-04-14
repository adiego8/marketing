"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { AssetCard } from "@/components/runs/asset-card";
import { getRun, triggerDebrief } from "@/lib/api";
import type { Run, Asset } from "@/lib/types";

export default function RunDetailPage() {
  const params = useParams();
  const runId = params.runId as string;
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [debriefing, setDebriefing] = useState(false);

  const fetchRun = async () => {
    try {
      const data = await getRun(runId);
      setRun(data);
    } catch (e) {
      console.error("Failed to fetch run:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRun();
    // Poll if running
    const interval = setInterval(async () => {
      const data = await getRun(runId);
      setRun(data);
      if (data.status !== "running") clearInterval(interval);
    }, 5000);
    return () => clearInterval(interval);
  }, [runId]);

  const handleDebrief = async () => {
    setDebriefing(true);
    try {
      await triggerDebrief(runId);
      await fetchRun();
    } catch (e) {
      console.error("Failed to generate debrief:", e);
    } finally {
      setDebriefing(false);
    }
  };

  if (loading) return <p className="text-zinc-500">Loading...</p>;
  if (!run) return <p className="text-red-500">Run not found</p>;

  const output = run.output;
  const planning = output?.planning;

  // Get assets from the deepest pipeline step available
  const postProd = output?.post_production?.produced_assets;
  const reviewed = output?.review?.approved_assets;
  const generated = output?.generation?.assets;
  const assets: Asset[] = postProd || reviewed || generated || [];

  const reviewNotes = output?.review?.review_notes || [];
  const reviewAttempts = output?.review?.attempts;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800 mb-2 inline-block">
          ← Back to Dashboard
        </Link>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">Run Detail</h1>
          <StatusBadge status={run.status} />
          <Badge variant="outline">{run.task_type}</Badge>
        </div>
        <p className="text-xs text-zinc-500 font-mono">{run.id}</p>
        <p className="text-sm text-zinc-500">
          {new Date(run.created_at).toLocaleString()}
          {run.completed_at && ` — completed ${new Date(run.completed_at).toLocaleString()}`}
        </p>
      </div>

      {/* Error */}
      {output?.error && (
        <Card className="mb-6 border-red-200">
          <CardContent className="pt-4">
            <p className="text-sm text-red-600">{output.error}</p>
          </CardContent>
        </Card>
      )}

      {/* Planning */}
      {planning && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm">Planning</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="font-semibold">Topic:</span> {planning.topic}</p>
            <p><span className="font-semibold">Angle:</span> {planning.angle}</p>
            <p><span className="font-semibold">Tone:</span> {planning.tone}</p>
            <p><span className="font-semibold">Reasoning:</span> {planning.reasoning}</p>
          </CardContent>
        </Card>
      )}

      {/* Review notes */}
      {reviewNotes.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm">
              Review {reviewAttempts && `(passed on attempt ${reviewAttempts})`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-xs space-y-1 text-zinc-600">
              {reviewNotes.map((note, i) => (
                <li key={i}>• {note}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Assets */}
      {assets.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Assets ({assets.length})</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {assets.map((asset, i) => (
              <AssetCard key={i} asset={asset} index={i} runId={runId} />
            ))}
          </div>
        </div>
      )}

      {/* Debrief */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Debrief</CardTitle>
        </CardHeader>
        <CardContent>
          {run.debrief ? (
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-semibold">What I Did</p>
                <p className="text-zinc-600">{run.debrief.what_i_did}</p>
              </div>
              <div>
                <p className="font-semibold">What I Learned</p>
                <p className="text-zinc-600">{run.debrief.what_i_learned}</p>
              </div>
              <div>
                <p className="font-semibold">Things to Improve</p>
                <p className="text-zinc-600">{run.debrief.things_to_improve}</p>
              </div>
              <div>
                <p className="font-semibold">What I&apos;d Do Differently</p>
                <p className="text-zinc-600">{run.debrief.what_id_do_differently}</p>
              </div>
            </div>
          ) : (
            <Button onClick={handleDebrief} disabled={debriefing || run.status !== "completed"}>
              {debriefing ? "Generating..." : "Generate Debrief"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
