"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { listResearchRuns, runResearch, acceptResearch } from "@/lib/api";
import type { ResearchRun } from "@/lib/types";
import { banner, btn, field, surface, text } from "@/lib/ui";
import { CopyButton } from "@/components/shared/copy-button";
import { contentTypeLabel } from "@/lib/marketing/content-types";

// Reading a research run is the whole job of this page: the draft is a proposal
// assembled from public pages, and the point of showing the dossier and the
// sources next to it is that a person can check it before it becomes the
// strategy every campaign and every post is written from.

const STATUS_NOTE: Record<string, string> = {
  running: "Still working.",
  complete: "Both passes ran.",
  degraded: "One pass failed — read the warnings before trusting the gaps.",
  insufficient: "Nothing was found to work from.",
  failed: "It did not finish.",
};

/** How often to re-read a run that is still going. */
const POLL_MS = 4000;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${surface.card} ${surface.pad}`}>
      <h2 className={`${text.cardTitle} mb-3`}>{title}</h2>
      {children}
    </section>
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return <p className={text.muted}>Nothing found.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <li key={i} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Labelled({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className={text.micro}>{label}</p>
      <p className="text-sm text-slate-700">{value}</p>
    </div>
  );
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function ResearchPage() {
  const { clientId } = useParams() as { clientId: string };
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steer, setSteer] = useState("");
  const [namedRivals, setNamedRivals] = useState("");

  useEffect(() => {
    let cancelled = false;
    listResearchRuns(clientId)
      .then((r) => {
        if (cancelled) return;
        setRuns(r);
        // Pick up where the last run left off, so re-running means adjusting
        // the direction rather than retyping it. This is the one steer in the
        // app that is not cleared after use.
        const last = r[0];
        if (last) {
          setSteer(last.inputs.steer ?? "");
          setNamedRivals((last.inputs.competitors ?? []).join("\n"));
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load research."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const run = runs[0] ?? null;
  const inFlight = run?.status === "running";

  // Poll only while something is actually running. The work lives on the server
  // now, so this is re-attaching to it rather than waiting on a request — which
  // is why leaving the page and coming back loses nothing.
  useEffect(() => {
    if (!inFlight) return;
    let cancelled = false;
    const timer = setInterval(() => {
      listResearchRuns(clientId)
        .then((r) => !cancelled && setRuns(r))
        .catch(() => {
          // A failed poll is not worth an error banner; the next one may work.
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [clientId, inFlight]);

  const handleRun = async () => {
    setStarting(true);
    setError(null);
    setAccepted(false);
    try {
      const fresh = await runResearch(clientId, {
        steer: steer || undefined,
        competitors: namedRivals || undefined,
      });
      setRuns((prev) => [fresh, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed.");
    } finally {
      setStarting(false);
    }
  };

  const handleAccept = async () => {
    if (!run) return;
    setAccepting(true);
    setError(null);
    try {
      const { run: updated } = await acceptResearch(clientId, run.id);
      setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setAccepted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept the draft.");
    } finally {
      setAccepting(false);
    }
  };

  if (loading) return <p className="text-slate-500">Loading…</p>;

  const dossier = (run?.dossier ?? {}) as Record<string, Record<string, unknown> | unknown[]>;
  const company = (dossier.company ?? {}) as Record<string, string | string[]>;
  const audience = (dossier.audience ?? {}) as Record<string, string | string[]>;
  const evidence = (dossier.evidence ?? []) as { claim: string; source: string }[];
  const competitors = (dossier.competitors ?? []) as {
    name: string; url: string | null; positioning: string; weaknesses: string[];
  }[];
  const gaps = (dossier.gaps ?? []) as { gap: string; opportunity: string }[];
  const samples = (dossier.voice_samples ?? []) as string[];

  const draft = (run?.draft_strategy ?? {}) as Record<string, Record<string, unknown>>;
  const messaging = (draft.messaging ?? {}) as Record<string, string & string[]>;
  const positioning = (draft.positioning ?? {}) as Record<string, Record<string, string>>;
  const contentStrategy = (draft.content_strategy ?? {}) as Record<string, string[]>;
  const quota = (draft.content_quota ?? {}) as { weekly?: Record<string, { count: number }>; rationale?: string };
  const weekly = Object.entries(quota.weekly ?? {});

  return (
    <div className="max-w-4xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className={text.h1}>Research</h1>
          <p className={`${text.muted} mt-1 max-w-xl`}>
            Reads the client&apos;s website and the open web, then drafts a strategy from
            what it found. Nothing reaches the Strategy page until you accept it.
          </p>
        </div>
      </header>

      <section className={`${surface.card} ${surface.pad} space-y-3`}>
        <input
          className={field.inputSm}
          value={steer}
          onChange={(e) => setSteer(e.target.value)}
          placeholder="Optional: what to focus on — e.g. bilingual filers, and the Second Look Review as the differentiator"
        />
        <textarea
          className={`${field.textarea} h-16`}
          value={namedRivals}
          onChange={(e) => setNamedRivals(e.target.value)}
          placeholder="Optional: competitors to look at, one per line"
        />
        <p className={text.muted}>
          This points the search; it never decides what it finds. A competitor
          named here is a place to look, not a claim to repeat.
        </p>
        <button
          className={btn.primary}
          onClick={handleRun}
          disabled={starting || inFlight}
        >
          {starting
            ? "Starting…"
            : inFlight
              ? "Researching…"
              : run
                ? "Run again"
                : "Run research"}
        </button>
      </section>

      {inFlight && (
        <p className={banner.info}>
          {run?.progress ? `${run.progress}…` : "Working…"} Two web searches and
          a synthesis, usually two to three minutes. This runs on the server, so
          you can leave this page — it will still be here when you come back.
        </p>
      )}
      {error && <p className={banner.error}>{error}</p>}

      {!run && !starting && (
        <div className={surface.empty}>
          <p>No research yet.</p>
          <p className={`${text.muted} mt-1`}>
            Make sure the client has a website set, then run it.
          </p>
        </div>
      )}

      {run && (
        <>
          <div className={`${surface.card} ${surface.pad} flex flex-wrap items-center gap-x-6 gap-y-2`}>
            <div>
              <p className={text.micro}>Status</p>
              <p className="text-sm text-slate-800">
                {run.status} — {STATUS_NOTE[run.status] ?? ""}
              </p>
            </div>
            {run.progress && (
              <div>
                <p className={text.micro}>Doing</p>
                <p className="text-sm text-slate-800">{run.progress}</p>
              </div>
            )}
            <div>
              <p className={text.micro}>Ran</p>
              <p className="text-sm text-slate-800">
                {new Date(run.created_at).toLocaleString()}
              </p>
            </div>
            {run.llm && (
              <div>
                <p className={text.micro}>Cost</p>
                <p className="text-sm text-slate-800">
                  {run.llm.searches} search{run.llm.searches === 1 ? "" : "es"} ·{" "}
                  {Math.round(run.llm.duration_ms / 1000)}s · {run.llm.model}
                </p>
              </div>
            )}
            {run.accepted_at && (
              <div>
                <p className={text.micro}>Accepted</p>
                <p className="text-sm text-slate-800">
                  {new Date(run.accepted_at).toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {run.warnings.length > 0 && (
            <div className={banner.warn}>
              <ul className="space-y-1">
                {run.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {run.status !== "insufficient" && run.status !== "running" && run.status !== "failed" && (
            <>
              <Section title="What it found">
                <div className="space-y-4">
                  <Labelled label="What they do" value={String(company.description ?? "")} />
                  <Labelled label="Value proposition" value={String(company.value_proposition ?? "")} />
                  <Labelled label="How they position today" value={String(company.current_positioning ?? "")} />
                  <Labelled label="Who it is for" value={String(audience.primary ?? "")} />
                  <div>
                    <p className={text.micro}>Products and services</p>
                    <Chips items={(company.products_services as string[]) ?? []} />
                  </div>
                  <div>
                    <p className={text.micro}>Pain points</p>
                    <Chips items={(audience.pain_points as string[]) ?? []} />
                  </div>
                </div>
              </Section>

              <Section title="Evidence">
                <p className={`${text.muted} mb-3`}>
                  Claims tied to a page the search actually read. Anything that named
                  a page it had not read was dropped before you saw this — which is
                  why this list can be shorter than you expect.
                </p>
                {evidence.length === 0 ? (
                  <p className={text.muted}>Nothing verifiable was found. Ask the client.</p>
                ) : (
                  <ul className="space-y-2">
                    {evidence.map((e, i) => (
                      <li key={i} className="text-sm text-slate-700">
                        {e.claim}{" "}
                        <a
                          href={e.source}
                          target="_blank"
                          rel="noreferrer noopener"
                          className={btn.link}
                        >
                          {host(e.source)}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {competitors.length > 0 && (
                <Section title="Competitors">
                  <ul className="space-y-3">
                    {competitors.map((comp, i) => (
                      <li key={i}>
                        <p className="text-sm text-slate-800">
                          {comp.name}
                          {comp.url && (
                            <>
                              {" "}
                              <a href={comp.url} target="_blank" rel="noreferrer noopener" className={btn.link}>
                                {host(comp.url)}
                              </a>
                            </>
                          )}
                        </p>
                        {comp.positioning && <p className={text.muted}>{comp.positioning}</p>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {gaps.length > 0 && (
                <Section title="Gaps">
                  <ul className="space-y-3">
                    {gaps.map((g, i) => (
                      <li key={i}>
                        <p className="text-sm text-slate-800">{g.gap}</p>
                        {g.opportunity && <p className={text.muted}>{g.opportunity}</p>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {samples.length > 0 && (
                <Section title="How they already write">
                  <ul className="space-y-2">
                    {samples.map((s, i) => (
                      <li key={i} className="border-l-2 border-slate-200 pl-3 text-sm text-slate-700">
                        {s}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="The draft strategy">
                <div className="space-y-4">
                  <Labelled label="Tagline" value={String(messaging.tagline ?? "")} />
                  <Labelled
                    label="Primary angle"
                    value={String(positioning.primary_angle?.statement ?? "")}
                  />
                  <div>
                    <p className={text.micro}>Content pillars</p>
                    <Chips items={contentStrategy.content_pillars ?? []} />
                  </div>
                  <div>
                    <p className={text.micro}>Proof points that survived checking</p>
                    <Chips items={(messaging.proof_points as string[]) ?? []} />
                  </div>
                  {weekly.length > 0 && (
                    <div>
                      <p className={text.micro}>Suggested weekly quota</p>
                      <p className="text-sm text-slate-700">
                        {weekly.map(([key, e]) => `${e.count} × ${contentTypeLabel(key)}`).join(" · ")}
                      </p>
                      {quota.rationale && <p className={`${text.muted} mt-1`}>{quota.rationale}</p>}
                    </div>
                  )}
                </div>

                <div className="mt-5 flex items-center gap-3 border-t border-slate-200 pt-4">
                  <button
                    className={btn.primary}
                    onClick={handleAccept}
                    disabled={accepting || Boolean(run.accepted_at)}
                  >
                    {run.accepted_at
                      ? "Accepted"
                      : accepting
                        ? "Writing…"
                        : "Accept into the strategy"}
                  </button>
                  <Link href={`/clients/${clientId}/strategy`} className={btn.outline}>
                    Open Strategy
                  </Link>
                  {accepted && <span className="text-sm text-teal-700">Written.</span>}
                </div>
                <p className={`${text.muted} mt-2`}>
                  Accepting overwrites the strategy with this draft. Edit it there
                  afterwards — that is where the real work happens.
                </p>
              </Section>
            </>
          )}

          {run.open_questions.length > 0 && (
          <Section title="Ask the client">
            <div className="flex items-start justify-between gap-4">
              <p className={`${text.muted} mb-3`}>
                What research could not settle. Take these to the validation call.
              </p>
              <CopyButton
                text={run.open_questions.map((q) => `- ${q}`).join("\n")}
                label="Copy"
                variant="outline"
              />
            </div>
            <ul className="space-y-2">
              {run.open_questions.map((q, i) => (
                <li key={i} className="text-sm text-slate-700">
                  {q}
                </li>
              ))}
            </ul>
          </Section>
          )}

          {run.sources.length > 0 && (
            <Section title="Pages read">
              <ul className="space-y-1">
                {run.sources.map((s) => (
                  <li key={s}>
                    <a href={s} target="_blank" rel="noreferrer noopener" className={`${btn.link} text-sm`}>
                      {s}
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {runs.length > 1 && (
            <Section title="Earlier runs">
              <ul className="space-y-1">
                {runs.slice(1).map((r) => (
                  <li key={r.id} className="text-sm text-slate-600">
                    {new Date(r.created_at).toLocaleString()} — {r.status}
                    {r.accepted_at && " · accepted"}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
