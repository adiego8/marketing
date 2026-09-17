"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  listAgencyKeys,
  createAgencyKey,
  revokeAgencyKey,
  listClients,
  getGoogleStatus,
  startGoogleConnect,
  disconnectGoogle,
} from "@/lib/api";
import { readGoogleResult } from "@/lib/google-result";
import { useAuth } from "@/lib/auth-context";
import { NumericoLockup } from "@/components/brand/numerico-mark";
import { CopyButton } from "@/components/shared/copy-button";
import {
  ConnectInstructions,
  SaveKeyFirst,
} from "@/components/shared/connect-instructions";
import { banner, btn, field, surface, text } from "@/lib/ui";
import { statusPill } from "@/lib/ui-status";
import type { ApiKey, ApiKeyScope, ClientListItem } from "@/lib/types";

/**
 * The agency's own settings — the first screen in this app that is not about
 * one client, and the thing the login page has been promising all along
 * ("Google Calendar can be connected later, from Settings").
 *
 * It also holds the Google Calendar connection, which the login page has been
 * pointing at all along. One account serves every client, and switching
 * accounts means disconnecting here first — calendars are created by whichever
 * account is connected, so swapping underneath them strands every client's
 * schedule on a calendar the new account cannot see.
 *
 * It holds every API key the agency has. There used to be two kinds in two
 * places — an agency key here and a per-client key on each client's own page —
 * which meant the one almost everyone wants was the harder one to find. Now a
 * key carries an allowlist, and "a key for one client" is a one-entry list.
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

  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState(PRESETS[0].id);
  /** Empty means every client, present and future. */
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [minted, setMinted] = useState<(ApiKey & { secret: string }) | null>(null);

  const [google, setGoogle] = useState<{
    configured: boolean;
    missing: string[];
    connected: boolean;
    email: string | null;
    needs_reconnect: boolean;
    linked_clients: number;
  } | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleNote, setGoogleNote] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([listAgencyKeys(), listClients({ status: "active" })])
      .then(([k, c]) => {
        setKeys(k);
        setClients(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the keys"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const loadGoogle = useCallback(() => {
    getGoogleStatus().then(setGoogle).catch(() => setGoogle(null));
  }, []);

  useEffect(() => {
    loadGoogle();
    // Connecting from here returns here. account-mismatch in particular lands
    // on this page, because Settings is where the way out of it lives.
    const result = readGoogleResult();
    if (!result) return;
    if (result.connected) setGoogleNote("Google connected");
    else setError(result.message);
  }, [loadGoogle]);

  const handleGoogleConnect = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      const { url } = await startGoogleConnect("/settings");
      // A full navigation, not a fetch: this is Google's own consent screen.
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the Google connection");
      setGoogleBusy(false);
    }
  };

  /**
   * Drop the account — and with it every calendar link this agency holds.
   *
   * The count is the real one from /google/status rather than "every client",
   * which would overstate the damage for an agency that has never synced. The
   * distinction between what stays in Google and what this app forgets is the
   * whole point of the sentence: nothing is deleted, but nothing finds its way
   * back either.
   */
  const handleGoogleDisconnect = async () => {
    const n = google?.linked_clients ?? 0;
    const account = google?.email ?? "this Google account";
    const impact =
      n === 0
        ? "No client has a calendar yet, so nothing is lost."
        : `${n} client${n === 1 ? "" : "s"} will lose ${n === 1 ? "its" : "their"} ` +
          `calendar link. Events already in that account stay there, but this app ` +
          `forgets them and builds a fresh calendar on the next sync.`;

    if (!confirm(`Disconnect ${account}?\n\n${impact}`)) return;

    setError(null);
    setGoogleNote(null);
    setGoogleBusy(true);
    try {
      const r = await disconnectGoogle();
      setGoogleNote(
        r.cleared_clients > 0
          ? `Disconnected — ${r.cleared_clients} calendar link${
              r.cleared_clients === 1 ? "" : "s"
            } cleared`
          : "Disconnected"
      );
      loadGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect Google");
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const scopes = PRESETS.find((p) => p.id === preset)?.scopes ?? [];
      const created = await createAgencyKey({
        name: name.trim(),
        scopes,
        // Omitted entirely when nothing is picked, which the route reads as
        // every client, present and future.
        ...(picked.length > 0 ? { client_ids: picked } : {}),
      });
      setMinted(created);
      setName("");
      setPicked([]);
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
        `Revoke "${key.name}"? Anything using it stops working on its very next request.`
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
            The Google account every client&rsquo;s calendar is built under, and
            the agency-wide API keys. One key reaches every client you have, which
            is what makes it practical to connect an assistant once instead of
            once per client.
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

            {/* The key is shown once, so this is where it has to be saved.
                The instructions carry only the path — never the secret. */}
            <SaveKeyFirst />
            <ConnectInstructions />
          </div>
        )}

        {/* The connection the login page promised lived here, and until now did
            not. Without a Disconnect the app can never change Google account:
            connecting a different one is refused, by design. */}
        <section className={`${surface.card} ${surface.pad} mb-6`}>
          <h2 className={text.cardTitle}>Google Calendar</h2>
          <p className={`${text.muted} mt-1 max-w-2xl`}>
            One account for every client. Each client gets its own calendar,
            created by the account connected here — so changing account means
            disconnecting first, and the calendars are rebuilt under the new one.
          </p>

          {google === null ? (
            <p className={`${text.muted} mt-3`}>Checking…</p>
          ) : !google.configured ? (
            <p className={`${banner.warn} mt-3`}>
              Google OAuth is not configured on this server. Missing:{" "}
              {google.missing.join(", ")}.
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                {google.connected ? (
                  <>
                    <p className="text-sm text-slate-800">
                      Connected as{" "}
                      <span className="font-medium">{google.email ?? "an account"}</span>
                    </p>
                    <p className={`${text.muted} mt-0.5`}>
                      {google.linked_clients === 0
                        ? "No client has a calendar yet."
                        : `${google.linked_clients} client${
                            google.linked_clients === 1 ? "" : "s"
                          } linked.`}
                      {googleNote && (
                        <span className="text-teal-700 font-medium"> — {googleNote}</span>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-800">
                    Not connected.
                    {googleNote && (
                      <span className="text-teal-700 font-medium"> {googleNote}</span>
                    )}
                  </p>
                )}
              </div>

              <span className="flex gap-2 shrink-0">
                {google.connected && google.needs_reconnect && (
                  // Reconnecting the SAME account is how a grant that predates
                  // the calendar scope gets widened, and the gate allows it.
                  <button
                    onClick={handleGoogleConnect}
                    disabled={googleBusy}
                    className={btn.primarySm}
                  >
                    Reconnect
                  </button>
                )}
                {google.connected ? (
                  <button
                    onClick={handleGoogleDisconnect}
                    disabled={googleBusy}
                    className={btn.outline}
                  >
                    {googleBusy ? "Working…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    onClick={handleGoogleConnect}
                    disabled={googleBusy}
                    className={btn.primarySm}
                  >
                    {googleBusy ? "Opening…" : "Connect Google"}
                  </button>
                )}
              </span>
            </div>
          )}
        </section>

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

          <fieldset className="mt-4">
            <legend className={field.micro}>Which clients it reaches</legend>
            {/*
              Nothing picked means every client, present and future — the right
              default for your own assistant, which should see a new client the
              moment you create one. Picking a subset freezes it, which is what
              makes a key safe to hand to somebody working on two of five.
            */}
            <label className="flex gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:border-slate-300 transition-colors">
              <input
                type="checkbox"
                checked={picked.length === 0}
                onChange={() => setPicked([])}
                className="mt-1 accent-teal-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800">
                  All clients
                </span>
                <span className={`${text.micro} block mt-0.5`}>
                  Including any you add later. Nothing to reconfigure.
                </span>
              </span>
            </label>

            {clients.length > 0 && (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {clients.map((client) => (
                  <label
                    key={client.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:border-slate-300 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={picked.includes(client.id)}
                      onChange={(e) =>
                        setPicked((prev) =>
                          e.target.checked
                            ? [...prev, client.id]
                            : prev.filter((id) => id !== client.id)
                        )
                      }
                      className="accent-teal-600"
                    />
                    <span className="text-sm text-slate-800 truncate">{client.name}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {/* Deliberately without a key. A file or page carrying a live secret
              would outlive the moment it was needed; this is the shape, and the
              reader pastes their own key into it. */}
          <ConnectInstructions
            title="How anyone connects"
            hint="The same instructions without a key — paste your own in where it says so, then paste the whole thing into Claude."
          />
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
                      {key.client_ids === null
                        ? "All clients, including any added later"
                        : key.client_ids.length === 0
                          ? "No clients — this key can reach nothing"
                          : key.client_ids
                              .map(
                                (id) =>
                                  clients.find((c) => c.id === id)?.name ??
                                  // A client archived or deleted since. Shown as
                                  // the id rather than hidden, so the row still
                                  // accounts for everything the key covers.
                                  `${id.slice(0, 8)}…`
                              )
                              .join(" · ")}
                    </p>
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
