"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listCampaigns, generateCampaigns, createCampaign } from "@/lib/api";
import type { CampaignListItem } from "@/lib/types";

const STATUS_COLUMNS = ["proposal", "in_review", "active", "completed", "rejected"] as const;

const STATUS_COLORS: Record<string, string> = {
  idea: "bg-zinc-100 text-zinc-800",
  proposal: "bg-blue-100 text-blue-800",
  in_review: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  completed: "bg-purple-100 text-purple-800",
  rejected: "bg-red-100 text-red-800",
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const fetchCampaigns = async () => {
    try {
      const data = await listCampaigns();
      setCampaigns(data);
    } catch (e) {
      console.error("Failed to fetch campaigns:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateCampaigns({ prompt: generatePrompt || undefined, count: 3 });
      setShowGenerate(false);
      setGeneratePrompt("");
      await fetchCampaigns();
    } catch (e) {
      console.error("Failed to generate:", e);
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      await createCampaign({ title: newTitle, description: newDescription || undefined });
      setShowCreate(false);
      setNewTitle("");
      setNewDescription("");
      await fetchCampaigns();
    } catch (e) {
      console.error("Failed to create:", e);
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
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-zinc-500 text-sm">{campaigns.length} campaigns</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowGenerate(true)}>Generate Ideas</Button>
          <Button variant="outline" onClick={() => setShowCreate(true)}>
            Create Manual
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-zinc-500 text-sm mb-4">
              No campaigns yet. Generate ideas or create one manually.
            </p>
            <Button onClick={() => setShowGenerate(true)}>Generate Campaign Ideas</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-5 gap-4">
          {STATUS_COLUMNS.map((status) => (
            <div key={status}>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold capitalize">
                  {status.replace(/_/g, " ")}
                </h3>
                <Badge variant="outline" className="text-xs">
                  {grouped[status]?.length || 0}
                </Badge>
              </div>
              <div className="space-y-3">
                {grouped[status]?.map((campaign) => (
                  <Link key={campaign.id} href={`/campaigns/${campaign.id}`}>
                    <Card className="cursor-pointer hover:border-zinc-400 transition-colors mb-3">
                      <CardContent className="pt-4 pb-3">
                        <Badge
                          variant="outline"
                          className={`text-xs mb-2 ${STATUS_COLORS[campaign.status] || ""}`}
                        >
                          {campaign.status.replace(/_/g, " ")}
                        </Badge>
                        <p className="text-sm font-medium">{campaign.title}</p>
                        {campaign.description && (
                          <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
                            {campaign.description}
                          </p>
                        )}
                        <p className="text-xs text-zinc-400 mt-2">
                          {new Date(campaign.created_at).toLocaleDateString()}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Generate Ideas Dialog */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Campaign Ideas</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-500">Prompt (optional)</label>
              <Textarea
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                placeholder="e.g., 'Campaigns for Q2 product launch' or leave empty for general ideas"
                className="h-24"
              />
            </div>
            <Button onClick={handleGenerate} disabled={generating} className="w-full">
              {generating ? "Generating ideas... (30-60s)" : "Generate 3 Campaign Proposals"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Manual Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-500">Title</label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Campaign name"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Description</label>
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What is this campaign about?"
                className="h-20"
              />
            </div>
            <Button onClick={handleCreate} disabled={!newTitle.trim()} className="w-full">
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
