"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Tabs, TabPanel } from "@/components/shared/tabs";
import { EditableList } from "@/components/shared/editable-list";
import { banner, btn, field, surface, toggle, text } from "@/lib/ui";
import { getClient, getStrategy, updateStrategy } from "@/lib/api";
import type { Strategy } from "@/lib/types";
import {
  PUBLISHABLE_TYPES,
  COMPONENT_TYPES,
  contentType,
  contentTypeLabel,
  defaultChannelsFor,
  implausibleChannels,
  isRetiredType,
} from "@/lib/marketing/content-types";
import { CHANNELS, MAX_SLOTS_PER_DAY } from "@/lib/marketing/posting-windows";

// The Strategy fields that hold a nested object. Naming them lets updateNested
// index Strategy directly instead of casting it to a record it isn't.
type NestedField =
  | "icp"
  | "voice"
  | "positioning"
  | "messaging"
  | "goals"
  | "content_quota";

const STRATEGY_TABS = [
  { value: "icp", label: "ICP" },
  { value: "voice", label: "Voice" },
  { value: "positioning", label: "Positioning" },
  { value: "messaging", label: "Messaging" },
  { value: "goals", label: "Goals" },
  { value: "quota", label: "Content quota" },
];

/**
 * One labelled card. This page is ~29 of them, so the recipe lives here rather
 * than being pasted 29 times.
 */
function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${surface.card} ${surface.pad}`}>
      <h2 className={`${text.cardTitle} mb-3`}>{label}</h2>
      <div className={className}>{children}</div>
    </section>
  );
}

export default function StrategyPage() {
  const { clientId } = useParams() as { clientId: string };
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [tab, setTab] = useState("icp");
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

  if (loading) return <p className="text-slate-500">Loading...</p>;
  if (!strategy)
    return (
      <p className={banner.error}>{error ?? "Could not load the strategy."}</p>
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
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className={text.eyebrow}>Foundation</p>
          <h1 className={`${text.h1} mt-1`}>Strategy</h1>
          <p className="text-sm text-slate-500 mt-1">{strategy.business_name}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || saved}
          className={btn.primarySm}
        >
          {saving
            ? "Saving…"
            : saved
              ? "Saved"
              : isNew
                ? "Create strategy"
                : "Save changes"}
        </button>
      </div>

      {isNew && (
        <p className={`${banner.warn} mb-6`}>
          No strategy saved for this client yet. Fill in what you have — the
          planner only needs a <strong>weekly quota</strong> under Content to
          produce a schedule — then save to create it.
        </p>
      )}

      {error && (
        <p className={`${banner.error} mb-6`}>{error}</p>
      )}

      <Tabs
        tabs={STRATEGY_TABS}
        value={tab}
        onChange={setTab}
        label="Strategy sections"
        className="mb-4"
      />

        {/* ICP */}
        <TabPanel value="icp" active={tab === "icp"}>
          <div className="grid gap-4">
            <Field label="Business Name">
                <input className={field.inputSm}
                  value={strategy.business_name}
                  onChange={(e) => update("business_name", e.target.value)}
                />
              </Field>
            <Field label="Description">
                <textarea
                  value={(icp.description as string) || ""}
                  onChange={(e) => updateNested("icp", "description", e.target.value)}
                  className={`${field.textarea} h-20`}
                />
              </Field>
            <Field label="Demographics" className="grid grid-cols-2 gap-3">
                {["industry", "company_size", "role", "revenue_range"].map((key) => (
                  <div key={key}>
                    <label className={`${field.micro} capitalize`}>{key.replace(/_/g, " ")}</label>
                    <input className={field.inputSm}
                      value={demographics[key] || ""}
                      onChange={(e) =>
                        updateNested("icp", "demographics", { ...demographics, [key]: e.target.value })
                      }
                    />
                  </div>
                ))}
              </Field>
            <Field label="Pain Points">
                <EditableList
                  items={(icp.pain_points as string[]) || []}
                  onChange={(items) => updateNested("icp", "pain_points", items)}
                  placeholder="Add pain point..."
                />
              </Field>
            <Field label="Goals">
                <EditableList
                  items={(icp.goals as string[]) || []}
                  onChange={(items) => updateNested("icp", "goals", items)}
                  placeholder="Add goal..."
                />
              </Field>
            <Field label="Objections">
                <EditableList
                  items={(icp.objections as string[]) || []}
                  onChange={(items) => updateNested("icp", "objections", items)}
                  placeholder="Add objection..."
                />
              </Field>
            <Field label="Trigger Events">
                <EditableList
                  items={(icp.trigger_events as string[]) || []}
                  onChange={(items) => updateNested("icp", "trigger_events", items)}
                  placeholder="Add trigger event..."
                />
              </Field>
          </div>
        </TabPanel>

        {/* Voice */}
        <TabPanel value="voice" active={tab === "voice"}>
          <div className="grid gap-4">
            <Field label="Personality">
                <textarea
                  value={(voice.personality as string) || ""}
                  onChange={(e) => updateNested("voice", "personality", e.target.value)}
                  className={`${field.textarea} h-20`}
                />
              </Field>
            <Field label="Traits">
                <EditableList
                  items={(voice.traits as string[]) || []}
                  onChange={(items) => updateNested("voice", "traits", items)}
                  placeholder="Add trait..."
                />
              </Field>
            <Field label="Tone">
                <input className={field.inputSm}
                  value={(voice.tone as string) || ""}
                  onChange={(e) => updateNested("voice", "tone", e.target.value)}
                />
              </Field>
            <Field label="Communication Style">
                <input className={field.inputSm}
                  value={(voice.communication_style as string) || ""}
                  onChange={(e) => updateNested("voice", "communication_style", e.target.value)}
                />
              </Field>
            <Field label="Words to Use">
                <EditableList
                  items={(voice.words_to_use as string[]) || []}
                  onChange={(items) => updateNested("voice", "words_to_use", items)}
                  placeholder="Add word..."
                />
              </Field>
            <Field label="Words to Avoid">
                <EditableList
                  items={(voice.words_to_avoid as string[]) || []}
                  onChange={(items) => updateNested("voice", "words_to_avoid", items)}
                  placeholder="Add word..."
                />
              </Field>
          </div>
        </TabPanel>

        {/* Positioning */}
        <TabPanel value="positioning" active={tab === "positioning"}>
          <div className="grid gap-4">
            <Field label="Primary Angle" className="space-y-3">
                <div>
                  <label className={field.micro}>Type</label>
                  <input className={field.inputSm}
                    value={primaryAngle.type || ""}
                    onChange={(e) =>
                      updateNested("positioning", "primary_angle", { ...primaryAngle, type: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={field.micro}>Statement</label>
                  <textarea
                    value={primaryAngle.statement || ""}
                    onChange={(e) =>
                      updateNested("positioning", "primary_angle", { ...primaryAngle, statement: e.target.value })
                    }
                    className={`${field.textarea} h-16`}
                  />
                </div>
                <div>
                  <label className={field.micro}>Why this works</label>
                  <textarea
                    value={primaryAngle.why || ""}
                    onChange={(e) =>
                      updateNested("positioning", "primary_angle", { ...primaryAngle, why: e.target.value })
                    }
                    className={`${field.textarea} h-16`}
                  />
                </div>
              </Field>
            <Field label="Secondary Angles" className="space-y-4">
                {secondaryAngles.map((angle, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Angle {i + 1}</span>
                      <button
                        className={btn.ghost}
                        onClick={() => {
                          const updated = secondaryAngles.filter((_, j) => j !== i);
                          updateNested("positioning", "secondary_angles", updated);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    <input className={field.inputSm}
                      placeholder="Type"
                      value={angle.type || ""}
                      onChange={(e) => {
                        const updated = [...secondaryAngles];
                        updated[i] = { ...updated[i], type: e.target.value };
                        updateNested("positioning", "secondary_angles", updated);
                      }}
                    />
                    <input className={field.inputSm}
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
                <button
                  className={btn.outlineSm}
                  onClick={() =>
                    updateNested("positioning", "secondary_angles", [
                      ...secondaryAngles,
                      { type: "", statement: "", why: "" },
                    ])
                  }
                >
                  Add Angle
                </button>
              </Field>
            <Field label="Anti-Positioning">
                <textarea
                  value={(positioning.anti_positioning as string) || ""}
                  onChange={(e) => updateNested("positioning", "anti_positioning", e.target.value)}
                  className={`${field.textarea} h-16`}
                />
              </Field>
            <Field label="Differentiation">
                <textarea
                  value={(positioning.differentiation as string) || ""}
                  onChange={(e) => updateNested("positioning", "differentiation", e.target.value)}
                  className={`${field.textarea} h-16`}
                />
              </Field>
          </div>
        </TabPanel>

        {/* Messaging */}
        <TabPanel value="messaging" active={tab === "messaging"}>
          <div className="grid gap-4">
            <Field label="Tagline">
                <input className={field.inputSm}
                  value={(messaging.tagline as string) || ""}
                  onChange={(e) => updateNested("messaging", "tagline", e.target.value)}
                />
              </Field>
            <Field label="Value Props">
                <EditableList
                  items={(messaging.value_props as string[]) || []}
                  onChange={(items) => updateNested("messaging", "value_props", items)}
                  placeholder="Add value prop..."
                />
              </Field>
            <Field label="Key Messages">
                <EditableList
                  items={(messaging.key_messages as string[]) || []}
                  onChange={(items) => updateNested("messaging", "key_messages", items)}
                  placeholder="Add key message..."
                />
              </Field>
            <Field label="Proof Points">
                <EditableList
                  items={(messaging.proof_points as string[]) || []}
                  onChange={(items) => updateNested("messaging", "proof_points", items)}
                  placeholder="Add proof point..."
                />
              </Field>
          </div>
        </TabPanel>

        {/* Goals */}
        <TabPanel value="goals" active={tab === "goals"}>
          <div className="grid gap-4">
            <Field label="Primary Goal">
                <input className={field.inputSm}
                  value={(goals.primary as string) || ""}
                  onChange={(e) => updateNested("goals", "primary", e.target.value)}
                />
              </Field>
            <Field label="Secondary Goal">
                <input className={field.inputSm}
                  value={(goals.secondary as string) || ""}
                  onChange={(e) => updateNested("goals", "secondary", e.target.value)}
                />
              </Field>
            <Field label="90-Day Focus">
                <textarea
                  value={(goals["90_day_focus"] as string) || ""}
                  onChange={(e) => updateNested("goals", "90_day_focus", e.target.value)}
                  className={`${field.textarea} h-16`}
                />
              </Field>
            <Field label="Metrics">
                <EditableList
                  items={(goals.metrics as string[]) || []}
                  onChange={(items) => updateNested("goals", "metrics", items)}
                  placeholder="Add metric..."
                />
              </Field>
            <Field label="Content Platforms">
                <EditableList
                  items={(contentStrategy.platforms as string[]) || []}
                  onChange={(items) =>
                    updateNested("goals", "content_strategy", { ...contentStrategy, platforms: items })
                  }
                  placeholder="Add platform..."
                />
              </Field>
            <Field label="Content Pillars">
                <EditableList
                  items={(contentStrategy.content_pillars as string[]) || []}
                  onChange={(items) =>
                    updateNested("goals", "content_strategy", { ...contentStrategy, content_pillars: items })
                  }
                  placeholder="Add pillar..."
                />
              </Field>
          </div>
        </TabPanel>
        {/* Content Quota */}
        <TabPanel value="quota" active={tab === "quota"}>
          <div className="grid gap-4">
            {quotaRationale && (
              <Field label="Recommendation">
                  <p className="text-sm text-slate-600">{quotaRationale}</p>
                </Field>
            )}
            <Field label="Weekly Content Budget" className="space-y-4">
                <p className={field.micro}>
                  How much of each content type to publish per week, and which
                  channels it may go out on. The planner uses this to find gaps
                  in the calendar and decide where each piece belongs.
                </p>
                {(() => {
                  // The assign stage never puts more than MAX_SLOTS_PER_DAY on
                  // one day, so a quota above that ceiling can never be met —
                  // it just turns every Coverage row into a permanent deficit
                  // and buries the real warnings in noise.
                  const asked = quotaRows.reduce((n, r) => n + r.count, 0);
                  const ceiling = MAX_SLOTS_PER_DAY * 7;
                  const over = asked > ceiling;
                  return (
                    <p
                      className={`text-xs ${over ? "text-amber-700" : "text-slate-500"}`}
                    >
                      {asked} piece{asked === 1 ? "" : "s"} a week across all
                      formats. The planner places at most {MAX_SLOTS_PER_DAY} a
                      day, so {ceiling} is the most it can ever schedule.
                      {over &&
                        ` Anything above ${ceiling} will show as a permanent shortfall.`}
                    </p>
                  );
                })()}
                {quotaRows.map((row, i) => (
                  <div key={row.type} className="rounded-lg border border-slate-200 p-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="w-28 shrink-0">
                        <span className="block text-sm font-medium text-slate-800">
                          {contentTypeLabel(row.type)}
                        </span>
                        {isRetiredType(row.type) ? (
                          <span className="block text-[10px] uppercase tracking-wide text-amber-700">
                            retired
                          </span>
                        ) : (
                          contentType(row.type)?.component && (
                            <span className="block text-[10px] uppercase tracking-wide text-slate-400">
                              component
                            </span>
                          )
                        )}
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={row.count}
                        onChange={(e) => {
                          const updated = [...quotaRows];
                          updated[i] = { ...updated[i], count: parseInt(e.target.value) || 0 };
                          saveQuotaRows(updated);
                        }}
                        className={`${field.inputSm} w-20`}
                      />
                      <span className="text-sm text-slate-500">/ week</span>
                      <button
                        className={`${btn.ghost} ml-auto`}
                        onClick={() => saveQuotaRows(quotaRows.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </div>
                    {contentType(row.type)?.description && (
                      <p
                        className={`text-xs ${
                          isRetiredType(row.type)
                            ? "text-amber-700"
                            : "text-slate-500"
                        }`}
                      >
                        {isRetiredType(row.type)
                          ? `${contentType(row.type)!.description} Scheduling it separately no longer adds anything — remove this row.`
                          : contentType(row.type)!.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={field.micro}>Channels:</span>
                      {CHANNELS.map((channel) => {
                        const selected = row.channels.includes(channel);
                        return (
                          <button
                            key={channel}
                            className={toggle(selected)}
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
                          </button>
                        );
                      })}
                      {row.channels.length === 0 && (
                        <span className="text-xs text-amber-700">
                          Pick at least one, or the planner cannot place these.
                        </span>
                      )}
                      {implausibleChannels(row.type, row.channels).length > 0 && (
                        // A warning, not a block: the table encodes today's
                        // platforms, and an unusual workflow should not be
                        // stopped by it.
                        <span className="text-xs text-amber-700">
                          {contentTypeLabel(row.type)} does not normally go out on{" "}
                          {implausibleChannels(row.type, row.channels).join(", ")}.
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {(() => {
                  const usedTypes = quotaRows.map((r) => r.type);
                  const add = (key: string) =>
                    saveQuotaRows([
                      ...quotaRows,
                      // Preselected from the format itself: a reel on email is
                      // not a choice worth offering by default.
                      { type: key, count: 1, channels: defaultChannelsFor(key) },
                    ]);
                  const formats = PUBLISHABLE_TYPES.filter(
                    (t) => !usedTypes.includes(t.key)
                  );
                  const components = COMPONENT_TYPES.filter(
                    (t) => !usedTypes.includes(t.key)
                  );
                  if (formats.length === 0 && components.length === 0) return null;
                  return (
                    <div className="space-y-2 pt-2">
                      {formats.length > 0 && (
                        <div className="flex gap-2 flex-wrap items-center">
                          <span className="text-sm text-slate-500">Add format:</span>
                          {formats.map((t) => (
                            <button
                              key={t.key}
                              className={btn.outlineSm}
                              title={t.description}
                              onClick={() => add(t.key)}
                            >
                              + {t.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {components.length > 0 && (
                        <div className="flex gap-2 flex-wrap items-center">
                          <span className="text-sm text-slate-400">
                            Parts of a post:
                          </span>
                          {components.map((t) => (
                            <button
                              key={t.key}
                              className={btn.outlineSm}
                              title={t.description}
                              onClick={() => add(t.key)}
                            >
                              + {t.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </Field>
          </div>
        </TabPanel>
    </div>
  );
}
