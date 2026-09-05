"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RatingStars } from "@/components/shared/rating-stars";
import { CopyButton } from "@/components/shared/copy-button";
import { listAssets, deleteAsset, createAsset, updateAsset, listCampaigns, generateAsset } from "@/lib/api";
import { PLATFORM_FORMATS, getAssetText } from "@/lib/platform-formatter";
import type { SavedAsset, CampaignListItem, Asset } from "@/lib/types";

const ASSET_TYPES = ["all", "post", "post_alt", "hook_a", "hook_b", "cta"];
const CREATABLE_TYPES = ASSET_TYPES.filter((t) => t !== "all");

const TYPE_BADGE_COLORS: Record<string, string> = {
  post: "bg-blue-100 text-blue-800",
  hook_a: "bg-amber-100 text-amber-800",
  hook_b: "bg-amber-100 text-amber-800",
  cta: "bg-green-100 text-green-800",
  campaign_idea: "bg-purple-100 text-purple-800",
  recommended_action: "bg-zinc-100 text-zinc-800",
};

export default function AssetsPage() {
  const { clientId } = useParams() as { clientId: string };
  const [assets, setAssets] = useState<SavedAsset[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("any");

  // Detail/Edit modal
  const [selected, setSelected] = useState<SavedAsset | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editType, setEditType] = useState("");
  const [editRating, setEditRating] = useState(0);
  const [saving, setSaving] = useState(false);

  // Create modal
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState<"input" | "review">("input");
  const [newType, setNewType] = useState("post");
  const [newBrief, setNewBrief] = useState("");
  const [newCampaignId, setNewCampaignId] = useState("none");
  const [newContent, setNewContent] = useState("");
  const [generating, setGenerating] = useState(false);

  const fetchData = async () => {
    try {
      const [assetsData, campaignsData] = await Promise.all([
        listAssets(clientId, { limit: 100 }),
        listCampaigns(clientId),
      ]);
      setAssets(assetsData);
      setCampaigns(campaignsData);
    } catch (e) {
      console.error("Failed to fetch:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  const getContentText = (asset: SavedAsset): string => {
    const content = asset.content;
    if (typeof content === "string") return content;
    if (content?.content && typeof content.content === "string") return content.content;
    if (content?.content && Array.isArray(content.content)) {
      return content.content.map((s: Record<string, unknown>) => s.text || "").join(" → ");
    }
    return JSON.stringify(content).slice(0, 300);
  };

  const getEditableContent = (asset: SavedAsset): string => {
    const content = asset.content;
    if (content?.content && typeof content.content === "string") return content.content;
    return JSON.stringify(content, null, 2);
  };

  // Apply all filters
  const filtered = assets.filter((a) => {
    if (typeFilter !== "all" && a.type !== typeFilter) return false;
    if (campaignFilter === "none" && a.campaign_id) return false;
    if (campaignFilter !== "all" && campaignFilter !== "none" && a.campaign_id !== campaignFilter) return false;
    if (ratingFilter !== "any" && (!a.rating || a.rating < parseInt(ratingFilter))) return false;
    return true;
  });

  const handleSelect = (asset: SavedAsset) => {
    setSelected(asset);
    setEditing(false);
    setEditContent(getEditableContent(asset));
    setEditType(asset.type);
    setEditRating(asset.rating || 0);
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      let contentObj: Record<string, unknown>;
      try {
        contentObj = JSON.parse(editContent);
      } catch {
        contentObj = { ...selected.content, content: editContent };
      }
      const updated = await updateAsset(clientId, selected.id, {
        type: editType !== selected.type ? editType : undefined,
        content: contentObj,
        rating: editRating || undefined,
      });
      setAssets(assets.map((a) => (a.id === updated.id ? updated : a)));
      setSelected(updated);
      setEditing(false);
    } catch (e) {
      console.error("Failed to update:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAsset(clientId, id);
      setAssets(assets.filter((a) => a.id !== id));
      setSelected(null);
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  };

  const handleGenerate = async () => {
    if (!newBrief.trim()) return;
    setGenerating(true);
    try {
      const result = await generateAsset(clientId, {
        type: newType,
        brief: newBrief,
        campaign_id: newCampaignId !== "none" ? newCampaignId : undefined,
      });
      setNewContent(result.content);
      setCreateStep("review");
    } catch (e) {
      console.error("Failed to generate:", e);
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveNew = async () => {
    if (!newContent.trim()) return;
    setSaving(true);
    try {
      const asset = await createAsset(clientId, {
        type: newType,
        content: { content: newContent },
        campaign_id: newCampaignId !== "none" ? newCampaignId : undefined,
      });
      setAssets([asset, ...assets]);
      setCreating(false);
      setCreateStep("input");
      setNewBrief("");
      setNewContent("");
      setNewCampaignId("none");
    } catch (e) {
      console.error("Failed to save:", e);
    } finally {
      setSaving(false);
    }
  };

  // Unique campaign IDs in assets for filter dropdown
  const assetCampaignIds = [...new Set(assets.map((a) => a.campaign_id).filter(Boolean))];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Asset Library</h1>
          <p className="text-zinc-500 text-sm">
            {filtered.length} of {assets.length} assets
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Create Asset</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <Select value={campaignFilter} onValueChange={setCampaignFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Campaign" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All campaigns</SelectItem>
            <SelectItem value="none">Uncategorized</SelectItem>
            {assetCampaignIds.map((cid) => (
              <SelectItem key={cid!} value={cid!}>
                {campaignMap.get(cid!)?.title || cid!.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            {ASSET_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t === "all" ? "All types" : t.replace(/_/g, " ").toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ratingFilter} onValueChange={setRatingFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Rating" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any rating</SelectItem>
            <SelectItem value="3">3+ stars</SelectItem>
            <SelectItem value="4">4+ stars</SelectItem>
            <SelectItem value="5">5 stars</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-zinc-500 text-sm py-8 text-center">
          No assets match your filters.
        </p>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Type</TableHead>
                <TableHead>Content</TableHead>
                <TableHead className="w-48">Campaign</TableHead>
                <TableHead className="w-28">Rating</TableHead>
                <TableHead className="w-32">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((asset) => (
                <TableRow
                  key={asset.id}
                  className="cursor-pointer hover:bg-zinc-50"
                  onClick={() => handleSelect(asset)}
                >
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${TYPE_BADGE_COLORS[asset.type] || ""}`}
                    >
                      {asset.type.replace(/_/g, " ").toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md">
                    <p className="text-sm text-zinc-700 truncate">
                      {getContentText(asset).slice(0, 120)}
                    </p>
                  </TableCell>
                  <TableCell>
                    {asset.campaign_id ? (
                      <Link
                        href={`/clients/${clientId}/campaigns/${asset.campaign_id}`}
                        className="text-xs text-blue-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {campaignMap.get(asset.campaign_id)?.title || "Unknown"}
                      </Link>
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {asset.rating ? (
                      <RatingStars value={asset.rating} readonly />
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500">
                    {new Date(asset.saved_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail / Edit modal */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {editing ? (
                    <Select value={editType} onValueChange={setEditType}>
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CREATABLE_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.replace(/_/g, " ").toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className={TYPE_BADGE_COLORS[selected.type] || ""}>
                      {selected.type.replace(/_/g, " ").toUpperCase()}
                    </Badge>
                  )}
                  <RatingStars
                    value={editing ? editRating : (selected.rating || 0)}
                    onChange={editing ? setEditRating : undefined}
                    readonly={!editing}
                  />
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {editing ? (
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="min-h-[200px] font-mono text-sm"
                  />
                ) : (
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">
                    {getContentText(selected)}
                  </div>
                )}

                {!editing && selected.content?.rationale && (
                  <div className="bg-zinc-50 p-3 rounded text-xs space-y-1">
                    {(selected.content.rationale as Record<string, string>)?.why_this_post && (
                      <p>
                        <span className="font-semibold">WHY:</span>{" "}
                        {(selected.content.rationale as Record<string, string>).why_this_post}
                      </p>
                    )}
                    {(selected.content.rationale as Record<string, string>)?.why_this_format && (
                      <p>
                        <span className="font-semibold">FORMAT:</span>{" "}
                        {(selected.content.rationale as Record<string, string>).why_this_format}
                      </p>
                    )}
                    {(selected.content.rationale as Record<string, string>)?.expected_outcome && (
                      <p>
                        <span className="font-semibold">EXPECTED:</span>{" "}
                        {(selected.content.rationale as Record<string, string>).expected_outcome}
                      </p>
                    )}
                  </div>
                )}

                {/* Platform copy buttons */}
                {!editing && (
                  <div className="border-t pt-3">
                    <p className="text-xs text-zinc-500 mb-2">Copy as:</p>
                    <div className="flex flex-wrap gap-1">
                      {PLATFORM_FORMATS.map((pf) => (
                        <CopyButton
                          key={pf.label}
                          text={pf.format(selected as unknown as Asset)}
                          label={pf.label}
                          variant="secondary"
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t">
                  <div className="text-xs text-zinc-400 space-y-0.5">
                    <p>Saved {new Date(selected.saved_at).toLocaleString()}</p>
                    {selected.run_id && <p>Run: {selected.run_id.slice(0, 8)}...</p>}
                    {selected.campaign_id && (
                      <p>Campaign: {campaignMap.get(selected.campaign_id)?.title || selected.campaign_id.slice(0, 8)}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {editing ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={handleSaveEdit} disabled={saving}>
                          {saving ? "Saving..." : "Save"}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(selected.id)}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create modal — AI-assisted */}
      <Dialog open={creating} onOpenChange={(open) => {
        setCreating(open);
        if (!open) { setCreateStep("input"); setNewBrief(""); setNewContent(""); setNewCampaignId("none"); }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {createStep === "input" ? "Create Asset" : "Review & Save"}
            </DialogTitle>
          </DialogHeader>

          {createStep === "input" ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-500">Type</label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATABLE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.replace(/_/g, " ").toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-zinc-500">Campaign (suggested)</label>
                <Select value={newCampaignId} onValueChange={setNewCampaignId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No campaign</SelectItem>
                    {campaigns
                      .filter((c) => c.status === "active" || c.status === "in_review" || c.status === "proposal")
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.title}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-zinc-500">Brief — what should this be about?</label>
                <Textarea
                  value={newBrief}
                  onChange={(e) => setNewBrief(e.target.value)}
                  placeholder="e.g., Write about why compliance automation matters for fire alarm contractors"
                  className="min-h-[120px]"
                />
              </div>
              <Button onClick={handleGenerate} disabled={generating || !newBrief.trim()} className="w-full">
                {generating ? "Generating..." : "Generate with AI"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Badge variant="outline">{newType.replace(/_/g, " ").toUpperCase()}</Badge>
                {newCampaignId !== "none" && (
                  <span>for {campaigns.find((c) => c.id === newCampaignId)?.title}</span>
                )}
              </div>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="min-h-[200px] text-sm"
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setCreateStep("input")} className="flex-1">
                  Back
                </Button>
                <Button variant="outline" onClick={handleGenerate} disabled={generating} className="flex-1">
                  {generating ? "Regenerating..." : "Regenerate"}
                </Button>
                <Button onClick={handleSaveNew} disabled={saving || !newContent.trim()} className="flex-1">
                  {saving ? "Saving..." : "Save Asset"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
