"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listCampaigns, generateCampaigns, createCampaign } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";
import { banner, surface } from "@/lib/ui";
import { PILL, PILL_SM, statusColor, statusLabel } from "@/lib/ui-status";
import type { CampaignListItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Every status the backend can store, in pipeline order.
 *
 * Must stay in step with CAMPAIGN_STATUSES in lib/marketing/campaigns.ts.
 * `idea` was missing, and because `grouped` is built by filtering once per
 * column, a campaign in a status with no column rendered nowhere at all — while
 * the header above still counted it, so the board showed fewer campaigns than
 * it claimed to have. Everything made with "Create manual" lands in `idea`
 * (parseCampaignCreate hardcodes it), so all of those were invisible; only
 * generated campaigns, which start in `proposal`, ever showed up.
 */
const STATUS_COLUMNS = [
  "idea",
  "proposal",
  "in_review",
  "active",
  "completed",
  "rejected",
] as const;

export default function CampaignsPage() {
  const { clientId } = useParams() as { clientId: string };
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchCampaigns = async () => {
    try {
      setCampaigns(await listCampaigns(clientId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load campaigns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await generateCampaigns(clientId, {
        prompt: generatePrompt || undefined,
        count: 3,
      });
      setShowGenerate(false);
      setGeneratePrompt("");
      await fetchCampaigns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate campaigns");
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setError(null);
    try {
      await createCampaign(clientId, {
        title: newTitle,
        description: newDescription || undefined,
      });
      setShowCreate(false);
      setNewTitle("");
      setNewDescription("");
      await fetchCampaigns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create campaign");
    }
  };

  const grouped = STATUS_COLUMNS.reduce(
    (acc, status) => {
      acc[status] = campaigns.filter((c) => c.status === status);
      return acc;
    },
    {} as Record<string, CampaignListItem[]>
  );

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Campaigns"
        description={`${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`}
        actions={
          <>
            <Button variant="secondary" size="md" onClick={() => setShowCreate(true)}>
              Create manual
            </Button>
            <Button variant="primary" size="md" onClick={() => setShowGenerate(true)}>
              Generate ideas
            </Button>
          </>
        }
      />

      {error && <p className={`${banner.error} mb-4`}>{error}</p>}

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : campaigns.length === 0 ? (
        <div className={surface.empty}>
          <p className="text-slate-700 text-lg">No campaigns yet.</p>
          <p className="text-slate-500 text-sm mt-1">
            Campaigns supply the themes the planner schedules against.
          </p>
          <Button
            variant="primary"
            size="md"
            className="mt-6"
            onClick={() => setShowGenerate(true)}
          >
            Generate campaign ideas
          </Button>
        </div>
      ) : (
        // Six columns rather than five. Inside max-w-6xl that is ~178px per
        // column against the old ~217px — tighter, but a board split over two
        // rows stops reading as a pipeline, which is worse.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {STATUS_COLUMNS.map((status) => (
            <div key={status}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs uppercase tracking-widest text-slate-500">
                  {statusLabel(status)}
                </h2>
                <span className={`${PILL_SM} bg-slate-100 text-slate-500`}>
                  {grouped[status]?.length || 0}
                </span>
              </div>
              <div className="space-y-3">
                {grouped[status]?.map((campaign) => (
                  <Link
                    key={campaign.id}
                    href={`/clients/${clientId}/campaigns/${campaign.id}`}
                    className={`group block ${surface.cardHover} p-4`}
                  >
                    <span
                      className={`${PILL_SM} ${statusColor(campaign.status)} mb-2`}
                    >
                      {statusLabel(campaign.status)}
                    </span>
                    <p className="text-sm font-medium text-slate-800 group-hover:text-teal-700 transition-colors">
                      {campaign.title}
                    </p>
                    {campaign.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {campaign.description}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-2">
                      {new Date(campaign.created_at).toLocaleDateString()}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate campaign ideas</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Textarea
                label="Prompt (optional)"
                className="h-24"
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                placeholder="e.g. 'Campaigns for Q2 product launch', or leave empty for general ideas"
              />
            </div>
            <Button
              variant="primary"
              size="md"
              fullWidth
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating
                ? "Generating ideas… (30-60s)"
                : "Generate 3 campaign proposals"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Input
                label="Title"
                size="sm"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Campaign name"
              />
            </div>
            <div>
              <Textarea
                label="Description"
                className="h-20"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What is this campaign about?"
              />
            </div>
            <Button
              variant="primary"
              size="md"
              fullWidth
              onClick={handleCreate}
              disabled={!newTitle.trim()}
            >
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
