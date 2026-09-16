"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { listApiKeys, createApiKey, revokeApiKey } from "@/lib/api";
import { CopyButton } from "@/components/shared/copy-button";
import {
  ConnectInstructions,
  SaveKeyFirst,
} from "@/components/shared/connect-instructions";
import { banner, btn, field, surface, text } from "@/lib/ui";
import { statusPill } from "@/lib/ui-status";
import type { ApiKey, ApiKeyScope } from "@/lib/types";

/**
 * Keys for whatever else reads this client's plan.
 *
 * The page has one job the UI cannot undo: a key is shown exactly once. So the
 * new-key panel is loud, it is the only place the secret ever appears, and
 * dismissing it asks first — losing it costs a revoke and a remint, which is
 * cheap but annoying enough to warn about.
 *
 * Everything here talks to the session-authed /api/v1 routes. The agent rail
 * has no path to mint or revoke anything, deliberately: a key must never be
 * able to issue itself a better one.
 */

const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "schedule:read": "Read the schedule and copy",
  "brand:read": "Read the brand, voice and logo",
  "schedule:publish": "Report what it published",
};

/** The two shapes anyone actually wants. Custom is the checkboxes below. */
const PRESETS: { id: string; label: string; detail: string; scopes: ApiKeyScope[] }[] = [
  {
    id: "read",
    label: "Read only",
    detail: "Can see what is scheduled and how the client sounds. Cannot write anything.",
    scopes: ["schedule:read", "brand:read"],
  },
  {
    id: "publish",
    label: "Read and publish",
    detail: "Everything above, plus reporting back what it posted and what failed.",
    scopes: ["schedule:read", "brand:read", "schedule:publish"],
  },
];

export default function ApiAccessPage() {
  const { clientId } = useParams() as { clientId: string };

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<(ApiKey & { secret: string }) | null>(null);

  const load = useCallback(() => {
    listApiKeys(clientId)
      .then(setKeys)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the keys"))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const scopes = PRESETS.find((p) => p.id === preset)?.scopes ?? [];
      const created = await createApiKey(clientId, { name: name.trim(), scopes });
      setMinted(created);
      setName("");
      setKeys((prev) => [created, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the key");
    } finally {
      setCreating(false);
    }
  };

  const handleDismiss = () => {
    if (!confirm("Hide the key? It cannot be shown again — copy it first.")) return;
    setMinted(null);
  };

  const handleRevoke = async (key: ApiKey) => {
    if (
      !confirm(
        `Revoke "${key.name}"? Anything using it stops working on its very next request.`
      )
    ) {
      return;
    }
    setBusyId(key.id);
    setError(null);
    try {
      const revoked = await revokeApiKey(clientId, key.id);
      setKeys((prev) => prev.map((k) => (k.id === key.id ? revoked : k)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke that key");
    } finally {
      setBusyId(null);
    }
  };

  const live = keys.filter((k) => k.status === "active");
  const dead = keys.filter((k) => k.status !== "active");

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className={text.h1}>API access</h1>
        <p className={`${text.muted} mt-1 max-w-2xl`}>
          Keys let something else — a publishing agent, an assistant — read what
          this client has scheduled and report back what it posted. Each key here
          is scoped to this client alone. For one key that covers every client,
          use <a href="/settings" className="text-teal-700 hover:underline">agency
          settings</a>.
        </p>
      </header>

      {error && <p className={`${banner.error} mb-4`}>{error}</p>}

      {minted && (
        <div className="mb-6 rounded-xl border-2 border-teal-600 bg-teal-50/60 p-5">
          <p className={text.cardTitle}>Copy your key now</p>
          <p className={`${text.muted} mt-1`}>
            This is the only time it is shown. We store a one-way hash of it, so
            nobody — including us — can read it back.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-0 break-all rounded-lg border border-teal-200 bg-white px-3 py-2 font-mono text-xs text-slate-800">
              {minted.secret}
            </code>
            <CopyButton text={minted.secret} label="Copy key" variant="outline" />
            <button onClick={handleDismiss} className={btn.ghost}>
              Done
            </button>
          </div>
          <SaveKeyFirst />
          <ConnectInstructions scope="client" />

          <p className={`${text.micro} mt-3`}>
            Or use it directly:{" "}
            <code className="font-mono">Authorization: Bearer {minted.prefix}…</code>{" "}
            against <code className="font-mono">/api/agent/v1/schedule</code>.
          </p>
        </div>
      )}

      <section className={`${surface.card} ${surface.pad} mb-6`}>
        <h2 className={text.cardTitle}>New key</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className={field.micro} htmlFor="key-name">
              What is it for
            </label>
            <input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="LinkedIn publisher"
              className={field.input}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className={btn.primary}
          >
            {creating ? "Creating…" : "Create key"}
          </button>
        </div>

        <fieldset className="mt-4">
          <legend className={field.micro}>What it may do</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <label
                key={p.id}
                className={`flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  preset === p.id
                    ? "border-teal-600 bg-teal-50/50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="preset"
                  value={p.id}
                  checked={preset === p.id}
                  onChange={() => setPreset(p.id)}
                  className="mt-1 accent-teal-600"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">
                    {p.label}
                  </span>
                  <span className={`${text.micro} block mt-0.5`}>{p.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {loading ? (
        <p className={text.muted}>Loading…</p>
      ) : keys.length === 0 ? (
        <div className={surface.empty}>
          <p className={text.muted}>No keys yet. Nothing outside this app can read this client.</p>
        </div>
      ) : (
        <>
          <div className={surface.list}>
            {live.map((key) => (
              <KeyRow
                key={key.id}
                apiKey={key}
                busy={busyId === key.id}
                onRevoke={() => handleRevoke(key)}
              />
            ))}
            {live.length === 0 && (
              <p className={`${text.muted} px-5 py-4`}>No keys are currently live.</p>
            )}
          </div>

          {dead.length > 0 && (
            <>
              <h2 className={`${text.label} mt-8 mb-2`}>No longer usable</h2>
              <div className={surface.list}>
                {dead.map((key) => (
                  <KeyRow key={key.id} apiKey={key} busy={false} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Key-free, so it outlives the one moment the secret is visible and can
          be handed to whoever is doing the connecting. */}
      <ConnectInstructions
        scope="client"
        title="How anyone connects"
        hint="The same instructions without a key — paste your own in where it says so, then paste the whole thing into Claude."
      />
    </div>
  );
}

function KeyRow({
  apiKey,
  busy,
  onRevoke,
}: {
  apiKey: ApiKey;
  busy: boolean;
  onRevoke?: () => void;
}) {
  const dead = apiKey.status !== "active";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <p className={dead ? "text-sm text-slate-400" : "text-sm text-slate-800"}>
          {apiKey.name}
          {dead && <span className={`${statusPill(apiKey.status)} ml-2`}>{apiKey.status}</span>}
        </p>
        <p className={`${text.mono} mt-1`}>{apiKey.prefix}…</p>
        <p className={`${text.micro} mt-1`}>
          {apiKey.scopes
            .map((s) => SCOPE_LABELS[s as ApiKeyScope] ?? s)
            .join(" · ")}
        </p>
        <p className={`${text.micro} mt-1`}>
          {apiKey.created_by && `Created by ${apiKey.created_by}`}
          {/* Throttled to once an hour, so never presented as precise. */}
          {apiKey.last_used_at
            ? ` · last used around ${new Date(apiKey.last_used_at).toLocaleDateString()}`
            : " · never used"}
        </p>
      </div>
      {onRevoke && (
        <button onClick={onRevoke} disabled={busy} className={btn.outlineSm}>
          {busy ? "…" : "Revoke"}
        </button>
      )}
    </div>
  );
}
