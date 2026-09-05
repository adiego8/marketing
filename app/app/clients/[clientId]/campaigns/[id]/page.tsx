"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Tabs, TabPanel } from "@/components/shared/tabs";
import { banner, btn, field, surface, table, text } from "@/lib/ui";
import { PILL, statusColor, statusLabel } from "@/lib/ui-status";
import {
  getCampaign,
  improveCampaign,
  reviewCampaign,
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

const CAMPAIGN_TABS = [
  { value: "strategy", label: "Strategy" },
  { value: "content", label: "Content plan" },
  { value: "review", label: "Review & improve" },
];

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
  const [tab, setTab] = useState("strategy");

  useEffect(() => {
    Promise.all([
      getCampaign(clientId, campaignId),
      // Assets are not ported yet, so this endpoint still proxies to the old
      // backend. Its own catch keeps one dead call from failing the whole
      // Promise.all and blanking a campaign that loaded fine.
      listAssets(clientId, { campaign_id: campaignId, limit: 100 }).catch(() => []),
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

  if (loading) return <p className={text.muted}>Loading…</p>;
  if (!campaign) return <p className={banner.error}>Campaign not found.</p>;

  const strategy = campaign.strategy || {};
  const contentPlan = campaign.content_plan || {};
  const isActionable = ["proposal", "in_review"].includes(campaign.status);

  return (
    <div className="max-w-4xl">
      <Link
        href={`/clients/${clientId}/campaigns`}
        className="text-sm text-slate-500 hover:text-teal-700 transition-colors mb-3 inline-block"
      >
        ← Back to campaigns
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className={text.h1}>{campaign.title}</h1>
            <span className={`${PILL} ${statusColor(campaign.status)}`}>
              {statusLabel(campaign.status)}
            </span>
          </div>
          {campaign.description && (
            <p className="text-slate-600">{campaign.description}</p>
          )}
          <p className="text-xs text-slate-400 mt-1">
            Created {new Date(campaign.created_at).toLocaleDateString()}
            {campaign.start_date && ` · Starts ${campaign.start_date}`}
            {campaign.end_date && ` · Ends ${campaign.end_date}`}
          </p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "active" && (
            <>
              {/* Replaces the old "Generate Content" run trigger. An active
                  campaign is scheduled by the planner, which draws from it to
                  fill the weekly quota — there is no per-campaign generate. */}
              <button
                onClick={handleComplete}
                disabled={actionLoading}
                className={btn.outline}
              >
                Mark complete
              </button>
              <Link href={`/clients/${clientId}/plan`} className={btn.primarySm}>
                Plan content
              </Link>
            </>
          )}
          <button onClick={handleDelete} className={btn.danger}>
            Delete
          </button>
        </div>
      </div>

      <Tabs
        tabs={CAMPAIGN_TABS}
        value={tab}
        onChange={setTab}
        label="Campaign sections"
        className="mb-4"
      />

      <TabPanel value="strategy" active={tab === "strategy"}>
        <div className="grid gap-4">
          {Object.entries(strategy).map(([key, value]) => (
            <section key={key} className={`${surface.card} ${surface.pad}`}>
              <h2 className={`${text.cardTitle} mb-3 capitalize`}>
                {key.replace(/_/g, " ")}
              </h2>
              {Array.isArray(value) ? (
                <div className="flex flex-wrap gap-2">
                  {value.map((v, i) => (
                    <span
                      key={i}
                      className={`${PILL} bg-slate-100 text-slate-600`}
                    >
                      {String(v)}
                    </span>
                  ))}
                </div>
              ) : typeof value === "object" ? (
                <pre className={`${surface.inset} text-xs whitespace-pre-wrap font-mono`}>
                  {JSON.stringify(value, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-slate-700">{String(value)}</p>
              )}
            </section>
          ))}
          {Object.keys(strategy).length === 0 && (
            <div className={surface.empty}>
              <p className="text-slate-700 text-lg">No strategy details yet.</p>
            </div>
          )}
        </div>
      </TabPanel>

      <TabPanel value="content" active={tab === "content"}>
        <div className="grid gap-4">
          <section className={`${surface.card} ${surface.pad}`}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className={text.cardTitle}>Content plan</h2>
              <button
                onClick={saveContentPlan}
                disabled={planSaving || planSaved}
                className={btn.outlineSm}
              >
                {planSaving ? "Saving…" : planSaved ? "Saved" : "Save changes"}
              </button>
            </div>
            {(() => {
              const breakdown = (contentPlan.breakdown || []) as Array<
                Record<string, unknown>
              >;
              const assetsByType: Record<string, number> = {};
              campaignAssets.forEach((a) => {
                assetsByType[a.type] = (assetsByType[a.type] || 0) + 1;
              });
              const usedTypes = breakdown.map((item) => String(item.type));
              const availableTypes = CONTENT_TYPES.filter(
                (t) => !usedTypes.includes(t)
              );

              return (
                <div className="space-y-4">
                  {breakdown.length > 0 && (
                    <div className={`${surface.table} overflow-x-auto`}>
                      <table className="w-full">
                        <thead>
                          <tr className="bg-stone-50">
                            <th className={table.head}>Type</th>
                            <th className={table.head}>Planned</th>
                            <th className={table.head}>Produced</th>
                            <th className={table.head}>Remaining</th>
                            <th className={table.head}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdown.map((item, i) => {
                            const planned = Number(item.count) || 0;
                            const produced = assetsByType[String(item.type)] || 0;
                            const remaining = Math.max(0, planned - produced);
                            return (
                              <tr key={i} className={table.row}>
                                <td className={`${table.cell} font-medium capitalize`}>
                                  {String(item.type).replace(/_/g, " ")}
                                </td>
                                <td className={table.cell}>
                                  <input
                                    type="number"
                                    min={0}
                                    value={planned}
                                    onChange={(e) => {
                                      const updated = [...breakdown];
                                      updated[i] = {
                                        ...updated[i],
                                        count: parseInt(e.target.value) || 0,
                                      };
                                      updateBreakdown(updated);
                                    }}
                                    className={`${field.inputSm} w-20`}
                                  />
                                </td>
                                <td className={table.cell}>{produced}</td>
                                <td className={table.cell}>
                                  {remaining === 0 ? (
                                    <span className="text-green-700 font-medium">
                                      0 ✓
                                    </span>
                                  ) : (
                                    <span className="text-amber-700">{remaining}</span>
                                  )}
                                </td>
                                <td className={`${table.cell} text-right`}>
                                  <button
                                    className={btn.ghost}
                                    onClick={() =>
                                      updateBreakdown(
                                        breakdown.filter((_, j) => j !== i)
                                      )
                                    }
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {breakdown.length === 0 && (
                    <p className={text.muted}>
                      No content types selected. Add types below.
                    </p>
                  )}
                  {availableTypes.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-sm text-slate-500 self-center">
                        Add:
                      </span>
                      {availableTypes.map((contentType) => (
                        <button
                          key={contentType}
                          className={btn.outlineSm}
                          onClick={() =>
                            updateBreakdown([
                              ...breakdown,
                              { type: contentType, count: 1 },
                            ])
                          }
                        >
                          + {contentType.replace(/_/g, " ")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </section>

          {Object.keys(accountQuota).length > 0 && (
            <section className={`${surface.card} ${surface.pad}`}>
              <h2 className={`${text.cardTitle} mb-3`}>Account weekly quota</h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(accountQuota).map(([quotaType, entry]) => (
                  <div
                    key={quotaType}
                    className="rounded-lg bg-stone-50 border border-slate-200 px-3 py-1.5 text-sm"
                  >
                    <span className="font-semibold text-slate-800">
                      {entry.count}
                    </span>{" "}
                    <span className="text-slate-500">
                      {quotaType}
                      {entry.count !== 1 ? "s" : ""}/week
                    </span>
                    {entry.channels.length > 0 && (
                      <span className="text-slate-400 text-xs">
                        {" "}
                        · {entry.channels.join(", ")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {Array.isArray(contentPlan.timeline) &&
            contentPlan.timeline.length > 0 && (
              <section className={`${surface.card} ${surface.pad}`}>
                <h2 className={`${text.cardTitle} mb-3`}>Timeline</h2>
                <div className="space-y-2">
                  {(contentPlan.timeline as Array<Record<string, unknown>>).map(
                    (item, i) => (
                      <div key={i} className="text-sm text-slate-700">
                        <span className="font-semibold">
                          Week {String(item.week)}:
                        </span>{" "}
                        {String(item.focus)}
                      </div>
                    )
                  )}
                </div>
              </section>
            )}
        </div>
      </TabPanel>

      <TabPanel value="review" active={tab === "review"}>
        <div className="grid gap-4">
          {campaign.feedback_history.length > 0 && (
            <section className={`${surface.card} ${surface.pad}`}>
              <h2 className={`${text.cardTitle} mb-3`}>Feedback history</h2>
              <div className="space-y-3">
                {campaign.feedback_history.map((entry, i) => (
                  <div
                    key={i}
                    className="border-l-2 border-slate-200 pl-3 text-sm"
                  >
                    <p className="text-slate-600">{entry.feedback}</p>
                    {entry.changes && (
                      <p className="text-xs text-green-700 mt-1">
                        Changes: {entry.changes}
                      </p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      {entry.improved_at
                        ? `Improved ${new Date(entry.improved_at).toLocaleString()}`
                        : entry.submitted_at
                          ? `Submitted ${new Date(entry.submitted_at).toLocaleString()}`
                          : ""}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {campaign.status === "rejected" && campaign.rejection_reason && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-red-700 mb-2">
                Rejection reason
              </h2>
              <p className="text-sm text-red-600">{campaign.rejection_reason}</p>
            </section>
          )}

          {isActionable && (
            <>
              <section className={`${surface.card} ${surface.pad}`}>
                <h2 className={`${text.cardTitle} mb-3`}>Feedback</h2>
                <div className="space-y-3">
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What should be improved? Be specific…"
                    className={`${field.textarea} h-24`}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleReview}
                      disabled={!feedback.trim()}
                      className={btn.outline}
                    >
                      Submit feedback
                    </button>
                    <button
                      onClick={handleImprove}
                      disabled={!feedback.trim() || improving}
                      className={btn.primarySm}
                    >
                      {improving ? "Improving with AI…" : "Improve with AI"}
                    </button>
                  </div>
                </div>
              </section>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleAccept}
                  disabled={actionLoading}
                  className={`${btn.primary} flex-1`}
                >
                  Accept campaign
                </button>
                <div className="flex-1 space-y-2">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Reason for rejection…"
                    className={`${field.textarea} h-16`}
                  />
                  <button
                    onClick={handleReject}
                    disabled={!rejectReason.trim() || actionLoading}
                    className={`${btn.danger} w-full`}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </TabPanel>
    </div>
  );
}
