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
import { banner, btn, field, surface, text } from "@/lib/ui";
import { PILL, PILL_SM, statusColor, statusLabel } from "@/lib/ui-status";
import type { CampaignListItem } from "@/lib/types";

const STATUS_COLUMNS = ["proposal", "in_review", "active", "completed", "rejected"] as const;

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
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className={text.eyebrow}>Themes</p>
          <h1 className={`${text.h1} mt-1`}>Campaigns</h1>
          <p className="text-sm text-slate-500 mt-1">
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className={btn.outline}>
            Create manual
          </button>
          <button onClick={() => setShowGenerate(true)} className={btn.primarySm}>
            Generate ideas
          </button>
        </div>
      </div>

      {error && <p className={`${banner.error} mb-4`}>{error}</p>}

      {loading ? (
        <p className={text.muted}>Loading…</p>
      ) : campaigns.length === 0 ? (
        <div className={surface.empty}>
          <p className="text-slate-700 text-lg">No campaigns yet.</p>
          <p className="text-slate-500 text-sm mt-1">
            Campaigns supply the themes the planner schedules against.
          </p>
          <button
            onClick={() => setShowGenerate(true)}
            className={`${btn.primary} mt-6`}
          >
            Generate campaign ideas
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {STATUS_COLUMNS.map((status) => (
            <div key={status}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs uppercase tracking-widest text-slate-400">
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
                    <p className="text-xs text-slate-400 mt-2">
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
              <label className={field.micro}>Prompt (optional)</label>
              <textarea
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                placeholder="e.g. 'Campaigns for Q2 product launch', or leave empty for general ideas"
                className={`${field.textarea} h-24`}
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className={`${btn.primary} w-full`}
            >
              {generating
                ? "Generating ideas… (30-60s)"
                : "Generate 3 campaign proposals"}
            </button>
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
              <label className={field.micro}>Title</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Campaign name"
                className={field.inputSm}
              />
            </div>
            <div>
              <label className={field.micro}>Description</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What is this campaign about?"
                className={`${field.textarea} h-20`}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={!newTitle.trim()}
              className={`${btn.primary} w-full`}
            >
              Create
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
