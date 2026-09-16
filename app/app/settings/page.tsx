"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listAgencyKeys, createAgencyKey, revokeAgencyKey } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { NumericoLockup } from "@/components/brand/numerico-mark";
import { CopyButton } from "@/components/shared/copy-button";
import { banner, btn, field, surface, text } from "@/lib/ui";
import { statusPill } from "@/lib/ui-status";
import type { ApiKey, ApiKeyScope } from "@/lib/types";

/**
 * The agency's own settings — the first screen in this app that is not about
 * one client, and the thing the login page has been promising all along
 * ("Google Calendar can be connected later, from Settings").
 *
 * It holds agency-wide API keys: one credential that reaches every client. Per
 * client keys stay on the client's own API access page, because the two have
 * very different blast radius and the place you find a key should tell you
 * which kind you are holding.
 */

const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "schedule:read": "Read the schedule and copy",
  "brand:read": "Read the brand, voice and logo",
  "schedule:publish": "Report what it published",
};

const PRESETS: { id: string; label: string; detail: string; scopes: ApiKeyScope[] }[] = [
  {
    id: "read",
    label: "Read only",
    detail: "Can see what every client has scheduled, and how each one sounds.",
    scopes: ["schedule:read", "brand:read"],
  },
  {
    id: "publish",
    label: "Read and publish",
    detail: "Everything above, plus reporting back what it posted and what failed.",
    scopes: ["schedule:read", "brand:read", "schedule:publish"],
  },
];

export default function SettingsPage() {
  const { user, signOut } = useAuth();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<(ApiKey & { secret: string }) | null>(null);

  const load = useCallback(() => {
    listAgencyKeys()
      .then(setKeys)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the keys"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const scopes = PRESETS.find((p) => p.id === preset)?.scopes ?? [];
      const created = await createAgencyKey({ name: name.trim(), scopes });
      setMinted(created);
      setName("");
      setKeys((prev) => [created, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the key");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: ApiKey) => {
    if (
      !confirm(
        `Revoke "${key.name}"? It reaches every client, so anything using it stops working everywhere on its next request.`
      )
    ) {
      return;
    }
    setBusyId(key.id);
    setError(null);
    try {
      const revoked = await revokeAgencyKey(key.id);
      setKeys((prev) => prev.map((k) => (k.id === key.id ? revoked : k)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke that key");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            <NumericoLockup />
          </Link>
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 truncate max-w-[16rem]">
                {user.email}
              </span>
              <button
                onClick={signOut}
                className="text-xs text-slate-400 hover:text-teal-700 transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <Link href="/" className="text-sm text-slate-500 hover:text-teal-700">
          ← All clients
        </Link>

        <header className="mt-4 mb-6">
          <h1 className={text.h1}>Settings</h1>
          <p className={`${text.muted} mt-1 max-w-2xl`}>
            Agency-wide API keys. One key reaches every client you have, which is
            what makes it practical to connect an assistant once instead of once
            per client.
          </p>
        </header>

        {error && <p className={`${banner.error} mb-4`}>{error}</p>}

        {minted && (
          <div className="mb-6 rounded-xl border-2 border-teal-600 bg-teal-50/60 p-5">
            <p className={text.cardTitle}>Copy your key now</p>
            <p className={`${text.muted} mt-1`}>
              This is the only time it is shown. We store a one-way hash, so nobody
              — including us — can read it back.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 break-all rounded-lg border border-teal-200 bg-white px-3 py-2 font-mono text-xs text-slate-800">
                {minted.secret}
              </code>
              <CopyButton text={minted.secret} label="Copy key" variant="outline" />
              <button
                onClick={() => {
                  if (confirm("Hide the key? It cannot be shown again — copy it first.")) {
                    setMinted(null);
                  }
                }}
                className={btn.ghost}
              >
                Done
              </button>
            </div>
          </div>
        )}

        <section className={`${surface.card} ${surface.pad} mb-6`}>
          <h2 className={text.cardTitle}>New agency key</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label className={field.micro} htmlFor="key-name">
                What is it for
              </label>
              <input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Claude Desktop"
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

          <p className={`${text.micro} mt-4`}>
            Want a key limited to one client instead? Open that client and use its
            API access page.
          </p>
        </section>

        {loading ? (
          <p className={text.muted}>Loading…</p>
        ) : keys.length === 0 ? (
          <div className={surface.empty}>
            <p className={text.muted}>
              No agency keys yet. Nothing outside this app can read across your clients.
            </p>
          </div>
        ) : (
          <div className={surface.list}>
            {keys.map((key) => {
              const dead = key.status !== "active";
              return (
                <div
                  key={key.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className={dead ? "text-sm text-slate-400" : "text-sm text-slate-800"}>
                      {key.name}
                      {dead && (
                        <span className={`${statusPill(key.status)} ml-2`}>{key.status}</span>
                      )}
                    </p>
                    <p className={`${text.mono} mt-1`}>{key.prefix}…</p>
                    <p className={`${text.micro} mt-1`}>
                      {key.scopes.map((s) => SCOPE_LABELS[s as ApiKeyScope] ?? s).join(" · ")}
                    </p>
                    <p className={`${text.micro} mt-1`}>
                      {key.created_by && `Created by ${key.created_by}`}
                      {/* Throttled to once an hour, so never shown as precise. */}
                      {key.last_used_at
                        ? ` · last used around ${new Date(key.last_used_at).toLocaleDateString()}`
                        : " · never used"}
                    </p>
                  </div>
                  {!dead && (
                    <button
                      onClick={() => handleRevoke(key)}
                      disabled={busyId === key.id}
                      className={btn.outlineSm}
                    >
                      {busyId === key.id ? "…" : "Revoke"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
