"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EditableList } from "@/components/shared/editable-list";
import { runResearch, createProfile, getClient } from "@/lib/api";
import type { Client } from "@/lib/types";

type Step = "info" | "researching" | "review" | "generating" | "done";

export default function OnboardingPage() {
  const router = useRouter();
  const { clientId } = useParams() as { clientId: string };
  const [step, setStep] = useState<Step>("info");
  const [client, setClient] = useState<Client | null>(null);

  // Step 1: Company info
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [description, setDescription] = useState("");
  const [competitors, setCompetitors] = useState<string[]>([]);

  // Step 2: Research results
  const [research, setResearch] = useState<Record<string, unknown> | null>(null);

  // Step 3: Profile
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load client on mount — if research exists, skip to review
  useEffect(() => {
    getClient(clientId).then((c) => {
      setClient(c);
      // Pre-fill form from client record
      if (c.name && c.name !== "Default Client") setCompanyName(c.name);
      if (c.website_url) setWebsiteUrl(c.website_url);

      if (c.research_status === "completed" && c.research) {
        setResearch(c.research);
        setStep("review");
      } else if (c.research_status === "researching") {
        setStep("researching");
        startPolling();
      } else if (c.research_status === "failed" && c.research) {
        setError((c.research as Record<string, string>).error || "Research failed");
      }
    });

    return () => stopPolling();
  }, [clientId]);

  const startPolling = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const c = await getClient(clientId);
        setClient(c);
        if (c.research_status === "completed" && c.research) {
          setResearch(c.research);
          setStep("review");
          stopPolling();
        } else if (c.research_status === "failed") {
          setError((c.research as Record<string, string>)?.error || "Research failed");
          setStep("info");
          stopPolling();
        }
      } catch (e) {
        console.error("Polling failed:", e);
      }
    }, 3000);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleResearch = async () => {
    setStep("researching");
    setError(null);
    try {
      await runResearch(clientId, {
        company_name: companyName,
        website_url: websiteUrl || undefined,
        description: description || undefined,
        competitors: competitors.length > 0 ? competitors : undefined,
      });
      startPolling();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start research";
      setError(msg);
      setStep("info");
    }
  };

  const handleGenerateProfile = async () => {
    if (!research) return;
    setStep("generating");
    setError(null);
    try {
      const result = await createProfile(clientId, { research });
      setProfile(result);
      setStep("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Profile generation failed";
      setError(msg);
      setStep("review");
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">Company Onboarding</h1>
      <p className="text-zinc-500 text-sm mb-6">
        Research a company, generate a marketing profile, and set it as the active strategy.
      </p>

      {/* Progress */}
      <div className="flex gap-2 mb-8">
        {(["info", "review", "done"] as const).map((s, i) => (
          <Badge
            key={s}
            variant={
              step === s || (step === "researching" && s === "info") || (step === "generating" && s === "review")
                ? "default"
                : "outline"
            }
          >
            {i + 1}. {s === "info" ? "Company Info" : s === "review" ? "Review Research" : "Profile"}
          </Badge>
        ))}
      </div>

      {/* Step 1: Company Info */}
      {step === "info" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Company Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-xs text-zinc-500">Company Name *</label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Handy Set Go"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Website URL</label>
                <Input
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://handysetgo.com"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Description</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does the company do? Who is it for? What makes it different?"
                  className="h-24"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Known Competitors</label>
                <EditableList
                  items={competitors}
                  onChange={setCompetitors}
                  placeholder="Add competitor URL or name..."
                />
              </div>
            </CardContent>
          </Card>
          {error && (
            <Card className="border-red-200">
              <CardContent className="pt-4">
                <p className="text-sm text-red-600">{error}</p>
              </CardContent>
            </Card>
          )}
          <Button
            onClick={handleResearch}
            disabled={!companyName.trim()}
            className="w-full"
          >
            Run Research
          </Button>
        </div>
      )}

      {/* Researching state */}
      {step === "researching" && (
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <div className="animate-pulse text-4xl">🔍</div>
            <p className="text-lg font-semibold">Researching...</p>
            <p className="text-sm text-zinc-500">
              Analyzing company, competitors, and market gaps. This takes 1-2 minutes.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Review Research */}
      {(step === "review" || step === "generating") && research && (
        <div className="space-y-4">
          <ResearchSection title="Company Analysis" data={research.company_analysis} />
          <ResearchSection title="Target Audience" data={research.target_audience} />
          <ResearchSection title="Competitors" data={research.competitors} />
          <ResearchSection title="Competition Gaps" data={research.competition_gaps} />
          <ResearchSection title="Product-Market Fit" data={research.product_market_fit} />
          <ResearchSection title="Recommended Positioning" data={research.recommended_positioning_angles} />

          {error && (
            <Card className="border-red-200">
              <CardContent className="pt-4">
                <p className="text-sm text-red-600">{error}</p>
              </CardContent>
            </Card>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("info")}>
              Back
            </Button>
            <Button
              onClick={handleGenerateProfile}
              disabled={step === "generating"}
              className="flex-1"
            >
              {step === "generating"
                ? "Generating profile..."
                : "Generate Marketing Profile & Save as Strategy"}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === "done" && profile && (
        <div className="space-y-4">
          <Card className="border-green-200">
            <CardContent className="pt-6 text-center space-y-3">
              <p className="text-lg font-semibold text-green-700">
                Strategy saved for {(profile as Record<string, string>).business_name}
              </p>
              <p className="text-sm text-zinc-500">
                The marketing profile has been generated and saved as the active strategy.
                All future runs will use this profile.
              </p>
            </CardContent>
          </Card>

          {/* Recommended Content Quota */}
          {(() => {
            const quota = (profile as Record<string, Record<string, unknown>>).content_quota;
            const weekly = (quota?.weekly || {}) as Record<string, number>;
            const rationale = quota?.rationale as string;
            if (Object.keys(weekly).length === 0) return null;
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Recommended Content Quota</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(weekly).map(([type, count]) => (
                      <div key={type} className="bg-zinc-50 px-3 py-2 rounded text-sm">
                        <span className="font-semibold">{count}</span>{" "}
                        <span className="text-zinc-600">{type}{count !== 1 ? "s" : ""}/week</span>
                      </div>
                    ))}
                  </div>
                  {rationale && (
                    <p className="text-xs text-zinc-500 mt-2">{rationale}</p>
                  )}
                  <p className="text-xs text-zinc-400">
                    You can adjust this in Strategy &gt; Content Quota.
                  </p>
                </CardContent>
              </Card>
            );
          })()}

          <div className="flex gap-2 justify-center">
            <Button onClick={() => router.push(`/clients/${clientId}/strategy`)}>
              View & Edit Strategy
            </Button>
            <Button variant="outline" onClick={() => router.push(`/clients/${clientId}`)}>
              Go to Dashboard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResearchSection({ title, data }: { title: string; data: unknown }) {
  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {Array.isArray(data) ? (
          <div className="space-y-2">
            {data.map((item, i) => (
              <div key={i} className="bg-zinc-50 p-3 rounded text-xs">
                {typeof item === "string" ? (
                  item
                ) : (
                  <pre className="whitespace-pre-wrap">{JSON.stringify(item, null, 2)}</pre>
                )}
              </div>
            ))}
          </div>
        ) : typeof data === "object" ? (
          <div className="space-y-1 text-sm">
            {Object.entries(data as Record<string, unknown>).map(([key, value]) => (
              <div key={key}>
                <span className="font-semibold text-xs text-zinc-500 capitalize">
                  {key.replace(/_/g, " ")}:
                </span>{" "}
                <span className="text-sm">
                  {Array.isArray(value)
                    ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")
                    : typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm">{String(data)}</p>
        )}
      </CardContent>
    </Card>
  );
}
