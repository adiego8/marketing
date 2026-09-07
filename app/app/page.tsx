"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listClients, createClient, deleteClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { NumericoLockup } from "@/components/brand/numerico-mark";
import { banner, btn, field, surface, table, text } from "@/lib/ui";
import { statusPill } from "@/lib/ui-status";
import type { ClientListItem } from "@/lib/types";

export default function ClientListPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Create form
  const [newName, setNewName] = useState("");
  const [newWebsite, setNewWebsite] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newDescription, setNewDescription] = useState("");
  // Defaults to the browser's zone: whoever creates the client is usually in,
  // or near, the market it posts to. Every scheduling decision uses this.
  const [newTimezone, setNewTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );

  const fetchClients = async () => {
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const data = await listClients(params);
      setClients(data);
      setError(null);
    } catch (e) {
      // Rendered, not just logged: an empty list and a failed request look
      // identical otherwise, which is exactly when you need to tell them apart.
      setError(e instanceof Error ? e.message : "Could not load clients");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, [statusFilter]);

  useEffect(() => {
    const timeout = setTimeout(fetchClients, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const client = await createClient({
        name: newName,
        website_url: newWebsite || undefined,
        contact_email: newEmail || undefined,
        contact_phone: newPhone || undefined,
        description: newDescription || undefined,
        timezone: newTimezone || undefined,
      });
      setShowCreate(false);
      setNewName("");
      setNewWebsite("");
      setNewEmail("");
      setNewPhone("");
      setNewDescription("");
      router.push(`/clients/${client.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create client");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <NumericoLockup />
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

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <p className={text.eyebrow}>Workspace</p>
            <h1 className={`${text.h1} mt-1`}>Clients</h1>
          </div>
          <button onClick={() => setShowCreate(true)} className={btn.primary}>
            Add client
          </button>
        </div>

        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New client</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className={field.micro}>Name *</label>
                <input
                  className={field.inputSm}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Company name"
                />
              </div>
              <div>
                <label className={field.micro}>Website</label>
                <input
                  className={field.inputSm}
                  value={newWebsite}
                  onChange={(e) => setNewWebsite(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={field.micro}>Email</label>
                  <input
                    className={field.inputSm}
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="contact@…"
                  />
                </div>
                <div>
                  <label className={field.micro}>Phone</label>
                  <input
                    className={field.inputSm}
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="+1…"
                  />
                </div>
              </div>
              <div>
                <label className={field.micro}>Notes</label>
                <input
                  className={field.inputSm}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Internal notes…"
                />
              </div>
              <div>
                <label className={field.micro}>Timezone</label>
                <input
                  className={field.inputSm}
                  value={newTimezone}
                  onChange={(e) => setNewTimezone(e.target.value)}
                  placeholder="America/New_York"
                />
                <p className="text-xs text-slate-400 mt-1.5">
                  IANA zone. Posting times are scheduled in this client&apos;s
                  local time.
                </p>
              </div>
              {createError && <p className={banner.error}>{createError}</p>}
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className={`${btn.primary} w-full`}
              >
                {creating ? "Creating…" : "Create client"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        <div className="flex flex-wrap gap-3 mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className={`${field.inputSm} max-w-xs`}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={field.select}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {error && <p className={`${banner.error} mb-4`}>{error}</p>}

        {loading ? (
          <p className={text.muted}>Loading…</p>
        ) : clients.length === 0 ? (
          <div className={surface.empty}>
            <p className="text-slate-700 text-lg">No clients yet.</p>
            <p className="text-slate-500 text-sm mt-1">
              Add one to start planning content.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className={`${btn.primary} mt-6`}
            >
              Add client
            </button>
          </div>
        ) : (
          <div className={`${surface.table} overflow-x-auto`}>
            <table className="w-full">
              <thead>
                <tr className="bg-stone-50">
                  <th className={table.head}>Name</th>
                  <th className={table.head}>Status</th>
                  <th className={table.head}>Website</th>
                  <th className={table.head}>Contact</th>
                  <th className={table.head}>Created</th>
                  <th className={table.head}></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    className={`${table.row} cursor-pointer`}
                    onClick={() => router.push(`/clients/${c.id}`)}
                  >
                    <td className={`${table.cell} font-medium`}>{c.name}</td>
                    <td className={table.cell}>
                      <span className={statusPill(c.status)}>{c.status}</span>
                    </td>
                    <td className={table.cellMuted}>{c.website_url || "—"}</td>
                    <td className={table.cellMuted}>{c.contact_email || "—"}</td>
                    <td className={table.cellMuted}>
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className={`${table.cell} text-right`}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${c.name}" and all its data?`)) {
                            deleteClient(c.id).then(() => fetchClients());
                          }
                        }}
                        className="text-xs text-slate-400 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
