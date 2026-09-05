"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditableList } from "@/components/shared/editable-list";
import { getClient, getStrategy, updateStrategy } from "@/lib/api";
import type { Strategy } from "@/lib/types";
import { CONTENT_TYPES } from "@/lib/constants";
import { CHANNELS } from "@/lib/marketing/posting-windows";

// The Strategy fields that hold a nested object. Naming them lets updateNested
// index Strategy directly instead of casting it to a record it isn't.
type NestedField =
  | "icp"
  | "voice"
  | "positioning"
  | "messaging"
  | "goals"
  | "content_quota";

export default function StrategyPage() {
  const { clientId } = useParams() as { clientId: string };
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // A client with no strategy yet is the normal starting state, not a
    // failure: GET answers 404 until the first save. Onboarding used to fill
    // this in and was never ported, so the editor scaffolds a blank strategy
    // and PUT (an upsert) creates it on first save. Any other error is real
    // and gets shown.
    getStrategy(clientId)
      .then((s) => {
        if (!cancelled) setStrategy(s);
      })
      .catch(async (e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        if (!message.includes("404")) {
          setError(message);
          return;
        }
        // business_name is the one field the API requires to create.
        const name = await getClient(clientId)
          .then((c) => c.name)
          .catch(() => "");
        if (cancelled) return;
        setIsNew(true);
        setStrategy({
          client_id: clientId,
          business_name: name,
          icp: {},
          voice: {},
          positioning: {},
          messaging: {},
          goals: {},
          content_strategy: {},
          content_quota: { weekly: {}, rationale: "" },
          updated_at: "",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const update = (field: string, value: unknown) => {
    if (!strategy) return;
    setStrategy({ ...strategy, [field]: value });
    setSaved(false);
  };

  const updateNested = (field: NestedField, key: string, value: unknown) => {
    if (!strategy) return;
    const current = strategy[field] ?? {};
    setStrategy({ ...strategy, [field]: { ...current, [key]: value } });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!strategy) return;
    setSaving(true);
    setError(null);
    try {
      const { client_id, updated_at, ...data } = strategy;
      void client_id;
      void updated_at;
      setStrategy(await updateStrategy(clientId, data));
      setIsNew(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save strategy");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-zinc-500">Loading...</p>;
  if (!strategy)
    return (
      <p className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error ?? "Could not load the strategy."}
      </p>
    );

  const icp = (strategy.icp || {}) as Record<string, unknown>;
  const voice = (strategy.voice || {}) as Record<string, unknown>;
  const positioning = (strategy.positioning || {}) as Record<string, unknown>;
  const messaging = (strategy.messaging || {}) as Record<string, unknown>;
  const goals = (strategy.goals || {}) as Record<string, unknown>;
  const contentQuota = strategy.content_quota || { weekly: {} };
  const quotaRationale = contentQuota.rationale || "";
  const weeklyObj = contentQuota.weekly || {};
  const quotaRows = Object.entries(weeklyObj).map(([type, entry]) => ({
    type,
    count: entry.count,
    channels: entry.channels ?? [],
  }));
  const demographics = (icp.demographics || {}) as Record<string, string>;
  const primaryAngle = (positioning.primary_angle || {}) as Record<string, string>;
  const secondaryAngles = (positioning.secondary_angles || []) as Record<string, string>[];
  const contentStrategy = (strategy.content_strategy || {}) as Record<string, unknown>;

  // Rebuild the whole weekly map from the edited rows. Spreading contentQuota
  // preserves `rationale`.
  const saveQuotaRows = (rows: typeof quotaRows) => {
    update("content_quota", {
      ...contentQuota,
      weekly: Object.fromEntries(
        rows.map((r) => [r.type, { count: r.count, channels: r.channels }])
      ),
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Strategy Editor</h1>
          <p className="text-zinc-500 text-sm">{strategy.business_name}</p>
        </div>
        <Button onClick={handleSave} disabled={saving || saved}>
          {saving
            ? "Saving..."
            : saved
              ? "Saved"
              : isNew
                ? "Create Strategy"
                : "Save Changes"}
        </Button>
      </div>

      {isNew && (
        <p className="mb-6 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No strategy saved for this client yet. Fill in what you have — the
          planner only needs a <strong>weekly quota</strong> under Content to
          produce a schedule — then save to create it.
        </p>
      )}

      {error && (
        <p className="mb-6 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <Tabs defaultValue="icp">
        <TabsList className="mb-4">
          <TabsTrigger value="icp">ICP</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="positioning">Positioning</TabsTrigger>
          <TabsTrigger value="messaging">Messaging</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="quota">Content Quota</TabsTrigger>
        </TabsList>

        {/* ICP */}
        <TabsContent value="icp">
          <div className="grid gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Business Name</CardTitle></CardHeader>
              <CardContent>
                <Input
                  value={strategy.business_name}
                  onChange={(e) => update("business_name", e.target.value)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Description</CardTitle></CardHeader>
              <CardContent>
                <Textarea
                  value={(icp.description as string) || ""}
                  onChange={(e) => updateNested("icp", "description", e.target.value)}
                  className="h-20"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Demographics</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {["industry", "company_size", "role", "revenue_range"].map((key) => (
                  <div key={key}>
                    <label className="text-xs text-zinc-500 capitalize">{key.replace(/_/g, " ")}</label>
                    <Input
                      value={demographics[key] || ""}
                      onChange={(e) =>
                        updateNested("icp", "demographics", { ...demographics, [key]: e.target.value })
                      }
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Pain Points</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(icp.pain_points as string[]) || []}
                  onChange={(items) => updateNested("icp", "pain_points", items)}
                  placeholder="Add pain point..."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Goals</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(icp.goals as string[]) || []}
                  onChange={(items) => updateNested("icp", "goals", items)}
                  placeholder="Add goal..."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Objections</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(icp.objections as string[]) || []}
                  onChange={(items) => updateNested("icp", "objections", items)}
                  placeholder="Add objection..."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Trigger Events</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(icp.trigger_events as string[]) || []}
                  onChange={(items) => updateNested("icp", "trigger_events", items)}
                  placeholder="Add trigger event..."
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Voice */}
        <TabsContent value="voice">
          <div className="grid gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Personality</CardTitle></CardHeader>
              <CardContent>
                <Textarea
                  value={(voice.personality as string) || ""}
                  onChange={(e) => updateNested("voice", "personality", e.target.value)}
                  className="h-20"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Traits</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(voice.traits as string[]) || []}
                  onChange={(items) => updateNested("voice", "traits", items)}
                  placeholder="Add trait..."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Tone</CardTitle></CardHeader>
              <CardContent>
                <Input
                  value={(voice.tone as string) || ""}
                  onChange={(e) => updateNested("voice", "tone", e.target.value)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Communication Style</CardTitle></CardHeader>
              <CardContent>
                <Input
                  value={(voice.communication_style as string) || ""}
                  onChange={(e) => updateNested("voice", "communication_style", e.target.value)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Words to Use</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(voice.words_to_use as string[]) || []}
                  onChange={(items) => updateNested("voice", "words_to_use", items)}
                  placeholder="Add word..."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Words to Avoid</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(voice.words_to_avoid as string[]) || []}
                  onChange={(items) => updateNested("voice", "words_to_avoid", items)}
                  placeholder="Add word..."
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Positioning */}
        <TabsContent value="positioning">
          <div className="grid gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Primary Angle</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-500">Type</label>
                  <Input
                    value={primaryAngle.type || ""}
                    onChange={(e) =>
                      updateNested("positioning", "primary_angle", { ...primaryAngle, type: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Statement</label>
                  <Textarea
                    value={primaryAngle.statement || ""}
                    onChange={(e) =>
                      updateNested("positioning", "primary_angle", { ...primaryAngle, statement: e.target.value })
                    }
                    className="h-16"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Why this works</label>
                  <Textarea
                    value={primaryAngle.why || ""}
                    onChange={(e) =>
                      updateNested("positioning", "primary_angle", { ...primaryAngle, why: e.target.value })
                    }
                    className="h-16"
                  />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Secondary Angles</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {secondaryAngles.map((angle, i) => (
                  <div key={i} className="border rounded p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-medium">Angle {i + 1}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const updated = secondaryAngles.filter((_, j) => j !== i);
                          updateNested("positioning", "secondary_angles", updated);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                    <Input
                      placeholder="Type"
                      value={angle.type || ""}
                      onChange={(e) => {
                        const updated = [...secondaryAngles];
                        updated[i] = { ...updated[i], type: e.target.value };
                        updateNested("positioning", "secondary_angles", updated);
                      }}
                    />
                    <Input
                      placeholder="Statement"
                      value={angle.statement || ""}
                      onChange={(e) => {
                        const updated = [...secondaryAngles];
                        updated[i] = { ...updated[i], statement: e.target.value };
                        updateNested("positioning", "secondary_angles", updated);
                      }}
                    />
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateNested("positioning", "secondary_angles", [
                      ...secondaryAngles,
                      { type: "", statement: "", why: "" },
                    ])
                  }
                >
                  Add Angle
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Anti-Positioning</CardTitle></CardHeader>
              <CardContent>
                <Textarea
                  value={(positioning.anti_positioning as string) || ""}
                  onChange={(e) => updateNested("positioning", "anti_positioning", e.target.value)}
                  className="h-16"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Differentiation</CardTitle></CardHeader>
              <CardContent>
                <Textarea
                  value={(positioning.differentiation as string) || ""}
                  onChange={(e) => updateNested("positioning", "differentiation", e.target.value)}
                  className="h-16"
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Messaging */}
        <TabsContent value="messaging">
          <div className="grid gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Tagline</CardTitle></CardHeader>
              <CardContent>
                <Input
                  value={(messaging.tagline as string) || ""}
                  onChange={(e) => updateNested("messaging", "tagline", e.target.value)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Value Props</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(messaging.value_props as string[]) || []}
                  onChange={(items) => updateNested("messaging", "value_props", items)}
                  placeholder="Add value prop..."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Key Messages</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(messaging.key_messages as string[]) || []}
                  onChange={(items) => updateNested("messaging", "key_messages", items)}
                  placeholder="Add key message..."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Proof Points</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(messaging.proof_points as string[]) || []}
                  onChange={(items) => updateNested("messaging", "proof_points", items)}
                  placeholder="Add proof point..."
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Goals */}
        <TabsContent value="goals">
          <div className="grid gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Primary Goal</CardTitle></CardHeader>
              <CardContent>
                <Input
                  value={(goals.primary as string) || ""}
                  onChange={(e) => updateNested("goals", "primary", e.target.value)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Secondary Goal</CardTitle></CardHeader>
              <CardContent>
                <Input
                  value={(goals.secondary as string) || ""}
                  onChange={(e) => updateNested("goals", "secondary", e.target.value)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">90-Day Focus</CardTitle></CardHeader>
              <CardContent>
                <Textarea
                  value={(goals["90_day_focus"] as string) || ""}
                  onChange={(e) => updateNested("goals", "90_day_focus", e.target.value)}
                  className="h-16"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Metrics</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(goals.metrics as string[]) || []}
                  onChange={(items) => updateNested("goals", "metrics", items)}
                  placeholder="Add metric..."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Content Platforms</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(contentStrategy.platforms as string[]) || []}
                  onChange={(items) =>
                    updateNested("goals", "content_strategy", { ...contentStrategy, platforms: items })
                  }
                  placeholder="Add platform..."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Content Pillars</CardTitle></CardHeader>
              <CardContent>
                <EditableList
                  items={(contentStrategy.content_pillars as string[]) || []}
                  onChange={(items) =>
                    updateNested("goals", "content_strategy", { ...contentStrategy, content_pillars: items })
                  }
                  placeholder="Add pillar..."
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        {/* Content Quota */}
        <TabsContent value="quota">
          <div className="grid gap-4">
            {quotaRationale && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Recommendation</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-zinc-600">{quotaRationale}</p>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Weekly Content Budget</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-zinc-500">
                  How much of each content type to publish per week, and which
                  channels it may go out on. The planner uses this to find gaps
                  in the calendar and decide where each piece belongs.
                </p>
                {quotaRows.map((row, i) => (
                  <div key={row.type} className="border rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium w-24 capitalize">{row.type.replace(/_/g, " ")}</span>
                      <Input
                        type="number"
                        min={0}
                        value={row.count}
                        onChange={(e) => {
                          const updated = [...quotaRows];
                          updated[i] = { ...updated[i], count: parseInt(e.target.value) || 0 };
                          saveQuotaRows(updated);
                        }}
                        className="w-20"
                      />
                      <span className="text-sm text-zinc-500">/ week</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() => saveQuotaRows(quotaRows.filter((_, j) => j !== i))}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-zinc-500">Channels:</span>
                      {CHANNELS.map((channel) => {
                        const selected = row.channels.includes(channel);
                        return (
                          <Button
                            key={channel}
                            variant={selected ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                              const channels = selected
                                ? row.channels.filter((ch) => ch !== channel)
                                : [...row.channels, channel];
                              const updated = [...quotaRows];
                              updated[i] = { ...updated[i], channels };
                              saveQuotaRows(updated);
                            }}
                          >
                            {channel}
                          </Button>
                        );
                      })}
                      {row.channels.length === 0 && (
                        <span className="text-xs text-amber-600">
                          Pick at least one, or the planner cannot place these.
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {(() => {
                  const usedTypes = quotaRows.map((r) => r.type);
                  const availableTypes = CONTENT_TYPES.filter((t) => !usedTypes.includes(t));
                  if (availableTypes.length === 0) return null;
                  return (
                    <div className="flex gap-2 pt-2">
                      <span className="text-sm text-zinc-500 self-center">Add:</span>
                      {availableTypes.map((type) => (
                        <Button
                          key={type}
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            saveQuotaRows([...quotaRows, { type, count: 1, channels: [] }])
                          }
                        >
                          + {type.replace(/_/g, " ")}
                        </Button>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
