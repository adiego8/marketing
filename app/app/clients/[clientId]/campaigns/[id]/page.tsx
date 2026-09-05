"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getCampaign,
  improveCampaign,
  reviewCampaign,
  triggerRun,
  acceptCampaign,
  rejectCampaign,
  completeCampaign,
  deleteCampaign,
  updateCampaign,
  listAssets,
  getStrategy,
} from "@/lib/api";
import type { Campaign, SavedAsset, QuotaEntry } from "@/lib/types";
import { CONTENT_TYPES } from "@/lib/constants";

const STATUS_COLORS: Record<string, string> = {
  idea: "bg-zinc-100 text-zinc-800",
  proposal: "bg-blue-100 text-blue-800",
  in_review: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  completed: "bg-purple-100 text-purple-800",
  rejected: "bg-red-100 text-red-800",
};

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignAssets, setCampaignAssets] = useState<SavedAsset[]>([]);
  const [accountQuota, setAccountQuota] = useState<Record<string, QuotaEntry>>({});
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [improving, setImproving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      getCampaign(clientId, campaignId),
      listAssets(clientId, { campaign_id: campaignId, limit: 100 }),
      getStrategy(clientId).catch(() => null),
    ])
      .then(([camp, assets, strategy]) => {
        setCampaign(camp);
        setCampaignAssets(assets);
        if (strategy?.content_quota?.weekly) {
          setAccountQuota(strategy.content_quota.weekly);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [clientId, campaignId]);

  const updateBreakdown = (newBreakdown: Array<Record<string, unknown>>) => {
    if (!campaign) return;
    const newPlan = {
      ...campaign.content_plan,
      breakdown: newBreakdown,
      total_pieces: newBreakdown.reduce((sum, item) => sum + (Number(item.count) || 0), 0),
    };
    setCampaign({ ...campaign, content_plan: newPlan });
    setPlanSaved(false);
  };

  const saveContentPlan = async () => {
    if (!campaign) return;
    setPlanSaving(true);
    try {
      const updated = await updateCampaign(clientId, campaignId, { content_plan: campaign.content_plan });
      setCampaign(updated);
      setPlanSaved(true);
    } catch (e) {
      console.error("Failed to save content plan:", e);
    } finally {
      setPlanSaving(false);
    }
  };

  const handleReview = async () => {
    if (!feedback.trim()) return;
    try {
      const updated = await reviewCampaign(clientId, campaignId, feedback);
      setCampaign(updated);
      setFeedback("");
    } catch (e) {
      console.error("Failed to submit review:", e);
    }
  };

  const handleImprove = async () => {
    if (!feedback.trim()) return;
    setImproving(true);
    try {
      const updated = await improveCampaign(clientId, campaignId, feedback);
      setCampaign(updated);
      setFeedback("");
    } catch (e) {
      console.error("Failed to improve:", e);
    } finally {
      setImproving(false);
    }
  };

  const handleAccept = async () => {
    setActionLoading(true);
    try {
      const updated = await acceptCampaign(clientId, campaignId);
      setCampaign(updated);
    } catch (e) {
      console.error("Failed to accept:", e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setActionLoading(true);
    try {
      const updated = await rejectCampaign(clientId, campaignId, rejectReason);
      setCampaign(updated);
    } catch (e) {
      console.error("Failed to reject:", e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleComplete = async () => {
    setActionLoading(true);
    try {
      const updated = await completeCampaign(clientId, campaignId);
      setCampaign(updated);
    } catch (e) {
      console.error("Failed to complete:", e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteCampaign(clientId, campaignId);
      router.push(`/clients/${clientId}/campaigns`);
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  };

  if (loading) return <p className="text-zinc-500">Loading...</p>;
  if (!campaign) return <p className="text-red-500">Campaign not found</p>;

  const strategy = campaign.strategy || {};
  const contentPlan = campaign.content_plan || {};
  const isActionable = ["proposal", "in_review"].includes(campaign.status);

  return (
    <div className="max-w-4xl">
      <Link href={`/clients/${clientId}/campaigns`} className="text-sm text-zinc-500 hover:text-zinc-800 mb-2 inline-block">
        ← Back to Campaigns
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{campaign.title}</h1>
            <Badge className={STATUS_COLORS[campaign.status]}>
              {campaign.status.replace(/_/g, " ")}
            </Badge>
          </div>
          {campaign.description && (
            <p className="text-zinc-600">{campaign.description}</p>
          )}
          <p className="text-xs text-zinc-400 mt-1">
            Created {new Date(campaign.created_at).toLocaleDateString()}
            {campaign.start_date && ` | Starts ${campaign.start_date}`}
            {campaign.end_date && ` | Ends ${campaign.end_date}`}
          </p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "active" && (
            <>
              <Button
                onClick={async () => {
                  setActionLoading(true);
                  try {
                    const { run_id } = await triggerRun(clientId, "daily", campaignId);
                    router.push(`/clients/${clientId}/runs/${run_id}`);
                  } catch (e) {
                    console.error("Failed to trigger run:", e);
                  } finally {
                    setActionLoading(false);
                  }
                }}
                disabled={actionLoading}
              >
                Generate Content
              </Button>
              <Button variant="outline" onClick={handleComplete} disabled={actionLoading}>
                Mark Complete
              </Button>
            </>
          )}
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </div>

      <Tabs defaultValue="strategy">
        <TabsList className="mb-4">
          <TabsTrigger value="strategy">Strategy</TabsTrigger>
          <TabsTrigger value="content">Content Plan</TabsTrigger>
          <TabsTrigger value="review">Review & Improve</TabsTrigger>
        </TabsList>

        {/* Strategy Tab */}
        <TabsContent value="strategy">
          <div className="grid gap-4">
            {Object.entries(strategy).map(([key, value]) => (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm capitalize">{key.replace(/_/g, " ")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {Array.isArray(value) ? (
                    <div className="flex flex-wrap gap-2">
                      {value.map((v, i) => (
                        <Badge key={i} variant="outline">{String(v)}</Badge>
                      ))}
                    </div>
                  ) : typeof value === "object" ? (
                    <pre className="text-xs bg-zinc-50 p-2 rounded whitespace-pre-wrap">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-sm">{String(value)}</p>
                  )}
                </CardContent>
              </Card>
            ))}
            {Object.keys(strategy).length === 0 && (
              <p className="text-zinc-500 text-sm">No strategy details yet.</p>
            )}
          </div>
        </TabsContent>

        {/* Content Plan Tab */}
        <TabsContent value="content">
          <div className="grid gap-4">
            {/* Editable Content Plan */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Content Plan</CardTitle>
                <Button
                  size="sm"
                  onClick={saveContentPlan}
                  disabled={planSaving || planSaved}
                >
                  {planSaving ? "Saving..." : planSaved ? "Saved" : "Save Changes"}
                </Button>
              </CardHeader>
              <CardContent>
                {(() => {
                  const breakdown = (contentPlan.breakdown || []) as Array<Record<string, unknown>>;
                  const assetsByType: Record<string, number> = {};
                  campaignAssets.forEach((a) => {
                    assetsByType[a.type] = (assetsByType[a.type] || 0) + 1;
                  });
                  const usedTypes = breakdown.map((item) => String(item.type));
                  const availableTypes = CONTENT_TYPES.filter((t) => !usedTypes.includes(t));

                  return (
                    <div className="space-y-4">
                      {breakdown.length > 0 && (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-zinc-500">
                              <th className="pb-2 font-medium">Type</th>
                              <th className="pb-2 font-medium">Planned</th>
                              <th className="pb-2 font-medium">Produced</th>
                              <th className="pb-2 font-medium">Remaining</th>
                              <th className="pb-2 font-medium"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {breakdown.map((item, i) => {
                              const planned = Number(item.count) || 0;
                              const produced = assetsByType[String(item.type)] || 0;
                              const remaining = Math.max(0, planned - produced);
                              return (
                                <tr key={i} className="border-b last:border-0">
                                  <td className="py-2">
                                    <span className="font-medium capitalize">{String(item.type).replace(/_/g, " ")}</span>
                                  </td>
                                  <td className="py-2">
                                    <Input
                                      type="number"
                                      min={0}
                                      value={planned}
                                      onChange={(e) => {
                                        const updated = [...breakdown];
                                        updated[i] = { ...updated[i], count: parseInt(e.target.value) || 0 };
                                        updateBreakdown(updated);
                                      }}
                                      className="w-20 h-8"
                                    />
                                  </td>
                                  <td className="py-2">{produced}</td>
                                  <td className="py-2">
                                    {remaining === 0 ? (
                                      <span className="text-green-600 font-medium">0 ✓</span>
                                    ) : (
                                      <span className="text-amber-600">{remaining}</span>
                                    )}
                                  </td>
                                  <td className="py-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        updateBreakdown(breakdown.filter((_, j) => j !== i));
                                      }}
                                    >
                                      Remove
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                      {breakdown.length === 0 && (
                        <p className="text-zinc-500 text-sm">No content types selected. Add types below.</p>
                      )}
                      {availableTypes.length > 0 && (
                        <div className="flex gap-2">
                          <span className="text-sm text-zinc-500 self-center">Add:</span>
                          {availableTypes.map((type) => (
                            <Button
                              key={type}
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                updateBreakdown([...breakdown, { type, count: 1 }]);
                              }}
                            >
                              + {type.replace(/_/g, " ")}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Account Quota Reference */}
            {Object.keys(accountQuota).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Account Weekly Quota</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(accountQuota).map(([type, entry]) => (
                      <div key={type} className="bg-zinc-50 px-3 py-1 rounded text-sm">
                        <span className="font-semibold">{entry.count}</span>{" "}
                        <span className="text-zinc-500">
                          {type}{entry.count !== 1 ? "s" : ""}/week
                        </span>
                        {entry.channels.length > 0 && (
                          <span className="text-zinc-400 text-xs">
                            {" "}· {entry.channels.join(", ")}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {Array.isArray(contentPlan.timeline) && contentPlan.timeline.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(contentPlan.timeline as Array<Record<string, unknown>>).map(
                      (item, i) => (
                        <div key={i} className="text-sm">
                          <span className="font-semibold">Week {String(item.week)}:</span>{" "}
                          {String(item.focus)}
                        </div>
                      )
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Review Tab */}
        <TabsContent value="review">
          <div className="grid gap-4">
            {/* Feedback History */}
            {campaign.feedback_history.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Feedback History</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {campaign.feedback_history.map((entry, i) => (
                    <div key={i} className="border-l-2 border-zinc-200 pl-3 text-sm">
                      <p className="text-zinc-600">{entry.feedback}</p>
                      {entry.changes && (
                        <p className="text-xs text-green-600 mt-1">
                          Changes: {entry.changes}
                        </p>
                      )}
                      <p className="text-xs text-zinc-400 mt-1">
                        {entry.improved_at
                          ? `Improved ${new Date(entry.improved_at).toLocaleString()}`
                          : entry.submitted_at
                          ? `Submitted ${new Date(entry.submitted_at).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Rejection Reason */}
            {campaign.status === "rejected" && campaign.rejection_reason && (
              <Card className="border-red-200">
                <CardHeader>
                  <CardTitle className="text-sm text-red-700">Rejection Reason</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-red-600">{campaign.rejection_reason}</p>
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            {isActionable && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Feedback</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder="What should be improved? Be specific..."
                      className="h-24"
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={handleReview} disabled={!feedback.trim()}>
                        Submit Feedback
                      </Button>
                      <Button onClick={handleImprove} disabled={!feedback.trim() || improving}>
                        {improving ? "Improving with AI..." : "Improve with AI"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex gap-3">
                  <Button onClick={handleAccept} disabled={actionLoading} className="flex-1">
                    Accept Campaign
                  </Button>
                  <div className="flex-1 space-y-2">
                    <Textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection..."
                      className="h-16"
                    />
                    <Button
                      variant="destructive"
                      onClick={handleReject}
                      disabled={!rejectReason.trim() || actionLoading}
                      className="w-full"
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
